import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useEvent } from "@/contexts/EventContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getQueueStats, getSyncQueueItems, getLastEventSyncTime,
  QueueStats, SyncMutation,
} from "@/lib/offlineStore";
import {
  Wifi, WifiOff, Database, RefreshCw, CheckCircle, AlertCircle,
  Shield, Clock, Activity, Users, Server, HardDrive, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface HealthItem {
  label: string;
  status: "ok" | "warn" | "error" | "loading";
  detail: string;
}

const STATUS_COLORS = {
  ok:      "text-success",
  warn:    "text-amber-400",
  error:   "text-destructive",
  loading: "text-muted-foreground",
};

const STATUS_ICONS = {
  ok:      <CheckCircle className="h-4 w-4 text-success" />,
  warn:    <AlertCircle className="h-4 w-4 text-amber-400" />,
  error:   <AlertCircle className="h-4 w-4 text-destructive" />,
  loading: <div className="h-4 w-4 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />,
};

function HealthRow({ item }: { item: HealthItem }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
      <div className="flex items-center gap-3">
        {STATUS_ICONS[item.status]}
        <span className="text-sm font-medium text-foreground">{item.label}</span>
      </div>
      <span className={cn("text-xs font-mono", STATUS_COLORS[item.status])}>
        {item.detail}
      </span>
    </div>
  );
}

export default function SystemHealth() {
  const { role, user } = useAuth();
  const { online, queueStats } = useNetwork();
  const { activeEvent, lastEventSync } = useEvent();

  const [checks, setChecks] = useState<HealthItem[]>([]);
  const [queueItems, setQueueItems] = useState<SyncMutation[]>([]);
  const [dbStatus, setDbStatus] = useState<"loading" | "ok" | "error">("loading");
  const [swStatus, setSwStatus] = useState<"loading" | "active" | "none" | "error">("loading");
  const [idbStatus, setIdbStatus] = useState<"loading" | "ok" | "error">("loading");
  const [idbStats, setIdbStats] = useState<QueueStats | null>(null);
  const [cacheSize, setCacheSize] = useState<string>("–");
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<Date | null>(null);

  const isAdmin = role === "admin" || role === "event_admin";

  const runChecks = useCallback(async () => {
    setRunning(true);
    const results: HealthItem[] = [];

    // 1. Network
    results.push({
      label: "Network Connectivity",
      status: online ? "ok" : "warn",
      detail: online ? "Online" : "Offline — local operations available",
    });

    // 2. Supabase DB ping
    let dbOk = false;
    try {
      const { error } = await supabase.from("events").select("id").limit(1);
      dbOk = !error;
      setDbStatus(dbOk ? "ok" : "error");
    } catch {
      setDbStatus("error");
    }
    results.push({
      label: "Database Connection",
      status: dbOk ? "ok" : (online ? "error" : "warn"),
      detail: dbOk ? "Connected" : (online ? "Connection failed" : "Offline — not checked"),
    });

    // 3. Service Worker
    let swOk = false;
    try {
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active) {
          swOk = true;
          setSwStatus("active");
        } else {
          setSwStatus("none");
        }
      } else {
        setSwStatus("none");
      }
    } catch {
      setSwStatus("error");
    }
    results.push({
      label: "Service Worker",
      status: swOk ? "ok" : "warn",
      detail: swOk ? "Active & caching" : "Not registered (offline mode limited)",
    });

    // 4. IDB
    try {
      const stats = await getQueueStats();
      setIdbStats(stats);
      const items = await getSyncQueueItems();
      setQueueItems(items);
      setIdbStatus("ok");
      results.push({
        label: "Local Database (IDB)",
        status: "ok",
        detail: `${stats.total} items queued`,
      });
    } catch (e) {
      setIdbStatus("error");
      results.push({ label: "Local Database (IDB)", status: "error", detail: "Failed to open" });
    }

    // 5. Cache storage size
    try {
      if ("storage" in navigator && "estimate" in navigator.storage) {
        const estimate = await navigator.storage.estimate();
        const used  = estimate.usage  ? (estimate.usage  / 1024 / 1024).toFixed(1) : "?";
        const quota = estimate.quota  ? (estimate.quota  / 1024 / 1024).toFixed(0) : "?";
        setCacheSize(`${used} MB / ${quota} MB`);
        const pct = estimate.usage && estimate.quota ? estimate.usage / estimate.quota : 0;
        results.push({
          label: "Storage Usage",
          status: pct > 0.9 ? "error" : pct > 0.7 ? "warn" : "ok",
          detail: `${used} MB used of ${quota} MB`,
        });
      } else {
        results.push({ label: "Storage Usage", status: "warn", detail: "Not available in this browser" });
      }
    } catch {
      results.push({ label: "Storage Usage", status: "warn", detail: "Could not estimate" });
    }

    // 6. Event data sync
    const syncAge = activeEvent && lastEventSync
      ? Math.round((Date.now() - lastEventSync.getTime()) / 60000)
      : null;
    results.push({
      label: "Event Data Cache",
      status: lastEventSync ? (syncAge !== null && syncAge > 120 ? "warn" : "ok") : "warn",
      detail: lastEventSync
        ? `Last sync: ${format(lastEventSync, "MMM d, h:mm a")} (${syncAge}m ago)`
        : "Not yet cached — open Dashboard to sync",
    });

    // 7. Auth session
    const session = await supabase.auth.getSession();
    const hasSession = !!session.data?.session;
    results.push({
      label: "Auth Session",
      status: user ? "ok" : "error",
      detail: user
        ? `Authenticated as ${user.email} · ${hasSession ? "valid token" : "offline session"}`
        : "Not authenticated",
    });

    // 8. Browser compatibility
    const features: string[] = [];
    if (!("indexedDB" in window)) features.push("IndexedDB missing");
    if (!("serviceWorker" in navigator)) features.push("Service Worker missing");
    if (!("MessageChannel" in window)) features.push("MessageChannel missing");
    results.push({
      label: "Browser Compatibility",
      status: features.length === 0 ? "ok" : "warn",
      detail: features.length === 0 ? `All features supported` : features.join(", "),
    });

    setChecks(results);
    setLastRun(new Date());
    setRunning(false);
  }, [online, activeEvent, lastEventSync, user]);

  useEffect(() => { runChecks(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClearCache = async () => {
    try {
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      sessionStorage.clear();
    } catch { /* ignore */ }
    window.location.reload();
  };

  const handleReloadSW = async () => {
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) await reg.update();
      }
    } catch { /* ignore */ }
    runChecks();
  };

  if (!isAdmin) {
    return (
      <AppLayout title="System Health" subtitle="Admin only">
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <Shield className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Access restricted to administrators.</p>
          </div>
        </div>
      </AppLayout>
    );
  }

  const okCount    = checks.filter(c => c.status === "ok").length;
  const warnCount  = checks.filter(c => c.status === "warn").length;
  const errorCount = checks.filter(c => c.status === "error").length;
  const overallStatus = errorCount > 0 ? "error" : warnCount > 0 ? "warn" : "ok";

  return (
    <AppLayout title="System Health" subtitle="Diagnostic panel for administrators">
      <div className="space-y-6 max-w-2xl">

        {/* Overall status */}
        <div className={cn(
          "flex items-center gap-4 rounded-xl px-5 py-4 border",
          overallStatus === "ok"    && "bg-success/10 border-success/30",
          overallStatus === "warn"  && "bg-amber-500/10 border-amber-500/30",
          overallStatus === "error" && "bg-destructive/10 border-destructive/30",
        )}>
          {overallStatus === "ok"
            ? <CheckCircle className="h-6 w-6 text-success shrink-0" />
            : overallStatus === "warn"
            ? <AlertCircle className="h-6 w-6 text-amber-400 shrink-0" />
            : <AlertCircle className="h-6 w-6 text-destructive shrink-0" />}
          <div className="flex-1">
            <p className="font-bold text-foreground">
              {overallStatus === "ok" ? "All systems operational"
               : overallStatus === "warn" ? "Degraded — some warnings"
               : "Critical issues detected"}
            </p>
            <p className="text-xs text-muted-foreground">
              {okCount} ok · {warnCount} warn · {errorCount} error
              {lastRun && ` · Checked ${format(lastRun, "h:mm:ss a")}`}
            </p>
          </div>
          <Button
            size="sm" variant="outline"
            onClick={runChecks} disabled={running}
            className="gap-2 border-border shrink-0"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", running && "animate-spin")} />
            {running ? "Checking…" : "Re-check"}
          </Button>
        </div>

        {/* Health checks */}
        <div className="glass-card rounded-xl px-5 py-2">
          {checks.length === 0 ? (
            <div className="py-6 text-center text-muted-foreground text-sm">Running diagnostics…</div>
          ) : (
            checks.map((item, i) => <HealthRow key={i} item={item} />)
          )}
        </div>

        {/* Sync Queue */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" />Sync Queue
          </h3>
          <div className="glass-card rounded-xl px-5 py-4 space-y-2">
            {idbStats ? (
              <>
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { label: "Total",       value: idbStats.total,      icon: Database },
                    { label: "Walk-Ins",    value: idbStats.walkIns,    icon: Users },
                    { label: "Check-Ins",   value: idbStats.checkIns,   icon: CheckCircle },
                    { label: "Activities",  value: idbStats.activities,  icon: Activity },
                  ].map(({ label, value, icon: Icon }) => (
                    <div key={label} className="text-center bg-secondary rounded-lg py-3">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground mx-auto mb-1" />
                      <p className="text-xl font-black text-foreground">{value}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
                    </div>
                  ))}
                </div>
                {queueItems.length > 0 && (
                  <div className="mt-3 divide-y divide-border rounded-lg overflow-hidden">
                    {queueItems.slice(0, 10).map(item => (
                      <div key={item.id} className="flex items-center justify-between px-3 py-2 bg-secondary/50">
                        <span className="text-xs font-mono text-primary">{item.type}</span>
                        {item.error_message && (
                          <span className="text-[10px] text-destructive truncate max-w-[200px]">
                            {item.error_message}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {item.retries > 0 ? `${item.retries} retries` : "pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-2">
                {idbStatus === "error" ? "IDB unavailable" : "Loading…"}
              </p>
            )}
          </div>
        </div>

        {/* System info */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground mb-3 flex items-center gap-2">
            <Server className="h-4 w-4" />System Info
          </h3>
          <div className="glass-card rounded-xl px-5 py-3 space-y-2">
            {[
              { label: "Browser",    value: navigator.userAgent.split(" ").slice(-2).join(" ") },
              { label: "Platform",   value: navigator.platform || "unknown" },
              { label: "Online",     value: String(navigator.onLine) },
              { label: "Storage",    value: cacheSize },
              { label: "IDB Status", value: idbStatus },
              { label: "SW Status",  value: swStatus },
              { label: "Active Event", value: activeEvent?.name ?? "none" },
              { label: "Last Event Sync", value: lastEventSync ? format(lastEventSync, "MMM d, h:mm a") : "never" },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between border-b border-border last:border-0 py-2">
                <span className="text-xs text-muted-foreground">{label}</span>
                <span className="text-xs font-mono text-foreground truncate max-w-[240px] text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground mb-3 flex items-center gap-2">
            <HardDrive className="h-4 w-4" />Recovery Actions
          </h3>
          <div className="flex gap-3 flex-wrap">
            <Button onClick={handleReloadSW} variant="outline" size="sm" className="gap-2 border-border">
              <RefreshCw className="h-3.5 w-3.5" />Update Service Worker
            </Button>
            <Button onClick={handleClearCache} variant="outline" size="sm"
              className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10">
              <Trash2 className="h-3.5 w-3.5" />Clear All Cache
            </Button>
            <Button onClick={() => window.location.reload()} variant="outline" size="sm" className="gap-2 border-border">
              <RefreshCw className="h-3.5 w-3.5" />Hard Reload
            </Button>
          </div>
        </div>

      </div>
    </AppLayout>
  );
}
