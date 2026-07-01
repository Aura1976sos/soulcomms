import { useEffect, useRef } from "react";
import { FileText, Download, AlertTriangle, Megaphone, ChevronUp, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CommMessage } from "@/hooks/useChannelMessages";
import { getRoleDef } from "@/lib/staffRoles";

interface MessageThreadProps {
  messages: CommMessage[];
  loading: boolean;
  hasMore: boolean;
  myId: string;
  onLoadMore: () => void;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// Render @mention highlights
function renderContent(content: string) {
  const parts = content.split(/(@[\w\s]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <span key={i} className="text-primary font-semibold">{part}</span>
      : <span key={i}>{part}</span>
  );
}

export function MessageThread({ messages, loading, hasMore, myId, onLoadMore }: MessageThreadProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevLen   = useRef(0);

  useEffect(() => {
    if (messages.length > prevLen.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevLen.current = messages.length;
  }, [messages.length]);

  if (loading && messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-border border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center py-16">
        <Megaphone className="h-8 w-8 text-muted-foreground/30 mb-3" />
        <p className="text-sm font-semibold text-foreground">No messages yet</p>
        <p className="text-xs text-muted-foreground mt-1">Send the first message to get started.</p>
      </div>
    );
  }

  // Group by date
  let lastDate = "";
  let lastSender = "";
  let lastTime = 0;

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
      {hasMore && (
        <div className="flex justify-center pb-2">
          <Button variant="outline" size="sm" onClick={onLoadMore} className="gap-2 text-xs border-border text-muted-foreground">
            <ChevronUp className="h-3.5 w-3.5" />
            Load older messages
          </Button>
        </div>
      )}

      {messages.map((msg) => {
        const isMe      = msg.sender_id === myId;
        const msgDate   = formatDate(msg.created_at);
        const showDate  = msgDate !== lastDate;
        const msgTime   = new Date(msg.created_at).getTime();
        const grouped   = !showDate && msg.sender_id === lastSender && (msgTime - lastTime) < 5 * 60 * 1000;
        lastDate   = msgDate;
        lastSender = msg.sender_id;
        lastTime   = msgTime;

        const roleDef = getRoleDef(msg.sender_role);

        return (
          <div key={msg.id}>
            {/* Date separator */}
            {showDate && (
              <div className="flex items-center gap-3 py-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{msgDate}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            )}

            {/* Broadcast */}
            {msg.type === "broadcast" && (
              <div className="my-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <Megaphone className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Announcement · {msg.sender_name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(msg.created_at)}</span>
                </div>
                <p className="text-sm text-foreground font-medium">{msg.content}</p>
              </div>
            )}

            {/* Escalation */}
            {msg.type === "escalation" && (
              <div className="my-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-destructive">Escalation · {msg.sender_name}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{formatTime(msg.created_at)}</span>
                </div>
                <p className="text-sm text-foreground">{renderContent(msg.content)}</p>
                {msg.metadata && Object.keys(msg.metadata).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {Object.entries(msg.metadata).map(([k, v]) => v && (
                      <span key={k} className="text-[10px] bg-destructive/10 text-destructive rounded px-2 py-0.5 font-mono">
                        {k}: {v}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Normal / file message */}
            {(msg.type === "text" || msg.type === "file" || msg.type === "system") && (
              <div className={cn("flex gap-2.5", isMe ? "flex-row-reverse" : "flex-row", grouped ? "mt-0.5" : "mt-3")}>
                {/* Avatar */}
                {!grouped ? (
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold shrink-0 mt-0.5">
                    {msg.sender_name.charAt(0).toUpperCase()}
                  </div>
                ) : (
                  <div className="w-7 shrink-0" />
                )}

                <div className={cn("max-w-[75%] space-y-0.5", isMe ? "items-end" : "items-start")}>
                  {!grouped && (
                    <div className={cn("flex items-baseline gap-2", isMe && "flex-row-reverse")}>
                      <span className="text-xs font-bold text-foreground">{isMe ? "You" : msg.sender_name}</span>
                      <span className="text-[10px] text-muted-foreground">{roleDef?.label ?? msg.sender_role.replace(/_/g,"  ")}</span>
                      <span className="text-[10px] text-muted-foreground">{formatTime(msg.created_at)}</span>
                    </div>
                  )}

                  {/* File attachment */}
                  {msg.type === "file" && msg.file_url && (
                    <a
                      href={msg.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        "flex items-center gap-2 rounded-xl px-3 py-2.5 border text-sm transition-colors",
                        isMe
                          ? "bg-primary text-primary-foreground border-primary/30 hover:bg-primary/90"
                          : "bg-secondary border-border hover:bg-secondary/80 text-foreground"
                      )}
                    >
                      <FileText className="h-4 w-4 shrink-0" />
                      <span className="flex-1 truncate max-w-[160px] text-xs">{msg.file_name ?? "File"}</span>
                      <Download className="h-3 w-3 shrink-0 opacity-70" />
                    </a>
                  )}

                  {/* Text bubble */}
                  {msg.type !== "file" && (
                    <div
                      className={cn(
                        "rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                        isMe
                          ? "bg-primary text-primary-foreground rounded-tr-sm"
                          : "bg-secondary text-foreground rounded-tl-sm",
                        msg.is_queued && "opacity-60"
                      )}
                    >
                      {renderContent(msg.content)}
                      {msg.is_queued && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] opacity-70">
                          <WifiOff className="h-2.5 w-2.5" /> queued
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
