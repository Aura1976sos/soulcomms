import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, Undo2, X } from "lucide-react";

export type UncheckRecordType = "participant" | "crew" | "service_provider";

interface UncheckModalProps {
  type: UncheckRecordType;
  id: string;
  name: string;
  code: string;
  checkedInAt?: string | null;
  eventId: string;
  onClose: () => void;
  onSuccess: () => void;
}

const TABLE_MAP: Record<UncheckRecordType, string> = {
  participant: "participants",
  crew: "crew_members",
  service_provider: "service_providers",
};

const LABEL_MAP: Record<UncheckRecordType, string> = {
  participant: "Participant",
  crew: "Crew Member",
  service_provider: "Service Provider",
};

export function UncheckModal({
  type, id, name, code, checkedInAt, eventId, onClose, onSuccess,
}: UncheckModalProps) {
  const { user, profile } = useAuth();
  const [reason, setReason] = useState("Testing Reset");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = LABEL_MAP[type];
  const table = TABLE_MAP[type];

  const handleUncheck = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Reset check-in status
      const { error: updateError } = await supabase
        .from(table)
        .update({ is_checked_in: false, checked_in_at: null, check_in_method: null })
        .eq("id", id);

      if (updateError) throw updateError;

      // 2. Insert history record
      await supabase.from("checkin_history").insert({
        event_id: eventId,
        record_type: type,
        record_id: id,
        record_name: name,
        record_code: code,
        original_checked_in_at: checkedInAt || null,
        unchecked_by: user.id,
        unchecked_by_name: profile?.name ?? "Unknown",
        reason: reason.trim() || "Manual Uncheck",
      });

      // 3. Audit log
      await supabase.from("staff_audit_logs").insert({
        staff_id: user.id,
        staff_name: profile?.name ?? "Unknown",
        action: "uncheck_individual",
        event_id: eventId,
        details: {
          record_type: type,
          record_id: id,
          record_name: name,
          record_code: code,
          reason: reason.trim() || "Manual Uncheck",
        },
      });

      onSuccess();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to uncheck");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Uncheck {label}</p>
              <p className="text-xs text-muted-foreground">This will reverse their check-in</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {/* Participant info */}
          <div className="p-4 rounded-xl bg-secondary border border-border space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-foreground">{name}</span>
              <span className="text-xs font-mono font-bold text-primary">#{code}</span>
            </div>
            {checkedInAt && (
              <p className="text-xs text-muted-foreground">
                Checked in at {new Date(checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
            )}
          </div>

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground uppercase tracking-wider">Reason</label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
              placeholder="e.g. Testing Reset, Accidental Check-In..."
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
              onClick={handleUncheck}
              disabled={loading}
              className="flex-1 gap-2 bg-amber-500 hover:bg-amber-600 text-white border-0"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <Undo2 className="h-4 w-4" />
              )}
              {loading ? "Processing…" : `Uncheck ${label}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
