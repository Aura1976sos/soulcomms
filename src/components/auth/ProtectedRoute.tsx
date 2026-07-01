import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useGuest } from "@/contexts/GuestContext";
import { ReactNode, useState, useEffect } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProtectedRouteProps {
  children: ReactNode;
  requiredRoles?: string[];
  allowGuests?: boolean; // Allow guest users without login
}

function LoadingScreen({ timedOut }: { timedOut: boolean }) {
  if (timedOut) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-sm w-full space-y-6 text-center">
          <div className="flex justify-center">
            <div className="p-4 rounded-full bg-amber-500/10">
              <AlertTriangle className="h-8 w-8 text-amber-400" />
            </div>
          </div>
          <div>
            <h2 className="text-base font-black text-foreground mb-1">Having trouble loading</h2>
            <p className="text-sm text-muted-foreground">
              Your session is taking longer than expected. This can happen on slow connections.
            </p>
          </div>
          <div className="space-y-2">
            <Button onClick={() => window.location.reload()} className="w-full gap-2">
              <RefreshCw className="h-4 w-4" />Reload App
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2 border-border"
              onClick={async () => {
                try {
                  if ("caches" in window) {
                    const keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                  }
                  sessionStorage.clear();
                } catch { /* ignore */ }
                window.location.reload();
              }}
            >
              <RefreshCw className="h-4 w-4" />Clear Cache &amp; Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-2 border-border border-t-primary rounded-full animate-spin" />
        <p className="text-xs text-muted-foreground uppercase tracking-[2px]">Loading…</p>
      </div>
    </div>
  );
}

export const ProtectedRoute = ({ children, requiredRoles, allowGuests }: ProtectedRouteProps) => {
  const { user, role, loading, profileReady } = useAuth();
  const { isGuestMode } = useGuest();
  const [timedOut, setTimedOut] = useState(false);

  // Hard 10-second timeout — never leave users stuck on a blank loading screen
  useEffect(() => {
    if (!loading) { setTimedOut(false); return; }
    const t = setTimeout(() => setTimedOut(true), 10_000);
    return () => clearTimeout(t);
  }, [loading]);

  // Allow guest access if enabled and guest is in session
  if (allowGuests && isGuestMode && requiredRoles === undefined) {
    return <>{children}</>;
  }

  // Guest users trying to access role-restricted pages should go back to login
  if (isGuestMode && (requiredRoles || !allowGuests)) {
    return <Navigate to="/login" replace />;
  }

  // Auth session still loading
  if (loading) return <LoadingScreen timedOut={timedOut} />;

  // Not authenticated
  if (!user) return <Navigate to="/login" replace />;

  // For role-gated routes: wait until profile is ready (max 3s via AuthContext timeout)
  if (requiredRoles && !profileReady) {
    return <LoadingScreen timedOut={timedOut} />;
  }

  // Role check: only block if role is confirmed AND not in allowed list
  if (requiredRoles && role && !requiredRoles.includes(role)) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
};
