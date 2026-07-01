import { ReactNode, useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { SyncStatusBar } from "./SyncStatusBar";
import { SolutionWidget } from "@/components/solution/SolutionWidget";
import { Button } from "@/components/ui/button";
import { Menu } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";

interface AppLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

const HEARTBEAT_INTERVAL = 60 * 1000; // 60 seconds for accurate presence

export const AppLayout = ({ children, title, subtitle }: AppLayoutProps) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useAuth();
  const { activeEvent } = useEvent();
  const { pathname } = useLocation();
  const lastHeartbeat = useRef<number>(0);

  // Derive Solution™ page key from current route
  const solutionPage =
    pathname.includes("checkin") ? "checkin" :
    pathname.includes("activity-recorder") ? "activity_recorder" :
    pathname.includes("staff") ? "staff" :
    pathname.includes("dashboard") ? "dashboard" :
    pathname.includes("participants") ? "participants" :
    pathname.includes("service-providers") ? "service_providers" :
    pathname.includes("crew") ? "crew" :
    pathname.includes("events") ? "events" :
    pathname.includes("leaderboard") ? "leaderboard" :
    "general";

  // Update last_seen_at every 5 minutes while app is open
  useEffect(() => {
    if (!user?.id) return;

    const sendHeartbeat = async () => {
      const now = Date.now();
      if (now - lastHeartbeat.current < HEARTBEAT_INTERVAL) return;
      lastHeartbeat.current = now;
      await supabase
        .from("staff_profiles")
        .update({ last_seen_at: new Date().toISOString() })
        .eq("id", user.id);
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
    return () => clearInterval(interval);
  }, [user?.id]);

  return (
    <div className="flex h-full bg-background">
      {/* Desktop Sidebar */}
      <div className="hidden md:flex w-64 shrink-0 flex-col">
        <Sidebar />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="p-0 w-72 bg-sidebar border-sidebar-border">
          <Sidebar onClose={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex items-center gap-4 px-6 py-4 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden text-muted-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h2 className="text-lg font-bold text-foreground leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {/* Sync status indicator */}
          <SyncStatusBar />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>

      {/* Solution™ — context-aware assistant */}
      <SolutionWidget page={solutionPage} eventName={activeEvent?.name} />
    </div>
  );
};
