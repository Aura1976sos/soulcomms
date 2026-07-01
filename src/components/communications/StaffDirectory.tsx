import { Users, Circle, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRoleDef } from "@/lib/staffRoles";

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  last_seen_at: string | null;
}

function getPresence(lastSeen: string | null): "online" | "away" | "offline" {
  if (!lastSeen) return "offline";
  const diff = Date.now() - new Date(lastSeen).getTime();
  if (diff < 2 * 60 * 1000)  return "online";
  if (diff < 15 * 60 * 1000) return "away";
  return "offline";
}

const PRESENCE_DOT = {
  online:  "bg-success",
  away:    "bg-amber-400",
  offline: "bg-muted-foreground/30",
};
const PRESENCE_LABEL = {
  online:  "Online",
  away:    "Away",
  offline: "Offline",
};

interface StaffDirectoryProps {
  staff: StaffMember[];
  myId: string;
  onStartDm: (staffId: string) => void;
  dmUnreadMap?: Record<string, number>;  // staffId → unread count
  showMessageButton?: boolean;           // DMs tab: show "Message" CTA
}

export function StaffDirectory({ staff, myId, onStartDm, dmUnreadMap = {}, showMessageButton = false }: StaffDirectoryProps) {
  const sorted = [...staff].sort((a, b) => {
    const order = { online: 0, away: 1, offline: 2 };
    return order[getPresence(a.last_seen_at)] - order[getPresence(b.last_seen_at)];
  });

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Users className="h-8 w-8 text-muted-foreground/30 mb-2" />
        <p className="text-xs text-muted-foreground">No staff found</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {sorted.map(s => {
        const presence  = getPresence(s.last_seen_at);
        const roleDef   = getRoleDef(s.role);
        const isMe      = s.id === myId;
        const unread    = dmUnreadMap[s.id] ?? 0;

        return (
          <button
            key={s.id}
            onClick={() => !isMe && onStartDm(s.id)}
            disabled={isMe}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors group",
              isMe ? "opacity-50 cursor-default" : "hover:bg-secondary cursor-pointer"
            )}
          >
            {/* Avatar with presence dot */}
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold">
                {s.name.charAt(0).toUpperCase()}
              </div>
              <Circle
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                  PRESENCE_DOT[presence]
                )}
                fill="currentColor"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">
                {s.name}
                {isMe && <span className="text-xs text-muted-foreground ml-1">(you)</span>}
              </p>
              <p className="text-[10px] text-muted-foreground truncate">
                {roleDef?.label ?? s.role.replace(/_/g, " ")} · {PRESENCE_LABEL[presence]}
              </p>
            </div>

            {/* Unread badge or Message button */}
            {!isMe && (
              <>
                {unread > 0 && (
                  <span className="shrink-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
                {showMessageButton && unread === 0 && (
                  <span className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <MessageCircle className="h-3.5 w-3.5 text-primary" />
                  </span>
                )}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
