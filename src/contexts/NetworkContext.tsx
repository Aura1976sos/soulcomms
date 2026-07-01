import {
  createContext, useContext, useEffect, useState, useCallback,
  useRef, ReactNode,
} from "react";
import { flushQueue, getQueueStats, QueueStats } from "@/lib/offlineStore";
import { flushOfflineMessages } from "@/lib/commOfflineQueue";
import { speak, VM } from "@/lib/voice";

// Exponential-backoff delays for auto-retry after failure (ms)
const RETRY_DELAYS = [5_000, 15_000, 30_000, 60_000];

const EMPTY_STATS: QueueStats = { total: 0, walkIns: 0, checkIns: 0, activities: 0 };

interface NetworkState {
  online: boolean;
  queueStats: QueueStats;
  syncing: boolean;
  lastSync: Date | null;
  syncError: boolean;
  syncErrorMsg: string;       // last error message
  nextRetryIn: number;        // seconds until next auto-retry (0 = not scheduled)
  refreshPending: () => Promise<void>;
  triggerSync: () => Promise<void>;
}

const NetworkContext = createContext<NetworkState>({
  online: true,
  queueStats: EMPTY_STATS,
  syncing: false,
  lastSync: null,
  syncError: false,
  syncErrorMsg: "",
  nextRetryIn: 0,
  refreshPending: async () => {},
  triggerSync: async () => {},
});

export const useNetwork = () => useContext(NetworkContext);

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  const [online, setOnline]         = useState(navigator.onLine);
  const [queueStats, setQueueStats] = useState<QueueStats>(EMPTY_STATS);
  const [syncing, setSyncing]       = useState(false);
  const [lastSync, setLastSync]     = useState<Date | null>(null);
  const [syncError, setSyncError]   = useState(false);
  const [syncErrorMsg, setSyncErrorMsg] = useState("");
  const [nextRetryIn, setNextRetryIn]   = useState(0);

  // Refs for retry scheduling (not state — no re-render needed)
  const retryTimerRef   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryAttemptRef = useRef(0);
  const isSyncingRef    = useRef(false);   // prevent concurrent flushes

  const clearRetrySchedule = useCallback(() => {
    if (retryTimerRef.current)  clearTimeout(retryTimerRef.current);
    if (countdownRef.current)   clearInterval(countdownRef.current);
    retryTimerRef.current  = null;
    countdownRef.current   = null;
    setNextRetryIn(0);
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const stats = await getQueueStats();
      setQueueStats(stats);
    } catch { /* IDB not ready */ }
  }, []);

  // Forward-declared via ref so scheduleRetry can reference triggerSync
  const triggerSyncRef = useRef<() => Promise<void>>(async () => {});

  const scheduleRetry = useCallback(() => {
    clearRetrySchedule();
    const delaySecs = Math.round(
      RETRY_DELAYS[Math.min(retryAttemptRef.current, RETRY_DELAYS.length - 1)] / 1000
    );
    let remaining = delaySecs;
    setNextRetryIn(remaining);

    countdownRef.current = setInterval(() => {
      remaining -= 1;
      setNextRetryIn(remaining <= 0 ? 0 : remaining);
    }, 1_000);

    retryTimerRef.current = setTimeout(() => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      setNextRetryIn(0);
      retryAttemptRef.current += 1;
      triggerSyncRef.current();
    }, delaySecs * 1_000);
  }, [clearRetrySchedule]);

  const triggerSync = useCallback(async () => {
    if (isSyncingRef.current) return;       // prevent concurrent calls
    const stats = await getQueueStats();
    if (stats.total === 0) return;

    isSyncingRef.current = true;
    setSyncing(true);
    setSyncError(false);
    setSyncErrorMsg("");
    clearRetrySchedule();

    try {
      const result = await flushQueue();
      await flushOfflineMessages();

      if (result.failed > 0) {
        setSyncError(true);
        setSyncErrorMsg(`${result.failed} record${result.failed > 1 ? "s" : ""} failed`);
        scheduleRetry();                    // auto-retry with backoff
      } else {
        setSyncError(false);
        retryAttemptRef.current = 0;       // reset backoff on full success
        setLastSync(new Date());
        if (result.synced > 0) speak(VM.sync_complete);
      }
      await refreshPending();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown sync error";
      setSyncError(true);
      setSyncErrorMsg(msg);
      scheduleRetry();
    } finally {
      setSyncing(false);
      isSyncingRef.current = false;
    }
  }, [refreshPending, scheduleRetry, clearRetrySchedule]);

  // Keep ref in sync so scheduleRetry can call triggerSync
  useEffect(() => { triggerSyncRef.current = triggerSync; }, [triggerSync]);

  // Poll queue stats every 30s (mutations call refreshPending directly, so frequent polling is wasteful)
  useEffect(() => {
    refreshPending();
    const interval = setInterval(refreshPending, 30_000);
    return () => clearInterval(interval);
  }, [refreshPending]);

  // Online / offline events
  useEffect(() => {
    const handleOnline = () => {
      setOnline(true);
      speak(VM.online_restored);
      retryAttemptRef.current = 0;         // reset backoff on fresh connection
      clearRetrySchedule();
      setTimeout(() => triggerSync(), 1_500);
    };
    const handleOffline = () => {
      setOnline(false);
      speak(VM.offline_mode);
      clearRetrySchedule();                // stop retry while offline
    };
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearRetrySchedule();
    };
  }, [triggerSync, clearRetrySchedule]);

  return (
    <NetworkContext.Provider value={{
      online, queueStats, syncing, lastSync,
      syncError, syncErrorMsg, nextRetryIn,
      refreshPending, triggerSync,
    }}>
      {children}
    </NetworkContext.Provider>
  );
};
