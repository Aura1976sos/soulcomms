import { CheckCircle, Clock, Hash, Undo2 } from "lucide-react";
import { ActivityBadge } from "@/components/shared/ActivityBadge";
import { Button } from "@/components/ui/button";

interface ActivityLog {
  id: string;
  experience: string;
  recorded_at: string;
}

export interface UncheckHistoryRecord {
  id: string;
  unchecked_by_name?: string | null;
  unchecked_at: string;
  reason?: string | null;
  original_checked_in_at?: string | null;
}

interface ParticipantCardProps {
  code: string;
  name: string;
  email?: string;
  phone?: string;
  isCheckedIn: boolean;
  checkedInAt?: string;
  activities: ActivityLog[];
  canUncheck?: boolean;
  uncheckHistory?: UncheckHistoryRecord[];
  onUncheck?: () => void;
}

export const ParticipantCard = ({
  code, name, email, phone, isCheckedIn, checkedInAt, activities,
  canUncheck = false, uncheckHistory = [], onUncheck,
}: ParticipantCardProps) => {
  return (
    <div className="glass-card rounded-xl overflow-hidden slide-up">
      {/* Header */}
      <div className="bg-primary/10 border-b border-primary/20 px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center text-primary-foreground font-black text-lg shrink-0">
            {name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-xl font-bold text-foreground">{name}</h3>
            {email && <p className="text-sm text-muted-foreground truncate">{email}</p>}
            {phone && <p className="text-xs text-muted-foreground">{phone}</p>}
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-black text-primary">{activities.length}</p>
            <p className="text-xs text-muted-foreground uppercase tracking-wider">
              {activities.length === 1 ? "experience" : "experiences"}
            </p>
          </div>
        </div>
      </div>

      {/* Info row */}
      <div className="px-6 py-4 flex flex-wrap gap-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Hash className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-mono font-bold text-primary">TG100 #{code}</span>
        </div>
        <div className="flex items-center gap-2">
          {isCheckedIn ? (
            <>
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-sm text-success font-medium">Checked In</span>
            </>
          ) : (
            <>
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Not Checked In</span>
            </>
          )}
          {checkedInAt && (
            <span className="text-xs text-muted-foreground">
              {new Date(checkedInAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
          )}
        </div>
      </div>

      {/* Uncheck action */}
      {isCheckedIn && canUncheck && onUncheck && (
        <div className="px-6 py-3 border-b border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={onUncheck}
            className="w-full gap-2 border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500 hover:text-amber-500"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Uncheck Participant
          </Button>
        </div>
      )}

      {/* Activity log */}
      <div className="px-6 py-4 border-b border-border last:border-0">
        <h4 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-3">Activity History</h4>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No activities recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {activities.map(log => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <ActivityBadge experienceId={log.experience} size="sm" />
                <span className="text-xs text-muted-foreground">
                  {new Date(log.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Uncheck history */}
      {uncheckHistory.length > 0 && (
        <div className="px-6 py-4">
          <h4 className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-3">Uncheck History</h4>
          <div className="space-y-2">
            {uncheckHistory.map(h => (
              <div key={h.id} className="rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5 space-y-0.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400">
                    {h.original_checked_in_at
                      ? `Checked in ${new Date(h.original_checked_in_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                      : "Previously checked in"}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {new Date(h.unchecked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Unchecked by <span className="text-foreground font-medium">{h.unchecked_by_name ?? "Unknown"}</span>
                  {h.reason && <> · <span className="italic">{h.reason}</span></>}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
