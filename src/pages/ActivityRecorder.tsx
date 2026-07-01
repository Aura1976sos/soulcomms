import { useState, useCallback, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { useGuest } from "@/contexts/GuestContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useActivities, Activity } from "@/contexts/ActivitiesContext";
import { resolveIcon } from "@/lib/experiences";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrScannerModal } from "@/components/checkin/QrScannerModal";
import { SessionPickerModal } from "@/components/activity/SessionPickerModal";
import { QrValidatorTab } from "@/components/activity/QrValidatorTab";
import {
  CheckCircle, XCircle, RotateCcw, Zap, Keyboard, QrCode,
  MessageSquare, Phone, User, Hash, Ticket, ScanLine, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  offlineLookupParticipant, localActivityCheck, queueMutation,
  getAllWalkIns, getSyncQueueItems,
} from "@/lib/offlineStore";
import { speak, VM } from "@/lib/voice";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@enter-pro/analytics-sdk";
import { recordActivityCheckin } from "@/lib/activityTimeTracking";

// ─── Types ────────────────────────────────────────────────────────────────────
type AppTab = "recorder" | "validator";
type Step = "search" | "select";
type FindStatus = "idle" | "finding" | "not_found" | "not_checked_in" | "error";

interface FoundParticipant {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  is_checked_in: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

function candidateCodes(raw: string): string[] {
  const trimmed = raw.trim();
  const set = new Set<string>([trimmed]);
  const stripped = trimmed.replace(/^[#\s]+/, "").trim();
  if (stripped) set.add(stripped);
  if (/^\d+$/.test(stripped)) set.add(stripped.padStart(4, "0"));
  const parts = trimmed.split(/[-/]/);
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1].replace(/\D/g, "");
    if (suffix && suffix.length <= 6) { set.add(suffix); set.add(suffix.padStart(4, "0")); }
  }
  return [...set].filter(Boolean);
}

const SEL = "id, code, name, phone, is_checked_in";

async function lookupParticipantOnline(query: string, eventId: string): Promise<FoundParticipant | null> {
  const trimmed = query.trim();
  if (!trimmed || !eventId) return null;

  try {
    const walkIns = await getAllWalkIns();
    const normPhone = trimmed.replace(/\D/g, "");
    const isUrl = trimmed.startsWith("http");
    const wi = walkIns.find(w =>
      w.event_id === eventId && (
        w.temp_code.toUpperCase() === trimmed.toUpperCase() ||
        w.name.toLowerCase() === trimmed.toLowerCase() ||
        (isUrl && w.qr_link === trimmed) ||
        (normPhone.length >= 8 && w.phone && w.phone.replace(/\D/g, "") === normPhone)
      )
    );
    if (wi) return { id: wi.id, code: wi.temp_code, name: wi.name, phone: wi.phone, is_checked_in: wi.is_checked_in };
  } catch { /* IDB unavailable */ }

  if (trimmed.startsWith("http")) {
    const { data } = await withTimeout(supabase.from("participants").select(SEL)
      .eq("event_id", eventId).eq("qr_link", trimmed).limit(1).maybeSingle());
    return data ? (data as FoundParticipant) : null;
  }

  for (const candidate of candidateCodes(trimmed)) {
    const { data } = await withTimeout(supabase.from("participants").select(SEL)
      .eq("event_id", eventId).eq("code", candidate).limit(1).maybeSingle());
    if (data) return data as FoundParticipant;
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8) {
    for (const ph of [trimmed, digits]) {
      const { data } = await withTimeout(supabase.from("participants").select(SEL)
        .eq("event_id", eventId).eq("phone", ph).limit(1).maybeSingle());
      if (data) return data as FoundParticipant;
    }
  }

  if (/[a-zA-Z]/.test(trimmed) && trimmed.length >= 3) {
    const { data } = await withTimeout(supabase.from("participants").select(SEL)
      .eq("event_id", eventId).ilike("name", `%${trimmed}%`).order("name").limit(1).maybeSingle());
    if (data) return data as FoundParticipant;
  }

  return null;
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ActivityRecorder() {
  const [appTab, setAppTab] = useState<AppTab>("recorder");

  // ── Step machine ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("search");
  const [findStatus, setFindStatus] = useState<FindStatus>("idle");
  const [query, setQuery] = useState("");
  const [inputMethod, setInputMethod] = useState<"manual" | "qr">("manual");
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [foundParticipant, setFoundParticipant] = useState<FoundParticipant | null>(null);

  // ── Activity state ────────────────────────────────────────────────────────────
  // Activities already recorded (activity_log) or already ticketed (session_participations)
  const [doneActivityIds, setDoneActivityIds] = useState<Set<string>>(new Set());
  // Activities that have sessions configured
  const [sessionActivityIds, setSessionActivityIds] = useState<Set<string>>(new Set());
  // Which session-based activity to open picker for
  const [sessionActivity, setSessionActivity] = useState<Activity | null>(null);
  // Session counter for this operator shift
  const [sessionCount, setSessionCount] = useState(0);
  // Direct-record flash feedback
  const [flashId, setFlashId] = useState<string | null>(null);

  const { user } = useAuth();
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { online, refreshPending } = useNetwork();
  const { activeActivities, loading: activitiesLoading } = useActivities();
  const navigate = useNavigate();

  const eventId = isGuestMode ? (guestSession?.eventId ?? "") : (activeEvent?.id ?? "");
  const eventName = isGuestMode ? (guestSession?.eventName ?? "Event") : (activeEvent?.name ?? "Event");

  // Group by category for display
  const grouped = activeActivities
    .filter(a => a.parent_id === null)
    .reduce<Record<string, Activity[]>>((acc, a) => {
      const cat = a.category ?? "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(a);
      return acc;
    }, {});
  const categories = Object.keys(grouped);

  // ── Load done activities + session IDs for this participant ────────────────
  const loadActivityState = useCallback(async (participantId: string) => {
    const done = new Set<string>();
    try {
      if (online) {
        const [{ data: logData }, { data: sessionData }, { data: ticketData }] = await Promise.all([
          withTimeout(supabase.from("activity_logs").select("activity_id")
            .eq("participant_id", participantId).eq("event_id", eventId)),
          withTimeout(supabase.from("activity_sessions").select("activity_id")
            .eq("event_id", eventId).in("status", ["scheduled", "active"])),
          withTimeout(supabase.from("session_participations").select("activity_id")
            .eq("participant_id", participantId).eq("event_id", eventId)),
        ]);
        (logData ?? []).forEach(r => { if (r.activity_id) done.add(r.activity_id); });
        (ticketData ?? []).forEach(r => { if (r.activity_id) done.add(r.activity_id); });
        const sessIds = new Set<string>((sessionData ?? []).map((r: { activity_id: string }) => r.activity_id));
        setSessionActivityIds(sessIds);
      }
      // Offline queue check
      const queue = await getSyncQueueItems();
      queue.forEach(m => {
        if (m.type === "activity_log" && m.payload.participant_id === participantId && m.payload.activity_id) {
          done.add(m.payload.activity_id as string);
        }
        if (m.type === "session_participation" && m.payload.participant_id === participantId && m.payload.activity_id) {
          done.add(m.payload.activity_id as string);
        }
      });
    } catch { /* best-effort */ }
    setDoneActivityIds(done);
  }, [online, eventId]);

  // ── Find participant ──────────────────────────────────────────────────────────
  const findParticipant = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || !eventId) return;
    setLoading(true);
    setFindStatus("idle");
    setErrorMsg("");
    setFoundParticipant(null);
    setDoneActivityIds(new Set());

    try {
      let participant: FoundParticipant | null = null;
      if (!online) {
        const cached = await offlineLookupParticipant(trimmed, eventId);
        if (!cached) { setFindStatus("not_found"); return; }
        participant = { id: cached.id, code: cached.code, name: cached.name, phone: cached.phone, is_checked_in: cached.is_checked_in };
      } else {
        participant = await lookupParticipantOnline(trimmed, eventId);
        if (!participant) { setFindStatus("not_found"); return; }
      }

      if (!participant.is_checked_in) {
        setFoundParticipant(participant);
        setFindStatus("not_checked_in");
        return;
      }

      setFoundParticipant(participant);
      await loadActivityState(participant.id);
      setStep("select");
      setFindStatus("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMsg(msg.includes("timed out") ? "Request timed out. Check connection." : msg);
      setFindStatus("error");
    } finally {
      setLoading(false);
    }
  }, [online, eventId, loadActivityState]);

  // ── Direct record for Club 100 (is_single_session = true) ────────────────────
  const directRecord = useCallback(async (activity: Activity) => {
    if (!foundParticipant || doneActivityIds.has(activity.id)) return;
    const now = new Date().toISOString();

    if (!online) {
      const alreadyQueued = await localActivityCheck(foundParticipant.id, activity.id);
      if (!alreadyQueued) {
        await queueMutation("activity_log", {
          participant_id: foundParticipant.id,
          participant_code: foundParticipant.code,
          experience: activity.code,
          activity_id: activity.id,
          points_awarded: activity.points_value,
          recorded_by: user?.id ?? null,
          event_id: eventId,
          recorded_at: now,
        });
        await refreshPending();
      }
    } else {
      const { data: existing } = await withTimeout(
        supabase.from("activity_logs").select("id")
          .eq("participant_id", foundParticipant.id).eq("activity_id", activity.id).maybeSingle()
      );
      if (!existing) {
        await withTimeout(supabase.from("activity_logs").insert({
          participant_id: foundParticipant.id,
          participant_code: foundParticipant.code,
          experience: activity.code,
          activity_id: activity.id,
          points_awarded: activity.points_value,
          recorded_by: user?.id ?? null,
          event_id: eventId,
        }));
      }

      // Track time spent on activity (auto-checkout previous activity)
      await recordActivityCheckin(eventId, foundParticipant.id, activity.id);
    }

    // Flash green feedback
    setFlashId(activity.id);
    setTimeout(() => setFlashId(null), 1200);
    setDoneActivityIds(prev => new Set([...prev, activity.id]));
    setSessionCount(c => c + 1);
    speak(VM.activity_success);
    trackEvent("activity_recorded", {
      eventType: "conversion",
      properties: { mode: online ? "online" : "offline", points: activity.points_value ?? 0 },
    });
  }, [foundParticipant, doneActivityIds, online, user, eventId, refreshPending]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    if (step === "search") findParticipant(query);
  };

  const handleQrScan = (value: string) => {
    setQuery(value);
    findParticipant(value);
    setShowScanner(false);
  };

  const resetToSearch = () => {
    setStep("search");
    setFindStatus("idle");
    setQuery("");
    setFoundParticipant(null);
    setDoneActivityIds(new Set());
    setSessionActivity(null);
    setErrorMsg("");
  };

  useEffect(() => {
    if (findStatus === "not_found") speak(VM.activity_not_found);
    if (findStatus === "not_checked_in") speak(VM.activity_not_checked_in);
  }, [findStatus]);

  // ── Participant card ──────────────────────────────────────────────────────────
  const ParticipantCard = () => {
    if (!foundParticipant) return null;
    return (
      <div className="flex items-center gap-3 rounded-xl bg-success/10 border border-success/20 px-4 py-3">
        <div className="p-2 rounded-full bg-success/20"><CheckCircle className="h-5 w-5 text-success" /></div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-foreground truncate">{foundParticipant.name}</p>
          <div className="flex gap-2 flex-wrap mt-0.5">
            <span className="text-[10px] font-mono bg-secondary px-2 py-0.5 rounded text-foreground">#{foundParticipant.code}</span>
            {foundParticipant.phone && (
              <span className="text-[10px] bg-secondary px-2 py-0.5 rounded text-muted-foreground">{foundParticipant.phone}</span>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={resetToSearch} className="shrink-0 text-xs h-7 gap-1 text-muted-foreground">
          <RotateCcw className="h-3 w-3" />Change
        </Button>
      </div>
    );
  };

  // ── Activity card — single-tap trigger ────────────────────────────────────────
  const ActivityCard = ({ activity }: { activity: Activity }) => {
    const Icon = resolveIcon(activity.icon_name);
    const color = activity.color ?? "hsl(var(--primary))";
    const isDone = doneActivityIds.has(activity.id);
    const isSingle = activity.is_single_session === true; // Club 100
    const hasSession = sessionActivityIds.has(activity.id) && !isSingle;
    const isFlashing = flashId === activity.id;

    const handleClick = () => {
      if (isDone) return;
      if (isSingle) {
        directRecord(activity);
      } else {
        setSessionActivity(activity);
      }
    };

    return (
      <button
        onClick={handleClick}
        disabled={isDone}
        className={cn(
          "relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 text-center",
          isDone
            ? "border-success/40 bg-success/5 opacity-70 cursor-not-allowed"
            : isFlashing
              ? "border-success bg-success/20 scale-95"
              : isSingle
                ? "border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 active:scale-95"
                : hasSession
                  ? "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60 hover:bg-amber-500/10 active:scale-95"
                  : "border-border bg-secondary hover:border-primary/40 active:scale-95"
        )}
      >
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: isDone ? undefined : `${color}25` }}>
          <Icon className="h-4 w-4" style={{ color: isDone ? "hsl(var(--success))" : color }} />
        </div>
        <span className="text-xs font-semibold text-foreground leading-tight">{activity.name}</span>
        <span className="text-[10px] text-muted-foreground">{activity.points_value} pts</span>

        {/* Corner indicator */}
        <div className="absolute top-1.5 right-1.5">
          {isDone
            ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            : isSingle
              ? <Zap className="h-3.5 w-3.5 text-primary" />
              : hasSession
                ? <Ticket className="h-3.5 w-3.5 text-amber-500" />
                : null}
        </div>

        {/* "Done" label */}
        {isDone && (
          <span className="absolute bottom-1 left-0 right-0 text-[9px] font-bold text-success text-center">Done</span>
        )}
      </button>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <AppLayout title="Activity Recorder" subtitle="Log participant experience at each zone">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* ── App tabs ─────────────────────────────────────────────────────── */}
        <div className="flex gap-2">
          {([
            { id: "recorder", label: "Record Activity", Icon: Zap },
            { id: "validator", label: "QR Validator", Icon: ScanLine },
          ] as const).map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setAppTab(id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition-all",
                appTab === id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>

        {/* ── QR Validator tab ─────────────────────────────────────────────── */}
        {appTab === "validator" && (
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-4">
              Scan to Validate Session Tickets
            </h3>
            {eventId
              ? <QrValidatorTab eventId={eventId} />
              : <p className="text-sm text-muted-foreground text-center py-8">No active event selected.</p>}
          </div>
        )}

        {appTab === "recorder" && (<>

          {/* ── Step 1: Search ────────────────────────────────────────────────── */}
          {(step === "search" || findStatus !== "idle") && (
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-4">
                Step 1 — Identify Participant
              </h3>

              <div className="flex gap-2 mb-4">
                {([
                  { id: "manual", label: "Search", Icon: Keyboard },
                  { id: "qr", label: "Scan QR", Icon: QrCode },
                ] as const).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setInputMethod(id)}
                    className={cn(
                      "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border-2 text-sm font-bold transition-all",
                      inputMethod === id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4" />{label}
                  </button>
                ))}
              </div>

              {inputMethod === "manual" ? (
                <form onSubmit={handleManualSubmit} className="space-y-3">
                  <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Code, name, or phone number"
                    className="h-14 pl-4 pr-4 text-lg font-semibold bg-secondary border-2 focus:border-primary scan-pulse"
                    autoFocus
                    disabled={loading}
                    autoComplete="off"
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    {[
                      { icon: Hash, label: "Code", example: "0245" },
                      { icon: User, label: "Name", example: "Daniel A." },
                      { icon: Phone, label: "Phone", example: "08012345678" },
                      { icon: QrCode, label: "QR URL", example: "gatheringng.com/…" },
                    ].map(({ icon: Icon, label, example }) => (
                      <div key={label} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Icon className="h-2.5 w-2.5 shrink-0" />
                        <span className="font-semibold">{label}:</span>
                        <span className="font-mono">{example}</span>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="submit"
                    disabled={loading || !query.trim()}
                    className="w-full h-12 font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90"
                  >
                    {loading
                      ? <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Searching…</span>
                      : <span className="flex items-center gap-2"><Zap className="h-4 w-4" />Find Participant</span>}
                  </Button>
                </form>
              ) : (
                <div className="space-y-4">
                  {query && (
                    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-secondary border border-border">
                      <span className="text-xs text-muted-foreground">Last scanned:</span>
                      <span className="text-sm font-mono font-bold text-foreground truncate">{query}</span>
                    </div>
                  )}
                  <Button
                    onClick={() => setShowScanner(true)}
                    disabled={loading}
                    className="w-full h-14 font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 gap-3"
                  >
                    <QrCode className="h-5 w-5" />
                    {loading ? "Searching…" : "Open Camera Scanner"}
                  </Button>
                </div>
              )}

              {findStatus === "not_found" && (
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-destructive">Not Found</p>
                    <p className="text-xs text-muted-foreground">No participant found for "{query}"</p>
                  </div>
                </div>
              )}
              {findStatus === "not_checked_in" && foundParticipant && (
                <div className="mt-4 space-y-2">
                  <div className="flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                    <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{foundParticipant.name}</p>
                      <p className="text-xs text-destructive font-medium">Not checked in — direct to Check-In Station first.</p>
                    </div>
                  </div>
                  <Button variant="outline" size="sm"
                    onClick={() => navigate(`/communications?escalate=activity&participant=${encodeURIComponent(foundParticipant.name)}&error=${encodeURIComponent("Not checked in")}`)}
                    className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10">
                    <MessageSquare className="h-3.5 w-3.5" />Escalate
                  </Button>
                </div>
              )}
              {findStatus === "error" && (
                <div className="mt-4 flex items-start gap-3 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3">
                  <XCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-xs text-muted-foreground">{errorMsg}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Select Activity ───────────────────────────────────────── */}
          {step === "select" && foundParticipant && (
            <div className="glass-card rounded-2xl p-6 fade-in-up space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-3">
                  Step 2 — Select Activity
                </h3>
                <ParticipantCard />
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" />Done</span>
                <span className="flex items-center gap-1"><Ticket className="h-3 w-3 text-amber-500" />Tap to ticket</span>
                <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-primary" />Direct record</span>
              </div>

              {activitiesLoading ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {Array.from({ length: 8 }).map((_, i) => <div key={i} className="h-24 rounded-xl bg-secondary animate-pulse" />)}
                </div>
              ) : activeActivities.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">No active activities. Ask an admin to create some.</p>
              ) : (
                <div className="space-y-4">
                  {categories.map(cat => (
                    <div key={cat}>
                      {categories.length > 1 && (
                        <div className="flex items-center gap-2 mb-2">
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-[10px] font-black uppercase tracking-[3px] text-muted-foreground px-2">{cat}</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      )}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {grouped[cat].map(a => <ActivityCard key={a.id} activity={a} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button variant="outline" onClick={resetToSearch} className="w-full gap-2">
                <RotateCcw className="h-4 w-4" />Next Participant
              </Button>
            </div>
          )}

          {/* ── Session counter ───────────────────────────────────────────────── */}
          <div className="glass-card rounded-xl px-6 py-4 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-[2px] text-muted-foreground">This Session</span>
            <span className="text-lg font-black text-primary">{sessionCount} recorded</span>
          </div>

        </>)}
      </div>

      {showScanner && (
        <QrScannerModal onScan={handleQrScan} onClose={() => setShowScanner(false)} />
      )}

      {sessionActivity && foundParticipant && (
        <SessionPickerModal
          activity={sessionActivity}
          participant={{
            id: foundParticipant.id,
            code: foundParticipant.code,
            name: foundParticipant.name,
            phone: foundParticipant.phone,
          }}
          eventId={eventId}
          eventName={eventName}
          staffName={user?.email ?? "Staff"}
          online={online}
          onClose={() => setSessionActivity(null)}
          onDone={() => {
            setSessionCount(c => c + 1);
            setDoneActivityIds(prev => new Set([...prev, sessionActivity!.id]));
            setSessionActivity(null);
          }}
        />
      )}
    </AppLayout>
  );
}
