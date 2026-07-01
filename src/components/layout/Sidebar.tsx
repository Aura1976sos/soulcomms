import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useGuest } from "@/contexts/GuestContext";
import { useEvent } from "@/contexts/EventContext";
import { useCommunications } from "@/contexts/CommunicationsContext";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, ScanLine, Zap, Users, Trophy, Upload, LogOut, X, UserCog,
  Briefcase, HardHat, Radio, Monitor, ExternalLink, CalendarDays, ChevronDown,
  ListChecks, MessageSquare, HeartPulse, BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SidebarProps {
  onClose?: () => void;
}

const navGroups = [
  {
    label: "Operations",
    items: [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", roles: ["admin", "checkin_officer", "activity_coordinator"] },
      { to: "/checkin", icon: ScanLine, label: "Check-In Station", roles: ["admin", "checkin_officer"] },
      { to: "/activity", icon: Zap, label: "Activity Recorder", roles: ["admin", "activity_coordinator"] },
      { to: "/communications", icon: MessageSquare, label: "Communications", roles: ["admin", "event_admin", "checkin_officer", "activity_coordinator", "crew_manager", "sp_manager", "viewer"] },
    ],
  },
  {
    label: "Attendees",
    items: [
      { to: "/participants", icon: Users, label: "Participants", roles: ["admin", "checkin_officer", "activity_coordinator"] },
      { to: "/service-providers", icon: Briefcase, label: "Service Providers", roles: ["admin", "checkin_officer"] },
      { to: "/crew", icon: HardHat, label: "Crew Members", roles: ["admin", "checkin_officer"] },
      { to: "/leaderboard", icon: Trophy, label: "Leaderboard", roles: ["admin", "checkin_officer", "activity_coordinator"] },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/events", icon: CalendarDays, label: "Events", roles: ["admin"] },
      { to: "/activities", icon: ListChecks, label: "Activities", roles: ["admin"] },
      { to: "/analytics", icon: BarChart3, label: "Time Analytics", roles: ["admin"] },
      { to: "/import", icon: Upload, label: "Import Participants", roles: ["admin"] },
      { to: "/import-providers", icon: Upload, label: "Import Providers", roles: ["admin"] },
      { to: "/import-crew", icon: Upload, label: "Import Crew", roles: ["admin"] },
      { to: "/staff", icon: UserCog, label: "Staff Management", roles: ["admin"] },
      { to: "/system-health", icon: HeartPulse, label: "System Health", roles: ["admin", "event_admin"] },
    ],
  },
];

export const Sidebar = ({ onClose }: SidebarProps) => {
  const { profile, role, signOut } = useAuth();
  const { isGuestMode, guestSession, clearGuestSession } = useGuest();
  const { activeEvent, events, setActiveEvent } = useEvent();
  const { totalUnread, mentionCount } = useCommunications();
  const navigate = useNavigate();
  const [showEventPicker, setShowEventPicker] = useState(false);

  const handleSignOut = async () => {
    if (isGuestMode) {
      clearGuestSession();
      navigate("/login");
    } else {
      await signOut();
      navigate("/login");
    }
  };

  // For guest mode, show minimal navigation
  if (isGuestMode) {
    return (
      <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
        {/* Header */}
        <div className="p-5 border-b border-sidebar-border">
          <div className="flex items-center justify-between mb-3">
            <SoulcommsLogo size="sm" />
            {onClose && (
              <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground h-7 w-7">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {/* Show event name for guest */}
          {guestSession && (
            <div className="w-full px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/20">
              <p className="text-xs font-bold text-foreground truncate leading-tight">{guestSession.eventName}</p>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">Guest Access</p>
            </div>
          )}
        </div>

        {/* Nav - Only CheckIn and ActivityRecorder */}
        <nav className="flex-1 p-4 space-y-4 overflow-y-auto">
          <div>
            <p className="px-4 mb-1.5 text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60">
              Operations
            </p>
            <div className="space-y-0.5">
              <NavLink
                to="/checkin"
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-glow-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                  )
                }
              >
                <ScanLine className="h-4 w-4 shrink-0" />
                Check-In Station
              </NavLink>
              <NavLink
                to="/activity"
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-glow-primary"
                      : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                  )
                }
              >
                <Zap className="h-4 w-4 shrink-0" />
                Activity Recorder
              </NavLink>
            </div>
          </div>
        </nav>

        {/* Footer - Logout */}
        <div className="p-4 border-t border-sidebar-border">
          <Button
            onClick={handleSignOut}
            variant="ghost"
            className="w-full flex gap-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground justify-start px-4"
          >
            <LogOut className="h-4 w-4" />
            End Session
          </Button>
        </div>
      </div>
    );
  }

  // For authenticated users, show full navigation
  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      {/* Header */}
      <div className="p-5 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <SoulcommsLogo size="sm" />
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="text-muted-foreground hover:text-foreground h-7 w-7">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Active event selector */}
        {activeEvent && (
          <button
            onClick={() => setShowEventPicker(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary/10 border border-primary/20 hover:bg-primary/15 transition-colors group"
          >
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-bold text-foreground truncate leading-tight">{activeEvent.name}</p>
              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mt-0.5">{activeEvent.code}</p>
            </div>
            <ChevronDown className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform duration-150",
              showEventPicker && "rotate-180"
            )} />
          </button>
        )}

        {/* Event picker dropdown */}
        {showEventPicker && events.length > 1 && (
          <div className="mt-1.5 bg-background border border-border rounded-xl overflow-hidden shadow-lg">
            {events.map(ev => (
              <button
                key={ev.id}
                onClick={() => { setActiveEvent(ev); setShowEventPicker(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs hover:bg-secondary transition-colors border-b last:border-b-0 border-border",
                  activeEvent?.id === ev.id && "bg-primary/10 text-primary font-bold"
                )}
              >
                <div className={cn("w-1.5 h-1.5 rounded-full shrink-0",
                  ev.status === "active" ? "bg-success" : ev.status === "draft" ? "bg-muted-foreground" : "bg-primary"
                )} />
                <span className="truncate">{ev.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 p-4 space-y-4 overflow-y-auto">
        {navGroups.map(group => {
          const visibleItems = role
            ? group.items.filter(item => item.roles.includes(role))
            : group.items;
          if (visibleItems.length === 0) return null;
          return (
            <div key={group.label}>
              <p className="px-4 mb-1.5 text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {visibleItems.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
                        isActive
                          ? "bg-primary text-primary-foreground shadow-glow-primary"
                          : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground"
                      )
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                    {to === "/communications" && (totalUnread > 0 || mentionCount > 0) && (
                      <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                        {mentionCount > 0 ? mentionCount : totalUnread > 99 ? "99+" : totalUnread}
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}

        {/* Public Pages (admin only) */}
        {role === "admin" && (
          <div>
            <p className="px-4 mb-1.5 text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60">
              Public
            </p>
            <div className="space-y-0.5">
              <a href="/live" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-150">
                <Radio className="h-4 w-4 shrink-0" />
                Live Tracker
                <ExternalLink className="h-3 w-3 ml-auto opacity-50" />
              </a>
              <a href="/display" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-foreground transition-all duration-150">
                <Monitor className="h-4 w-4 shrink-0" />
                Display Mode
                <ExternalLink className="h-3 w-3 ml-auto opacity-50" />
              </a>
            </div>
          </div>
        )}
      </nav>

      {/* Profile */}
      <div className="p-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-sidebar-accent mb-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-primary-foreground text-xs font-bold">
            {profile?.name?.charAt(0).toUpperCase() ?? "S"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{profile?.name ?? "Staff"}</p>
            <p className="text-xs text-muted-foreground capitalize">
              {profile?.role?.replace(/_/g, " ") ?? <span className="opacity-40">—</span>}
            </p>
          </div>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-3 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
          onClick={handleSignOut}
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  );
};
