import { useState, useCallback, useEffect, useRef } from "react";
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
import {
  CheckCircle, XCircle, RotateCcw, Zap, QrCode,
  MessageSquare, Phone, User, Hash, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  offlineLookupParticipant, localActivityCheck, queueMutation,
  getAllWalkIns, getOfflineParticipants, getSyncQueueItems,
} from "@/lib/offlineStore";
import { speak, VM } from "@/lib/voice";
import { useNavigate } from "react-router-dom";
import { trackEvent } from "@enter-pro/analytics-sdk";
import { recordActivityCheckin } from "@/lib/activityTimeTracking";

// ─── Types ────────────────────────────────────────────────────────────────────
type Step = "search" | "select";
type FindStatus = "idle" | "finding" | "not_found" | "not_checked_in" | "error";

interface FoundParticipant {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  is_checked_in: boolean;
}

interface ParticipantSuggestion extends FoundParticipant {
  hint: string;
}

interface ActivitySessionLite {
  activity_id: string;
  session_date: string | null;
  start_time: string;
  end_time: string;
  status: "scheduled" | "active" | "completed" | "cancelled";
}

interface ActivitySessionDisplay {
  id: string;
  label: string;
  start_time: string;
  end_time: string;
  session_date: string | null;
  isNow: boolean;
}

interface LocalParticipantRecord extends FoundParticipant {
  event_id: string;
  qr_link?: string | null;
  is_walkin?: boolean;
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

function formatSessionTimeRange(start: string, end: string): string {
  const fmt = (t: string) => {
    const [h, m] = t.split(":");
    const hour24 = parseInt(h, 10);
    const hour12 = hour24 % 12 || 12;
    const suffix = hour24 >= 12 ? "PM" : "AM";
    return `${hour12}:${m} ${suffix}`;
  };
  return `${fmt(start)} - ${fmt(end)}`;
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + parseInt(m, 10);
}

function isSameLocalDate(dateStr: string | null, now: Date): boolean {
  if (!dateStr) return true;
  const d = new Date(`${dateStr}T00:00:00`);
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
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

function searchLocalParticipant(records: LocalParticipantRecord[], raw: string, eventId: string): FoundParticipant | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isUrl = trimmed.startsWith("http");
  const normalizedPhone = trimmed.replace(/\D/g, "");
  const codes = new Set(candidateCodes(trimmed));
  const lower = trimmed.toLowerCase();
  const hasNameSearch = /[a-zA-Z]/.test(trimmed) && trimmed.length >= 3;

  const match = records.find((record) => {
    if (record.event_id !== eventId) return false;
    if (isUrl && record.qr_link === trimmed) return true;
    if (codes.has(record.code)) return true;
    if (normalizedPhone.length >= 8 && record.phone && record.phone.replace(/\D/g, "") === normalizedPhone) return true;
    if (hasNameSearch && record.name.toLowerCase().includes(lower)) return true;
    return false;
  });

  return match
    ? { id: match.id, code: match.code, name: match.name, phone: match.phone, is_checked_in: match.is_checked_in }
    : null;
}

function findExactLocalParticipant(records: LocalParticipantRecord[], raw: string, eventId: string): FoundParticipant | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isUrl = trimmed.startsWith("http");
  const normalizedPhone = trimmed.replace(/\D/g, "");
  const codes = new Set(candidateCodes(trimmed).map(c => c.toLowerCase()));
  const lower = trimmed.toLowerCase();

  const match = records.find((record) => {
    if (record.event_id !== eventId) return false;
    if (isUrl && record.qr_link === trimmed) return true;
    if (codes.has(record.code.toLowerCase())) return true;
    if (normalizedPhone.length >= 8 && record.phone && record.phone.replace(/\D/g, "") === normalizedPhone) return true;
    if (record.name.toLowerCase() === lower) return true;
    return false;
  });

  return match
    ? { id: match.id, code: match.code, name: match.name, phone: match.phone, is_checked_in: match.is_checked_in }
    : null;
}

function searchLocalSuggestions(records: LocalParticipantRecord[], raw: string, eventId: string): ParticipantSuggestion[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  const lower = trimmed.toLowerCase();
  const isUrl = trimmed.startsWith("http");
  const normalizedPhone = trimmed.replace(/\D/g, "");
  const codeCandidates = new Set(candidateCodes(trimmed));
  const byId = new Map<string, ParticipantSuggestion>();

  for (const record of records) {
    if (record.event_id !== eventId) continue;

    let hint: string | null = null;
    if (isUrl && record.qr_link?.includes(trimmed)) {
      hint = "qr";
    } else if ([...codeCandidates].some(code => record.code.toLowerCase().includes(code.toLowerCase()))) {
      hint = record.is_walkin ? "walk-in" : "code";
    } else if (record.name.toLowerCase().includes(lower)) {
      hint = record.is_walkin ? "walk-in" : "name";
    } else if (normalizedPhone.length >= 4 && record.phone?.replace(/\D/g, "").includes(normalizedPhone)) {
      hint = "phone";
    }

    if (!hint || byId.has(record.id)) continue;
    byId.set(record.id, {
      id: record.id,
      code: record.code,
      name: record.name,
      phone: record.phone,
      is_checked_in: record.is_checked_in,
      hint,
    });

    if (byId.size >= 8) break;
  }

  return [...byId.values()];
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function ActivityRecorder() {
  // ── Step machine ─────────────────────────────────────────────────────────────
  const [step, setStep] = useState<Step>("search");
  const [findStatus, setFindStatus] = useState<FindStatus>("idle");
  const [query, setQuery] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [foundParticipant, setFoundParticipant] = useState<FoundParticipant | null>(null);
  const [suggestions, setSuggestions] = useState<ParticipantSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const searchSeq = useRef(0);

  // ── Activity state ────────────────────────────────────────────────────────────
  // Activities already recorded (activity_log)
  const [doneActivityIds, setDoneActivityIds] = useState<Set<string>>(new Set());
  // Session counter for this operator shift
  const [sessionCount, setSessionCount] = useState(0);
  // Direct-record flash feedback
  const [flashId, setFlashId] = useState<string | null>(null);
  // Prevent accidental repeated taps while a record call is in-flight
  const [recordingActivityId, setRecordingActivityId] = useState<string | null>(null);
  const [sessionsByActivity, setSessionsByActivity] = useState<Record<string, ActivitySessionDisplay[]>>({});
  const localParticipantsRef = useRef<LocalParticipantRecord[]>([]);

  const { user } = useAuth();
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { online, refreshPending } = useNetwork();
  const { activeActivities, loading: activitiesLoading } = useActivities();
  const navigate = useNavigate();

  const eventId = isGuestMode ? (guestSession?.eventId ?? "") : (activeEvent?.id ?? "");

  useEffect(() => {
    let cancelled = false;

    if (!eventId) {
      localParticipantsRef.current = [];
      return;
    }

    const loadLocalParticipants = async () => {
      try {
        const [participants, walkIns] = await Promise.all([
          getOfflineParticipants(eventId),
          getAllWalkIns(),
        ]);

        if (cancelled) return;

        localParticipantsRef.current = [
          ...walkIns
            .filter(w => w.event_id === eventId)
            .map((w) => ({
              id: w.id,
              code: w.temp_code,
              name: w.name,
              phone: w.phone,
              is_checked_in: w.is_checked_in,
              event_id: w.event_id,
              qr_link: w.qr_link ?? null,
              is_walkin: true,
            })),
          ...participants.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            phone: p.phone,
            is_checked_in: p.is_checked_in,
            event_id: p.event_id,
            qr_link: p.qr_link ?? null,
          })),
        ];
      } catch {
        if (!cancelled) localParticipantsRef.current = [];
      }
    };

    void loadLocalParticipants();

    return () => {
      cancelled = true;
    };
  }, [eventId]);

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

  useEffect(() => {
    const loadSessions = async () => {
      if (!eventId || !online || activeActivities.length === 0) {
        setSessionsByActivity({});
        return;
      }

      try {
        const activityIds = activeActivities.map(a => a.id);
        const { data } = await withTimeout(
          supabase
            .from("activity_sessions")
            .select("activity_id,session_date,start_time,end_time,status")
            .eq("event_id", eventId)
            .in("activity_id", activityIds)
            .in("status", ["scheduled", "active"])
            .order("start_time")
        );

        const now = new Date();
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const groupedSessionsRaw: Record<string, Array<ActivitySessionDisplay & { priority: number; startMinutes: number }>> = {};

        (data as ActivitySessionLite[] | null ?? []).forEach((s) => {
          if (!s.activity_id || !s.start_time || !s.end_time) return;

          const startMinutes = toMinutes(s.start_time);
          const endMinutes = toMinutes(s.end_time);
          const todaySession = isSameLocalDate(s.session_date, now);
          const inTimeWindow = todaySession && nowMinutes >= startMinutes && nowMinutes < endMinutes;
          const isNow = inTimeWindow || (s.status === "active" && todaySession);

          let priority = 2;
          if (isNow) {
            priority = 0;
          } else if (todaySession && startMinutes > nowMinutes) {
            priority = 1;
          }

          if (!groupedSessionsRaw[s.activity_id]) groupedSessionsRaw[s.activity_id] = [];
          groupedSessionsRaw[s.activity_id].push({
            id: `${s.activity_id}:${s.session_date ?? "any"}:${s.start_time}:${s.end_time}`,
            label: formatSessionTimeRange(s.start_time, s.end_time),
            start_time: s.start_time,
            end_time: s.end_time,
            session_date: s.session_date,
            isNow,
            priority,
            startMinutes,
          });
        });

        const groupedSessions: Record<string, ActivitySessionDisplay[]> = {};
        Object.entries(groupedSessionsRaw).forEach(([activityId, sessions]) => {
          sessions.sort((a, b) => a.priority - b.priority || a.startMinutes - b.startMinutes);
          const deduped: ActivitySessionDisplay[] = [];
          sessions.forEach((s) => {
            const existing = deduped.find(x => x.id === s.id);
            if (!existing) {
              deduped.push({
                id: s.id,
                label: s.label,
                start_time: s.start_time,
                end_time: s.end_time,
                session_date: s.session_date,
                isNow: s.isNow,
              });
            } else if (s.isNow) {
              existing.isNow = true;
            }
          });
          groupedSessions[activityId] = deduped;
        });

        setSessionsByActivity(groupedSessions);
      } catch {
        setSessionsByActivity({});
      }
    };

    void loadSessions();
  }, [eventId, online, activeActivities]);

  const fetchSuggestions = useCallback(async (raw: string): Promise<ParticipantSuggestion[]> => {
    const trimmed = raw.trim();
    if (!trimmed || !eventId) return [];

    const byId = new Map<string, ParticipantSuggestion>();
    const add = (p: FoundParticipant, hint: string) => {
      if (!byId.has(p.id)) byId.set(p.id, { ...p, hint });
    };

    searchLocalSuggestions(localParticipantsRef.current, trimmed, eventId).forEach((p) => add(p, p.hint));

    if (byId.size >= 8 || !online) {
      return [...byId.values()].slice(0, 8);
    }

    if (online) {
      const requests: Array<Promise<{ hint: string; rows: FoundParticipant[] }>> = [];

      if (trimmed.startsWith("http") && byId.size < 8) {
        requests.push(
          withTimeout(
            supabase.from("participants").select(SEL)
              .eq("event_id", eventId)
              .eq("qr_link", trimmed)
              .limit(8)
          ).then(({ data }) => ({ hint: "qr", rows: (data ?? []) as FoundParticipant[] }))
        );
      }

      const codeCandidates = candidateCodes(trimmed);
      if (codeCandidates.length > 0 && byId.size < 8) {
        requests.push(
          withTimeout(
            supabase.from("participants").select(SEL)
              .eq("event_id", eventId)
              .in("code", codeCandidates.slice(0, 8))
              .limit(8)
          ).then(({ data }) => ({ hint: "code", rows: (data ?? []) as FoundParticipant[] }))
        );
      }

      const digits = trimmed.replace(/\D/g, "");
      if (digits.length >= 6 && byId.size < 8) {
        requests.push(
          withTimeout(
            supabase.from("participants").select(SEL)
              .eq("event_id", eventId)
              .ilike("phone", `%${digits}%`)
              .limit(8)
          ).then(({ data }) => ({ hint: "phone", rows: (data ?? []) as FoundParticipant[] }))
        );
      }

      if (/[a-zA-Z]/.test(trimmed) && trimmed.length >= 3 && byId.size < 8) {
        requests.push(
          withTimeout(
            supabase.from("participants").select(SEL)
              .eq("event_id", eventId)
              .ilike("name", `%${trimmed}%`)
              .order("name")
              .limit(8)
          ).then(({ data }) => ({ hint: "name", rows: (data ?? []) as FoundParticipant[] }))
        );
      }

      const results = await Promise.allSettled(requests);
      results.forEach((result) => {
        if (result.status !== "fulfilled") return;
        result.value.rows.forEach((p) => add(p, result.value.hint));
      });
    }

    return [...byId.values()].slice(0, 8);
  }, [eventId, online]);

  // ── Load done activities for this participant ───────────────────────────────
  const loadActivityState = useCallback(async (participantId: string) => {
    const done = new Set<string>();
    try {
      if (online) {
        const { data: logData } = await withTimeout(supabase.from("activity_logs").select("activity_id")
          .eq("participant_id", participantId).eq("event_id", eventId));
        (logData ?? []).forEach(r => { if (r.activity_id) done.add(`activity:${r.activity_id}`); });
      }
      // Offline queue check
      const queue = await getSyncQueueItems();
      queue.forEach(m => {
        if (m.type === "activity_log" && m.payload.participant_id === participantId && m.payload.activity_id) {
          done.add(`activity:${m.payload.activity_id as string}`);
        }
      });
    } catch { /* best-effort */ }
    setDoneActivityIds(done);
  }, [online, eventId]);

  const applyParticipantSelection = useCallback(async (participant: FoundParticipant) => {
    setErrorMsg("");
    setDoneActivityIds(new Set());

    if (!participant.is_checked_in) {
      setFoundParticipant(participant);
      setFindStatus("not_checked_in");
      return;
    }

    setFoundParticipant(participant);
    await loadActivityState(participant.id);
    setFindStatus("idle");
    setStep("select");
  }, [loadActivityState]);

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
      const localMatch = searchLocalParticipant(localParticipantsRef.current, trimmed, eventId);

      if (localMatch) {
        participant = localMatch;
      } else if (!online) {
        const cached = await offlineLookupParticipant(trimmed, eventId);
        if (!cached) { setFindStatus("not_found"); return; }
        participant = { id: cached.id, code: cached.code, name: cached.name, phone: cached.phone, is_checked_in: cached.is_checked_in };
      } else {
        participant = await lookupParticipantOnline(trimmed, eventId);
        if (!participant) { setFindStatus("not_found"); return; }
      }

      await applyParticipantSelection(participant);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setErrorMsg(msg.includes("timed out") ? "Request timed out. Check connection." : msg);
      setFindStatus("error");
    } finally {
      setLoading(false);
    }
  }, [online, eventId, applyParticipantSelection]);

  // ── Direct record for all activities ────────────────────────────────────────
  const directRecord = useCallback(async (activity: Activity, session?: ActivitySessionDisplay) => {
    const recordKey = session ? `session:${session.id}` : `activity:${activity.id}`;
    if (!foundParticipant || doneActivityIds.has(recordKey) || recordingActivityId) return;
    if (!isGuestMode && activeEvent?.status === "completed") {
      setErrorMsg("This event is closed. Activity timing is no longer accepting new records.");
      setFindStatus("error");
      return;
    }
    const now = new Date().toISOString();
    setRecordingActivityId(recordKey);

    try {
      if (!online) {
        const alreadyQueued = session ? false : await localActivityCheck(foundParticipant.id, activity.id);
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
        let canInsert = true;
        if (!session) {
          const { data: existing } = await withTimeout(
            supabase.from("activity_logs").select("id")
              .eq("participant_id", foundParticipant.id).eq("activity_id", activity.id).maybeSingle()
          );
          canInsert = !existing;
        }

        if (canInsert) {
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
      setFlashId(recordKey);
      setTimeout(() => setFlashId(null), 1200);
      setDoneActivityIds(prev => new Set([...prev, recordKey]));
      setSessionCount(c => c + 1);
      speak(VM.activity_success);
      trackEvent("activity_recorded", {
        eventType: "conversion",
        properties: { mode: online ? "online" : "offline", points: activity.points_value ?? 0 },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to record activity";
      setErrorMsg(msg.includes("timed out") ? "Request timed out. Check connection." : msg);
      setFindStatus("error");
    } finally {
      setRecordingActivityId(null);
    }
  }, [foundParticipant, doneActivityIds, recordingActivityId, online, user, eventId, refreshPending, isGuestMode, activeEvent]);

  // ── Handlers ──────────────────────────────────────────────────────────────────
  const selectSuggestion = useCallback(async (participant: ParticipantSuggestion) => {
    setLoading(true);
    setSuggestions([]);
    try {
      await applyParticipantSelection(participant);
    } finally {
      setLoading(false);
    }
  }, [applyParticipantSelection]);

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
    setSuggestions([]);
    setErrorMsg("");
  };

  useEffect(() => {
    if (step !== "search") return;

    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setSuggestionsLoading(false);
      if (findStatus !== "not_checked_in") setFindStatus("idle");
      return;
    }

    const seq = ++searchSeq.current;
    setSuggestionsLoading(true);
    setFindStatus("idle");

    const exactLocal = findExactLocalParticipant(localParticipantsRef.current, trimmed, eventId);
    if (exactLocal) {
      setSuggestionsLoading(false);
      void selectSuggestion({ ...exactLocal, hint: "local" });
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const result = await fetchSuggestions(trimmed);
        if (searchSeq.current !== seq) return;
        setSuggestions(result);

        const normalized = trimmed.toLowerCase();
        const exact = result.find(p =>
          p.code.toLowerCase() === normalized ||
          p.name.toLowerCase() === normalized ||
          (p.phone ? p.phone.replace(/\D/g, "") === trimmed.replace(/\D/g, "") : false)
        );
        if (exact) {
          await selectSuggestion(exact);
        }
      } catch {
        if (searchSeq.current !== seq) return;
        setSuggestions([]);
      } finally {
        if (searchSeq.current === seq) setSuggestionsLoading(false);
      }
    }, 80);

    return () => clearTimeout(timer);
  }, [query, step, fetchSuggestions, findStatus, selectSuggestion]);

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
    const activityKey = `activity:${activity.id}`;
    const isDone = doneActivityIds.has(activityKey);
    const isFlashing = flashId === activityKey;
    const isRecording = recordingActivityId === activityKey;
    const activitySessions = sessionsByActivity[activity.id] ?? [];
    const hasSessions = activitySessions.length > 0;
    const doneSessions = activitySessions.filter((s) => doneActivityIds.has(`session:${s.id}`)).length;

    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const nowSessions: ActivitySessionDisplay[] = [];
    const upcomingSessions: ActivitySessionDisplay[] = [];
    const pastSessions: ActivitySessionDisplay[] = [];

    activitySessions.forEach((s) => {
      if (s.isNow) {
        nowSessions.push(s);
        return;
      }

      if (s.session_date) {
        const sessionDay = new Date(`${s.session_date}T00:00:00`).getTime();
        if (sessionDay > todayMidnight) {
          upcomingSessions.push(s);
          return;
        }
        if (sessionDay < todayMidnight) {
          pastSessions.push(s);
          return;
        }
      }

      const start = toMinutes(s.start_time);
      if (start > nowMinutes) {
        upcomingSessions.push(s);
      } else {
        pastSessions.push(s);
      }
    });

    const renderSessionButton = (s: ActivitySessionDisplay) => {
      const sessionKey = `session:${s.id}`;
      const sessionDone = doneActivityIds.has(sessionKey);
      const sessionRecording = recordingActivityId === sessionKey;
      const sessionFlashing = flashId === sessionKey;

      return (
        <button
          key={s.id}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (sessionDone || sessionRecording) return;
            void directRecord(activity, s);
          }}
          disabled={sessionDone || sessionRecording}
          className={cn(
            "w-full text-[9px] leading-tight px-1.5 py-1 rounded border transition-colors text-left",
            sessionDone
              ? "bg-success/10 border-success/30 text-success"
              : sessionFlashing
                ? "bg-success/10 border-success/30 text-success"
                : "bg-secondary border-border text-muted-foreground hover:border-primary/40"
          )}
        >
          <span>{sessionRecording ? "Recording..." : s.label}</span>
          {s.isNow && (
            <span className="ml-1.5 inline-flex items-center rounded px-1 py-0.5 text-[8px] font-bold bg-success/20 text-success">
              Now
            </span>
          )}
        </button>
      );
    };

    const handleClick = () => {
      if (isDone || isRecording) return;
      if (hasSessions) return;
      directRecord(activity);
    };

    return (
      <div
        onClick={handleClick}
        className={cn(
          "relative flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 transition-all duration-200 text-center",
          isDone
            ? "border-success/40 bg-success/5 opacity-70 cursor-not-allowed"
            : isFlashing
              ? "border-success bg-success/20 scale-95"
              : hasSessions
                ? "border-primary/30 bg-primary/5"
                : "border-primary/40 bg-primary/5 hover:border-primary hover:bg-primary/10 active:scale-95 cursor-pointer"
        )}
      >
        <div className="p-1.5 rounded-lg" style={{ backgroundColor: isDone ? undefined : `${color}25` }}>
          <Icon className="h-4 w-4" style={{ color: isDone ? "hsl(var(--success))" : color }} />
        </div>
        <span className="text-xs font-semibold text-foreground leading-tight">{activity.name}</span>
        <span className="text-[10px] text-muted-foreground">{isRecording ? "Recording..." : `${activity.points_value} pts`}</span>

        {activitySessions.length > 0 && (
          <div className="w-full mt-1 space-y-1">
            {nowSessions.length > 0 && (
              <div className="space-y-1">
                <span className="block text-[9px] font-semibold text-success">Now</span>
                {nowSessions.map(renderSessionButton)}
              </div>
            )}
            {upcomingSessions.length > 0 && (
              <div className="space-y-1">
                <span className="block text-[9px] font-semibold text-primary">Upcoming</span>
                {upcomingSessions.map(renderSessionButton)}
              </div>
            )}
            {pastSessions.length > 0 && (
              <div className="space-y-1">
                <span className="block text-[9px] font-semibold text-muted-foreground">Past</span>
                {pastSessions.map(renderSessionButton)}
              </div>
            )}
            <span className="block text-[9px] text-muted-foreground">{doneSessions}/{activitySessions.length} session(s) recorded</span>
          </div>
        )}

        {!hasSessions && (
          <span className="text-[9px] text-muted-foreground">Tap to record</span>
        )}

        {/* Corner indicator */}
        <div className="absolute top-1.5 right-1.5">
          {isDone
            ? <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            : <Zap className="h-3.5 w-3.5 text-primary" />}
        </div>

        {/* "Done" label */}
        {isDone && !hasSessions && (
          <span className="absolute bottom-1 left-0 right-0 text-[9px] font-bold text-success text-center">Done</span>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <AppLayout title="Activity Recorder" subtitle="Log participant experience at each zone">
      <div className="max-w-2xl mx-auto space-y-6">
        <>

          {/* ── Step 1: Search ────────────────────────────────────────────────── */}
          {(step === "search" || findStatus !== "idle") && (
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-4">
                Find Participant
              </h3>

              <div className="space-y-3">
                <Input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Code, name, phone, or QR link"
                  className="h-14 pl-4 pr-4 text-lg font-semibold bg-secondary border-2 focus:border-primary scan-pulse"
                  autoFocus
                  disabled={loading}
                  autoComplete="off"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && suggestions.length > 0) {
                      e.preventDefault();
                      void selectSuggestion(suggestions[0]);
                    }
                  }}
                />
                <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Hash className="h-2.5 w-2.5" />Code</span>
                  <span className="flex items-center gap-1"><User className="h-2.5 w-2.5" />Name</span>
                  <span className="flex items-center gap-1"><Phone className="h-2.5 w-2.5" />Phone</span>
                  <span className="flex items-center gap-1"><QrCode className="h-2.5 w-2.5" />QR link</span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setShowScanner(true)}
                    disabled={loading}
                    className="h-12 font-bold uppercase tracking-wider gap-2"
                  >
                    <QrCode className="h-4 w-4" />Open Scanner
                  </Button>
                </div>
              </div>

              {(suggestionsLoading || suggestions.length > 0 || (query.trim().length >= 2 && !loading)) && (
                <div className="mt-4 rounded-xl border border-border bg-secondary/30 p-2 space-y-1">
                  {suggestionsLoading && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">Searching participants...</p>
                  )}

                  {!suggestionsLoading && suggestions.length === 0 && query.trim().length >= 2 && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">No participant suggestion yet.</p>
                  )}

                  {!suggestionsLoading && suggestions.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => void selectSuggestion(p)}
                      className="w-full text-left rounded-lg px-3 py-2 hover:bg-secondary transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-foreground truncate">{p.name}</p>
                        <span className={cn(
                          "text-[10px] px-2 py-0.5 rounded font-semibold",
                          p.is_checked_in ? "bg-success/20 text-success" : "bg-destructive/15 text-destructive"
                        )}>
                          {p.is_checked_in ? "Checked-in" : "Not checked-in"}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                        <span className="font-mono">#{p.code}</span>
                        {p.phone && <span>{p.phone}</span>}
                        <span className="uppercase tracking-wide">{p.hint}</span>
                      </div>
                    </button>
                  ))}
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
                  Choose Activity
                </h3>
                <ParticipantCard />
              </div>

              {/* Legend */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-success" />Done</span>
                <span className="flex items-center gap-1"><Zap className="h-3 w-3 text-primary" />Tap to record</span>
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

        </>
      </div>

      {showScanner && (
        <QrScannerModal onScan={handleQrScan} onClose={() => setShowScanner(false)} />
      )}
    </AppLayout>
  );
}
