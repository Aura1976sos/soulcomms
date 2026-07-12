import { useState } from "react";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { Wifi, WifiOff, RefreshCw, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PendingQueueDrawer } from "./PendingQueueDrawer";
import { format, formatDistanceToNow } from "date-fns";

export function SyncStatusBar() {
  const {
    online, queueStats, syncing, lastSync,
    syncError, syncErrorMsg, nextRetryIn,
    triggerSync,
  } = useNetwork();
  const { role } = useAuth();
  const { lastEventSync } = useEvent();
  const [queueOpen, setQueueOpen] = useState(false);

  const isAdmin = role === "admin" || role === "event_admin";
  const pending = queueStats.total;

  // ── Offline ────────────────────────────────────────────────────────────────
  if (!online) {
    const parts: string[] = [];
    if (queueStats.walkIns > 0) parts.push(`${queueStats.walkIns} reg`);
    if (queueStats.checkIns > 0) parts.push(`${queueStats.checkIns} check-in${queueStats.checkIns > 1 ? "s" : ""}`);
    if (queueStats.activities > 0) parts.push(`${queueStats.activities} activit${queueStats.activities > 1 ? "ies" : "y"}`);

    return (
      <div className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-lg text-xs font-semibold",
        "bg-amber-500/10 border border-amber-500/30 text-amber-400"
      )}>
        <WifiOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-bold">
            Offline Mode Active{parts.length > 0 ? ` · ${parts.join(" · ")} queued` : ""}
          </span>
          <span className="text-[10px] font-normal text-amber-400/70 hidden sm:block leading-tight">
            All event operations available · Syncs automatically when online
          </span>
          {lastEventSync && (
            <span className="text-[10px] font-normal text-amber-400/50 hidden sm:block">
              Last sync: {format(lastEventSync, "MMM d, yyyy h:mm a")}
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Syncing ────────────────────────────────────────────────────────────────
  if (syncing) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/10 border border-blue-500/30 text-blue-400">
        <RefreshCw className="h-3.5 w-3.5 animate-spin shrink-0" />
        <span>Syncing {pending} record{pending !== 1 ? "s" : ""}…</span>
      </div>
    );
  }

  // ── Sync failed ────────────────────────────────────────────────────────────
  if (syncError) {
    return (
      <>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive/10 border border-destructive/30 text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">
            Sync failed{syncErrorMsg ? ` · ${syncErrorMsg}` : ""}
            {nextRetryIn > 0 && (
              <span className="text-destructive/70 ml-1">· retry in {nextRetryIn}s</span>
            )}
          </span>
          <span className="sm:hidden">
            Failed{nextRetryIn > 0 ? ` · ${nextRetryIn}s` : ""}
          </span>
          <Button variant="ghost" size="sm" onClick={triggerSync}
            className="h-5 px-2 text-[10px] text-destructive hover:text-destructive">
            <RefreshCw className="h-3 w-3 mr-0.5" />Retry
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setQueueOpen(true)}
              className="h-5 px-2 text-[10px] text-destructive/70 hover:text-destructive">
              View
            </Button>
          )}
        </div>
        <PendingQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
      </>
    );
  }

  // ── Online – sync pending ──────────────────────────────────────────────────
  if (online && pending > 0) {
    const parts: string[] = [];
    if (queueStats.walkIns > 0) parts.push(`${queueStats.walkIns} reg`);
    if (queueStats.checkIns > 0) parts.push(`${queueStats.checkIns} check-in${queueStats.checkIns > 1 ? "s" : ""}`);
    if (queueStats.activities > 0) parts.push(`${queueStats.activities} activit${queueStats.activities > 1 ? "ies" : "y"}`);
    return (
      <>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 border border-amber-500/30 text-amber-400">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden sm:inline">{parts.length > 0 ? `${parts.join(" · ")} pending` : `${pending} pending`}</span>
          <span className="sm:hidden">{pending} pending</span>
          <Button variant="ghost" size="sm" onClick={triggerSync}
            className="h-5 px-2 text-[10px] text-amber-400 hover:text-amber-400">
            <RefreshCw className="h-3 w-3 mr-0.5" />Sync
          </Button>
          {isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setQueueOpen(true)}
              className="h-5 px-2 text-[10px] text-amber-400/70 hover:text-amber-400">
              View
            </Button>
          )}
        </div>
        <PendingQueueDrawer open={queueOpen} onClose={() => setQueueOpen(false)} />
      </>
    );
  }

  // ── Online & synced ────────────────────────────────────────────────────────
  if (lastSync || lastEventSync) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
        <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
        <span className="hidden sm:inline">
          Synced
          {lastEventSync && (
            <span className="text-muted-foreground/40 ml-1">
              · event data {formatDistanceToNow(lastEventSync, { addSuffix: true })}
            </span>
          )}
        </span>
      </div>
    );
  }

  // Default: online, nothing pending, never synced
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground/60">
      <div className="w-2 h-2 rounded-full bg-success" />
      <span className="hidden sm:inline">Online</span>
    </div>
  );
}
