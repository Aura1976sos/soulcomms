import { Hash, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Channel {
  id: string;
  name: string | null;
  slug: string | null;
  type: "dm" | "group";
  unread: number;
  lastMessage?: string | null;
  lastAt?: string | null;
  description?: string | null;
  createdBy?: string | null;
  // For DMs
  dmPeerName?: string;
  dmPeerRole?: string;
  dmPeerStaffId?: string;
}

interface ChannelListProps {
  channels: Channel[];
  selectedId: string | null;
  onSelect: (channelId: string) => void;
}

export function ChannelList({ channels, selectedId, onSelect }: ChannelListProps) {
  if (channels.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-xs text-muted-foreground">No channels yet</p>
        <p className="text-[10px] text-muted-foreground mt-1">Use "Create Channel" above to get started</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {channels.map(ch => {
        const isSelected = ch.id === selectedId;
        const Icon = ch.type === "dm" ? MessageCircle : Hash;
        const label = ch.type === "dm" ? (ch.dmPeerName ?? "Direct Message") : (ch.name ?? "Channel");
        const sublabel = ch.type === "dm"
          ? ch.dmPeerRole?.replace(/_/g, " ")
          : (ch.description || ch.lastMessage);

        return (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors",
              isSelected
                ? "bg-primary text-primary-foreground"
                : "hover:bg-secondary text-foreground"
            )}
          >
            <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary-foreground" : "text-muted-foreground")} />
            <div className="flex-1 min-w-0">
              <p className={cn("text-sm font-semibold truncate", isSelected ? "text-primary-foreground" : "text-foreground")}>
                {label}
              </p>
              {sublabel && (
                <p className={cn("text-[10px] truncate", isSelected ? "text-primary-foreground/70" : "text-muted-foreground")}>
                  {sublabel}
                </p>
              )}
            </div>
            {ch.unread > 0 && !isSelected && (
              <span className="shrink-0 bg-primary text-primary-foreground text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {ch.unread > 99 ? "99+" : ch.unread}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
