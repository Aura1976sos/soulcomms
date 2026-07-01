import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, RotateCcw, X, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface ResetAttendanceModalProps {
  eventId: string;
  eventName: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface ResetResult {
  participants: number;
  crew: number;
  service_providers: number;
  activity_logs: number;
}

export function ResetAttendanceModal({ eventId, eventName, onClose, onSuccess }: ResetAttendanceModalProps) {
  const { user, profile } = useAuth();

  const [resetParticipants, setResetParticipants] = useState(true);
  const [resetCrew, setResetCrew] = useState(true);
  const [resetSPs, setResetSPs] = useState(true);
  const [resetActivityLogs, setResetActivityLogs] = useState(true);
  const [reason, setReason] = useState("Testing Reset");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);

  const handleReset = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("reset_event_attendance", {
      p_event_id:             eventId,
      p_reset_participants:   resetParticipants,
      p_reset_crew:           resetCrew,
      p_reset_sps:            resetSPs,
      p_reset_activity_logs:  resetActivityLogs,
      p_reason:               reason.trim() || "Testing Reset",
      p_staff_id:             user.id,
      p_staff_name:           profile?.name ?? "Unknown",
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setResult(data as ResetResult);
    onSuccess();
  };

  const CheckOption = ({
    checked, onChange, label,
  }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <label className="flex items-center gap-3 cursor-pointer group">
      <div
        onClick={() => onChange(!checked)}
        className={cn(
          "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors shrink-0",
          checked ? "bg-primary border-primary" : "border-border bg-secondary group-hover:border-primary/50"
        )}
      >
        {checked && <CheckCircle2 className="h-3 w-3 text-primary-foreground" />}
      </div>
      <span className="text-sm text-foreground font-medium">{label}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl slide-up">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-destructive/10 border border-destructive/20">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Reset Attendance</p>
              <p className="text-xs text-muted-foreground truncate max-w-[200px]">{eventName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {result ? (
          /* Success state */
          <div className="px-6 pb-6 space-y-4">
            <div className="p-4 rounded-xl bg-success/10 border border-success/20 space-y-3">
              <p className="text-sm font-bold text-success">Attendance reset successfully</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                {result.participants > 0 && <span>{result.participants} participants unchecked</span>}
                {result.crew > 0 && <span>{result.crew} crew unchecked</span>}
                {result.service_providers > 0 && <span>{result.service_providers} providers unchecked</span>}
                {result.activity_logs > 0 && <span>{result.activity_logs} activity records cleared</span>}
              </div>
              <p className="text-xs text-muted-foreground">Participant records remain intact.</p>
            </div>
            <Button onClick={onClose} className="w-full">Done</Button>
          </div>
        ) : (
          <div className="px-6 pb-6 space-y-4">
            {/* Warning */}
            <div className="p-3 rounded-xl bg-destructive/8 border border-destructive/20">
              <p className="text-xs text-destructive leading-relaxed">
                This will remove attendance records but will <strong>not</strong> delete participants, crew, or service providers. This action cannot be undone.
              </p>
            </div>

            {/* What to reset */}
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reset scope</p>
              <div className="space-y-2.5">
                <CheckOption checked={resetParticipants} onChange={setResetParticipants} label="Participant Check-Ins + Leaderboard Points" />
                <CheckOption checked={resetCrew} onChange={setResetCrew} label="Crew Check-Ins" />
                <CheckOption checked={resetSPs} onChange={setResetSPs} label="Service Provider Check-Ins" />
                <CheckOption checked={resetActivityLogs} onChange={setResetActivityLogs} label="Activity Attendance Logs" />
              </div>
            </div>

            {/* Reason */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Reason</label>
              <Textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                rows={2}
                placeholder="e.g. Testing Reset, Rehearsal..."
                className="resize-none bg-secondary border-border text-sm focus:border-primary"
              />
            </div>

            {error && (
              <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <Button variant="outline" onClick={onClose} className="flex-1 border-border text-muted-foreground">
                Cancel
              </Button>
              <Button
                onClick={handleReset}
                disabled={loading || (!resetParticipants && !resetCrew && !resetSPs && !resetActivityLogs)}
                variant="destructive"
                className="flex-1 gap-2"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <RotateCcw className="h-4 w-4" />
                )}
                {loading ? "Resetting…" : "Confirm Reset"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
