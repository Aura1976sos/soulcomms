import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw, AlertTriangle, CheckCircle2, Inbox, Trash2, X,
  Users, Activity, UserCheck, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getQueueStats, getSyncQueueItems, dismissAllFailed, dismissSyncMutation,
  flushQueue, QueueStats, SyncMutation,
} from "@/lib/offlineStore";
import { useNetwork } from "@/contexts/NetworkContext";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  register_walkin: "Walk-In Registration",
  register_walkin_crew: "Crew Walk-In",
  register_walkin_sp: "SP Walk-In",
  register_qr: "QR Registration",
  checkin_participant: "Participant Check-In",
  checkin_sp: "SP Check-In",
  checkin_crew: "Crew Check-In",
  activity_log: "Activity Record",
  session_participation: "Session Ticket",
};

export function SyncPanel() {
  const { online } = useNetwork();

  const [stats, setStats] = useState<QueueStats>({ total: 0, walkIns: 0, checkIns: 0, activities: 0 });
  const [items, setItems] = useState<SyncMutation[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [q, i] = await Promise.all([
      getQueueStats(),
      getSyncQueueItems(),
    ]);
    setStats(q);
    setItems(i);
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15_000);
    return () => clearInterval(id);
  }, [refresh]);

  const handleFlush = async () => {
    if (!online || flushing) return;
    setFlushing(true);
    const { synced, failed } = await flushQueue();
    setLastSync(`${synced} synced · ${failed} failed · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    await refresh();
    setFlushing(false);
  };

  const handleDismissAll = async () => {
    await dismissAllFailed();
    await refresh();
  };

  const handleDismissOne = async (id: string) => {
    await dismissSyncMutation(id);
    await refresh();
  };

  const failedItems = items.filter(m => m.retries >= 1);
  const pendingItems = items.filter(m => m.retries === 0);

  if (stats.total === 0 && failedItems.length === 0) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-success/10 border border-success/20 text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        <span className="text-xs font-semibold">All data synced</span>
        {lastSync && <span className="text-[10px] text-success/70 ml-auto">{lastSync}</span>}
      </div>
    );
  }

  return (
    <div className="glass-card rounded-2xl overflow-hidden border border-border">
      {/* Summary bar */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full px-5 py-4 flex items-center gap-3 hover:bg-secondary/50 transition-colors text-left"
      >
        <div className={cn(
          "w-2 h-2 rounded-full shrink-0",
          failedItems.length > 0 ? "bg-destructive animate-pulse" : "bg-amber-400 animate-pulse"
        )} />

        <div className="flex-1 flex items-center gap-4 flex-wrap">
          <span className="text-sm font-bold text-foreground">
            {stats.total} pending sync {stats.total === 1 ? "item" : "items"}
          </span>

          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {stats.walkIns > 0 && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{stats.walkIns} walk-ins</span>}
            {stats.checkIns > 0 && <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />{stats.checkIns} check-ins</span>}
            {stats.activities > 0 && <span className="flex items-center gap-1"><Activity className="h-3 w-3" />{stats.activities} activities</span>}
          </div>

          {failedItems.length > 0 && (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-destructive/10 border border-destructive/20 text-[10px] font-bold text-destructive">
              <AlertTriangle className="h-2.5 w-2.5" />
              {failedItems.length} failed
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {online && (
            <Button
              size="sm"
              onClick={e => { e.stopPropagation(); handleFlush(); }}
              disabled={flushing}
              className="h-7 text-xs gap-1.5 bg-primary text-primary-foreground"
            >
              <RefreshCw className={cn("h-3 w-3", flushing && "animate-spin")} />
              {flushing ? "Syncing…" : "Sync Now"}
            </Button>
          )}
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {/* Detail panel */}
      {expanded && (
        <div className="border-t border-border px-5 py-4 space-y-4">

          {/* Pending (not yet attempted or will retry) */}
          {pendingItems.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground mb-2">
                Pending ({pendingItems.length})
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {pendingItems.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary text-xs">
                    <Inbox className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-foreground">{TYPE_LABELS[m.type] ?? m.type}</span>
                    <span className="text-muted-foreground shrink-0">
                      {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Failed items */}
          {failedItems.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold uppercase tracking-[2px] text-destructive">
                  Failed ({failedItems.length})
                </p>
                <button
                  onClick={handleDismissAll}
                  className="text-[10px] text-destructive hover:underline flex items-center gap-1"
                >
                  <Trash2 className="h-2.5 w-2.5" />Dismiss All
                </button>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {failedItems.map(m => (
                  <div key={m.id} className="flex items-start gap-3 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
                    <AlertTriangle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-foreground">{TYPE_LABELS[m.type] ?? m.type}</p>
                      {m.error_message && (
                        <p className="text-[10px] text-muted-foreground truncate">{m.error_message}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground">
                        {m.retries} retr{m.retries === 1 ? "y" : "ies"}{m.last_error_at ? ` · last: ${new Date(m.last_error_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => handleDismissOne(m.id)}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {lastSync && (
            <p className="text-[10px] text-muted-foreground text-right">{lastSync}</p>
          )}
        </div>
      )}
    </div>
  );
}
