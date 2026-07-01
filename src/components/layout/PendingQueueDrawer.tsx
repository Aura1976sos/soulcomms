import { useEffect, useState, useCallback } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  User, UserCheck, Zap, RefreshCw, Trash2, ChevronDown, ChevronUp,
  AlertTriangle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getSyncQueueItems, dismissSyncMutation, dismissAllFailed, SyncMutation,
} from "@/lib/offlineStore";
import { useNetwork } from "@/contexts/NetworkContext";

interface Props {
  open: boolean;
  onClose: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  register_walkin:      "Walk-In Registration",
  register_walkin_crew: "Crew Registration",
  register_walkin_sp:   "SP Registration",
  register_qr:          "QR Registration",
  checkin_participant:  "Participant Check-In",
  checkin_sp:           "SP Check-In",
  checkin_crew:         "Crew Check-In",
  activity_log:         "Activity Log",
};

function TypeIcon({ type }: { type: string }) {
  if (type.startsWith("register")) return <User className="h-4 w-4" />;
  if (type.startsWith("checkin"))  return <UserCheck className="h-4 w-4" />;
  return <Zap className="h-4 w-4" />;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function MutationCard({
  m,
  onDismiss,
}: {
  m: SyncMutation;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFailed = m.retries > 0;

  const payloadName =
    (m.payload.name as string | undefined) ||
    (m.payload.brand_name as string | undefined) ||
    (m.payload.participant_code as string | undefined) ||
    "—";

  return (
    <div className={cn(
      "rounded-lg border p-3 space-y-2 text-sm",
      hasFailed ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("text-muted-foreground", hasFailed && "text-destructive")}>
            <TypeIcon type={m.type} />
          </span>
          <div className="min-w-0">
            <p className="font-medium text-foreground truncate">{TYPE_LABELS[m.type] ?? m.type}</p>
            <p className="text-xs text-muted-foreground truncate">{payloadName}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {hasFailed && (
            <Badge variant="destructive" className="text-[10px] h-5 px-1.5">
              {m.retries} retr{m.retries === 1 ? "y" : "ies"}
            </Badge>
          )}
          <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground">
            {relativeTime(m.created_at)}
          </Badge>
        </div>
      </div>

      {/* Error message */}
      {m.error_message && (
        <div className="flex items-start gap-1.5">
          <AlertTriangle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />
          <p className={cn(
            "text-xs text-destructive/80 break-all",
            !expanded && "line-clamp-2"
          )}>
            {m.error_message}
          </p>
          <button
            onClick={() => setExpanded(e => !e)}
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {expanded
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {/* Last error time */}
      {m.last_error_at && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Last attempt {relativeTime(m.last_error_at)}
        </p>
      )}

      {/* Dismiss */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onDismiss(m.id)}
        className="h-7 w-full text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10"
      >
        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
        Dismiss from queue
      </Button>
    </div>
  );
}

export function PendingQueueDrawer({ open, onClose }: Props) {
  const [items, setItems] = useState<SyncMutation[]>([]);
  const [loading, setLoading] = useState(false);
  const { triggerSync, syncing } = useNetwork();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSyncQueueItems();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) reload(); }, [open, reload]);

  const handleDismiss = async (id: string) => {
    await dismissSyncMutation(id);
    setItems(prev => prev.filter(m => m.id !== id));
  };

  const handleClearFailed = async () => {
    await dismissAllFailed();
    reload();
  };

  const handleSyncNow = async () => {
    await triggerSync();
    reload();
  };

  const failedItems = items.filter(m => m.retries > 0);

  return (
    <Sheet open={open} onOpenChange={v => !v && onClose()}>
      <SheetContent side="right" className="w-full max-w-md flex flex-col gap-0 p-0">
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border shrink-0">
          <SheetTitle className="flex items-center gap-2">
            Sync Queue
            {items.length > 0 && (
              <Badge variant="secondary" className="text-xs">{items.length}</Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Records waiting to synchronize with the server.
          </SheetDescription>
        </SheetHeader>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
              <RefreshCw className="h-4 w-4 animate-spin mr-2" />Loading…
            </div>
          )}
          {!loading && items.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
              <div className="w-10 h-10 rounded-full bg-success/20 flex items-center justify-center">
                <RefreshCw className="h-5 w-5 text-success" />
              </div>
              <p className="text-sm font-medium">Queue is empty</p>
              <p className="text-xs">All records have been synchronized.</p>
            </div>
          )}
          {!loading && items.map(m => (
            <MutationCard key={m.id} m={m} onDismiss={handleDismiss} />
          ))}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-4 border-t border-border shrink-0 flex flex-col gap-2">
          <Button
            onClick={handleSyncNow}
            disabled={syncing || items.length === 0}
            className="w-full"
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", syncing && "animate-spin")} />
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
          {failedItems.length > 0 && (
            <Button
              variant="outline"
              onClick={handleClearFailed}
              className="w-full text-destructive border-destructive/30 hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear {failedItems.length} Failed Record{failedItems.length > 1 ? "s" : ""}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
