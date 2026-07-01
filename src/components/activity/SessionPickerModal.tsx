import { useState, useEffect, useCallback } from "react";
import {
  X, Clock, Users, MapPin, Plus, Trash2, Calendar, Ticket,
  CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { queueMutation } from "@/lib/offlineStore";
import { cn } from "@/lib/utils";
import { ActivityReceipt, type ReceiptData } from "./ActivityReceipt";
import type { Activity } from "@/contexts/ActivitiesContext";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ActivitySession {
  id: string;
  activity_id: string;
  event_id: string;
  session_date: string | null;
  start_time: string;
  end_time: string;
  capacity: number | null;
  location: string | null;
  status: "scheduled" | "active" | "completed" | "cancelled";
}

interface Participant {
  id: string | null;
  code: string;
  name: string;
  phone?: string | null;
}

type ModalStep = "pick" | "generating" | "receipt";

interface Props {
  activity: Activity;
  participant: Participant;
  eventId: string;
  eventName: string;
  staffName: string;
  online: boolean;
  onClose: () => void;
  onDone?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(t: string) {
  const [h, m] = t.split(":");
  const hour = parseInt(h);
  return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
}

function fmtTimeRange(start: string, end: string) {
  return `${fmt(start)} – ${fmt(end)}`;
}

/** Build deterministic participation code: ACT-HHMM-CODE */
function buildParticipationCode(actCode: string, startTime: string, participantCode: string): string {
  const timeDigits = startTime.replace(":", "").slice(0, 4);
  const pCode = participantCode.replace(/\D/g, "").padStart(4, "0");
  const actPrefix = actCode.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
  return `${actPrefix}-${timeDigits}-${pCode}`;
}

// ─── Session Picker Modal ─────────────────────────────────────────────────────
export function SessionPickerModal({
  activity, participant, eventId, eventName, staffName, online, onClose, onDone,
}: Props) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [step, setStep] = useState<ModalStep>("pick");
  const [selectedSession, setSelectedSession] = useState<ActivitySession | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);

  // ── Load sessions ──────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    setLoadingSessions(true);
    if (!online) { setSessions([]); setLoadingSessions(false); return; }
    const { data } = await supabase
      .from("activity_sessions")
      .select("*")
      .eq("activity_id", activity.id)
      .eq("event_id", eventId)
      .in("status", ["scheduled", "active"])
      .order("start_time");
    setSessions((data ?? []) as ActivitySession[]);
    setLoadingSessions(false);
  }, [activity.id, eventId, online]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Build and show receipt ─────────────────────────────────────────────────
  const showReceipt = useCallback((session: ActivitySession, code: string) => {
    setReceipt({
      participantName: participant.name,
      participantCode: participant.code,
      participantPhone: participant.phone,
      activityName: activity.name,
      sessionDate: session.session_date,
      startTime: session.start_time,
      endTime: session.end_time,
      location: session.location,
      participationCode: code,
      generatedBy: staffName,
      eventName,
      generatedAt: new Date().toISOString(),
    });
    setStep("receipt");
  }, [participant, activity, staffName, eventName]);

  // ── Generate code and record participation ─────────────────────────────────
  const generateCode = useCallback(async () => {
    if (!selectedSession) return;
    setStep("generating");
    setErrorMsg(null);

    const session = selectedSession;
    const participationCode = buildParticipationCode(activity.code, session.start_time, participant.code);
    const now = new Date().toISOString();

    try {
      if (online) {
        // Check for existing record for this participant+session
        const { data: existing } = await supabase
          .from("session_participations")
          .select("id, participation_code")
          .eq("session_id", session.id)
          .eq("event_id", eventId)
          .eq("participant_code", participant.code)
          .maybeSingle();

        if (existing) {
          showReceipt(session, existing.participation_code as string);
          return;
        }

        const { error } = await supabase.from("session_participations").insert({
          session_id: session.id,
          activity_id: activity.id,
          event_id: eventId,
          participant_id: participant.id,
          participant_code: participant.code,
          participant_name: participant.name,
          participation_code: participationCode,
          generated_by: user?.id ?? null,
          generated_at: now,
          status: "generated",
        });

        if (error) {
          if (error.code === "23505") {
            setErrorMsg("Ticket already generated for this session.");
            setStep("pick");
            return;
          }
          throw error;
        }
      } else {
        await queueMutation("session_participation" as Parameters<typeof queueMutation>[0], {
          session_id: session.id,
          activity_id: activity.id,
          event_id: eventId,
          participant_id: participant.id ?? null,
          participant_code: participant.code,
          participant_name: participant.name,
          participation_code: participationCode,
          generated_by: user?.id ?? null,
          generated_at: now,
          status: "generated",
        });
      }

      showReceipt(session, participationCode);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to generate ticket. Try again.");
      setStep("pick");
    }
  }, [selectedSession, activity, participant, eventId, user, online, showReceipt]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      {step !== "receipt" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-card border border-border rounded-2xl overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-black uppercase tracking-[2px] text-muted-foreground">Session Ticket</p>
                <p className="text-base font-black text-foreground truncate">{activity.name}</p>
                <p className="text-xs text-muted-foreground">{participant.name} · #{participant.code}</p>
              </div>
              <button onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:bg-secondary shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5">
              {/* Error banner */}
              {errorMsg && (
                <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/20 px-4 py-3 mb-4">
                  <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
                  <p className="text-xs text-destructive">{errorMsg}</p>
                </div>
              )}

              {step === "pick" && (
                <>
                  {loadingSessions ? (
                    <div className="space-y-2">
                      {[1, 2, 3].map(i => <div key={i} className="h-16 rounded-xl bg-secondary animate-pulse" />)}
                    </div>
                  ) : !online ? (
                    <div className="py-8 text-center space-y-2">
                      <AlertCircle className="h-6 w-6 text-amber-500 mx-auto" />
                      <p className="text-sm text-muted-foreground">Offline — sessions unavailable.</p>
                      <p className="text-xs text-muted-foreground">Ticket will be queued for sync.</p>
                    </div>
                  ) : sessions.length === 0 ? (
                    <div className="py-8 text-center space-y-2">
                      <Calendar className="h-6 w-6 text-muted-foreground mx-auto" />
                      <p className="text-sm text-muted-foreground">No open sessions for this activity.</p>
                      <p className="text-xs text-muted-foreground">Ask an admin to add sessions in the Activities page.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Select a Session
                      </p>
                      {/* Radio session cards */}
                      <div className="space-y-2">
                        {sessions.map(s => {
                          const isSelected = selectedSession?.id === s.id;
                          return (
                            <button
                              key={s.id}
                              onClick={() => setSelectedSession(s)}
                              className={cn(
                                "w-full flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition-all",
                                isSelected
                                  ? "border-primary bg-primary/10"
                                  : "border-border bg-secondary hover:border-primary/40"
                              )}
                            >
                              {/* Radio indicator */}
                              <div className={cn(
                                "w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center",
                                isSelected ? "border-primary" : "border-muted-foreground/40"
                              )}>
                                {isSelected && <div className="w-2 h-2 rounded-full bg-primary" />}
                              </div>
                              <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
                                <Clock className="h-4 w-4 text-primary" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-bold text-foreground">
                                  {fmtTimeRange(s.start_time, s.end_time)}
                                </p>
                                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                  {s.session_date && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Calendar className="h-2.5 w-2.5" />
                                      {new Date(s.session_date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                    </span>
                                  )}
                                  {s.location && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <MapPin className="h-2.5 w-2.5" />{s.location}
                                    </span>
                                  )}
                                  {s.capacity && (
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                      <Users className="h-2.5 w-2.5" />Cap: {s.capacity}
                                    </span>
                                  )}
                                  <span className={cn(
                                    "text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
                                    s.status === "active"
                                      ? "text-success bg-success/10 border-success/30"
                                      : "text-muted-foreground bg-secondary border-border"
                                  )}>
                                    {s.status}
                                  </span>
                                </div>
                              </div>
                              {isSelected && <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />}
                            </button>
                          );
                        })}
                      </div>

                      {/* Generate button */}
                      <Button
                        onClick={generateCode}
                        disabled={!selectedSession}
                        className={cn(
                          "w-full h-12 font-bold uppercase tracking-wider gap-2 mt-2",
                          selectedSession
                            ? "bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90"
                            : "bg-secondary text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        <Ticket className="h-4 w-4" />
                        Generate Activity Code
                      </Button>
                    </div>
                  )}
                </>
              )}

              {step === "generating" && (
                <div className="py-10 flex flex-col items-center gap-4">
                  <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                  <p className="text-sm text-muted-foreground">Generating ticket…</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Receipt overlay */}
      {step === "receipt" && receipt && (
        <ActivityReceipt
          data={receipt}
          onClose={onClose}
          onNewParticipant={onDone}
        />
      )}
    </>
  );
}

// ─── Session Manager (for Activities page) ────────────────────────────────────
interface SessionManagerProps {
  activity: Activity;
  eventId: string;
  staffId?: string;
  onClose: () => void;
}

export function SessionManager({ activity, eventId, staffId, onClose }: SessionManagerProps) {
  const [sessions, setSessions] = useState<ActivitySession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    session_date: "", start_time: "10:00", end_time: "11:00",
    capacity: "", location: "", status: "scheduled" as ActivitySession["status"],
  });

  const loadSessions = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("activity_sessions")
      .select("*")
      .eq("activity_id", activity.id)
      .eq("event_id", eventId)
      .order("start_time");
    setSessions((data ?? []) as ActivitySession[]);
    setLoading(false);
  }, [activity.id, eventId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const handleAdd = async () => {
    if (!form.start_time || !form.end_time) return;
    setSaving(true);
    const { error } = await supabase.from("activity_sessions").insert({
      activity_id: activity.id,
      event_id: eventId,
      session_date: form.session_date || null,
      start_time: form.start_time,
      end_time: form.end_time,
      capacity: form.capacity ? parseInt(form.capacity) : null,
      location: form.location || null,
      status: form.status,
      created_by: staffId ?? null,
    });
    setSaving(false);
    if (!error) { setShowAdd(false); await loadSessions(); }
  };

  const handleDelete = async (id: string) => {
    await supabase.from("activity_sessions").delete().eq("id", id);
    await loadSessions();
  };

  const handleStatusChange = async (id: string, status: ActivitySession["status"]) => {
    await supabase.from("activity_sessions").update({ status }).eq("id", id);
    await loadSessions();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-card border border-border rounded-2xl overflow-hidden shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-black uppercase tracking-[2px] text-muted-foreground">Sessions</p>
            <p className="text-sm font-black text-foreground truncate">{activity.name}</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(v => !v)} className="gap-1.5 bg-primary text-primary-foreground text-xs">
            <Plus className="h-3.5 w-3.5" />Add Session
          </Button>
          <button onClick={onClose} className="p-2 rounded-lg text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {showAdd && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-xs font-black text-foreground uppercase tracking-widest">New Session</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="field-label">Date (optional)</label>
                  <Input type="date" value={form.session_date}
                    onChange={e => setForm(f => ({ ...f, session_date: e.target.value }))}
                    className="bg-secondary border-border focus:border-primary text-xs" />
                </div>
                <div>
                  <label className="field-label">Location</label>
                  <Input value={form.location}
                    onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                    placeholder="Hall A" className="bg-secondary border-border focus:border-primary text-xs" />
                </div>
                <div>
                  <label className="field-label">Start Time *</label>
                  <Input type="time" value={form.start_time}
                    onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))}
                    className="bg-secondary border-border focus:border-primary text-xs" />
                </div>
                <div>
                  <label className="field-label">End Time *</label>
                  <Input type="time" value={form.end_time}
                    onChange={e => setForm(f => ({ ...f, end_time: e.target.value }))}
                    className="bg-secondary border-border focus:border-primary text-xs" />
                </div>
                <div>
                  <label className="field-label">Capacity (optional)</label>
                  <Input type="number" min={1} value={form.capacity}
                    onChange={e => setForm(f => ({ ...f, capacity: e.target.value }))}
                    placeholder="e.g. 50" className="bg-secondary border-border focus:border-primary text-xs" />
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select value={form.status}
                    onChange={e => setForm(f => ({ ...f, status: e.target.value as ActivitySession["status"] }))}
                    className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-xs text-foreground focus:outline-none focus:border-primary">
                    <option value="scheduled">Scheduled</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowAdd(false)} className="flex-1 border-border text-xs">Cancel</Button>
                <Button size="sm" onClick={handleAdd} disabled={saving || !form.start_time || !form.end_time}
                  className="flex-1 bg-primary text-primary-foreground text-xs">
                  {saving ? "Saving…" : "Add"}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-2">{[1,2].map(i => <div key={i} className="h-14 rounded-xl bg-secondary animate-pulse" />)}</div>
          ) : sessions.length === 0 ? (
            <div className="py-8 text-center">
              <Calendar className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No sessions yet. Add the first one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map(s => (
                <div key={s.id} className="flex items-center gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground">{fmtTimeRange(s.start_time, s.end_time)}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {s.session_date && <span className="text-[10px] text-muted-foreground">{s.session_date}</span>}
                      {s.location && <span className="text-[10px] text-muted-foreground">{s.location}</span>}
                      {s.capacity && <span className="text-[10px] text-muted-foreground">Cap {s.capacity}</span>}
                    </div>
                  </div>
                  <select value={s.status} onChange={e => handleStatusChange(s.id, e.target.value as ActivitySession["status"])}
                    className="h-7 text-[10px] px-2 rounded-lg bg-card border border-border text-foreground focus:outline-none focus:border-primary">
                    <option value="scheduled">Scheduled</option>
                    <option value="active">Active</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <button onClick={() => handleDelete(s.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
