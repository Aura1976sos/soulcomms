import { Component, ErrorInfo, ReactNode, useState, useEffect } from "react";

// ── Error Boundary ────────────────────────────────────────────────────────────
// CRITICAL: The fallback MUST NOT render any React function components
// (shadcn, lucide, etc.), because if React's dispatcher is null (e.g. due to
// a broken scheduler shim from a stale SW cache), those function components
// will crash immediately. Use only plain HTML + inline styles here.

async function clearAppCache() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    sessionStorage.clear();
  } catch { /* ignore */ }
  window.location.reload();
}

interface Props { children: ReactNode; }
interface State { hasError: boolean; message: string; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err?.message ?? "Unknown error" };
  }

  componentDidCatch(err: Error, info: ErrorInfo) {
    console.error("[Soulcomms] App error:", err, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // Plain HTML only — NO React function components, NO hooks, NO shadcn
    const s: Record<string, React.CSSProperties> = {
      root: {
        minHeight: "100vh", background: "#0d0d14", display: "flex",
        alignItems: "center", justifyContent: "center", padding: "24px",
        fontFamily: "system-ui, -apple-system, sans-serif", color: "#e2e2f0",
      },
      box: { maxWidth: 420, width: "100%", textAlign: "center" },
      icon: {
        width: 48, height: 48, borderRadius: "50%",
        background: "rgba(239,68,68,0.12)", display: "flex",
        alignItems: "center", justifyContent: "center",
        margin: "0 auto 20px",
      },
      h1: { fontSize: 18, fontWeight: 800, marginBottom: 8, color: "#fff" },
      p: { fontSize: 14, color: "#888", marginBottom: 8 },
      code: {
        display: "block", fontSize: 10, fontFamily: "monospace",
        background: "rgba(255,255,255,0.05)", borderRadius: 6,
        padding: "6px 10px", color: "#666",
        margin: "12px 0 24px", textAlign: "left",
        wordBreak: "break-all" as const, maxHeight: 60, overflow: "hidden",
      },
      btnPrimary: {
        display: "block", width: "100%", padding: "12px 16px",
        background: "#6c47ff", color: "#fff", border: "none",
        borderRadius: 10, fontSize: 14, fontWeight: 700,
        cursor: "pointer", marginBottom: 10,
      },
      btnSecondary: {
        display: "block", width: "100%", padding: "11px 16px",
        background: "transparent", color: "#ef4444",
        border: "1px solid rgba(239,68,68,0.3)",
        borderRadius: 10, fontSize: 14, fontWeight: 600,
        cursor: "pointer",
      },
      hint: { marginTop: 16, fontSize: 11, color: "#444" },
    };

    return (
      <div style={s.root}>
        <div style={s.box}>
          <div style={s.icon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>
          <h1 style={s.h1}>Something went wrong</h1>
          <p style={s.p}>
            The app failed to load. This is usually caused by a stale browser cache after an update.
          </p>
          {this.state.message && (
            <code style={s.code}>{this.state.message.slice(0, 200)}</code>
          )}
          <button style={s.btnPrimary} onClick={() => window.location.reload()}>
            Reload App
          </button>
          <button style={s.btnSecondary} onClick={clearAppCache}>
            Clear Cache &amp; Reload
          </button>
          <p style={s.hint}>
            If the problem persists, try opening the app in a fresh browser tab.
          </p>
        </div>
      </div>
    );
  }
}

// ── Loading timeout guard ─────────────────────────────────────────────────────
interface LoadingGuardProps { loading: boolean; timeoutMs?: number; children: ReactNode; onRetry?: () => void; }

export function LoadingGuard({ loading, timeoutMs = 10_000, children, onRetry }: LoadingGuardProps) {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(t);
  }, [loading, timeoutMs]);

  if (!loading) return <>{children}</>;

  if (timedOut) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: "80px 24px", textAlign: "center", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#e2e2f0", margin: 0 }}>Having trouble loading</p>
        <p style={{ fontSize: 12, color: "#888", margin: 0 }}>Check your connection and try again.</p>
        <div style={{ display: "flex", gap: 10 }}>
          {onRetry && (
            <button onClick={onRetry} style={{ padding: "8px 16px", background: "#6c47ff", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
              Retry
            </button>
          )}
          <button onClick={() => window.location.reload()} style={{ padding: "8px 16px", background: "transparent", color: "#aaa", border: "1px solid #333", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: "80px 24px" }}>
      <div style={{ width: 24, height: 24, border: "2px solid #333", borderTopColor: "#6c47ff", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
      <p style={{ fontSize: 12, color: "#666", margin: 0 }}>Loading…</p>
    </div>
  );
}
