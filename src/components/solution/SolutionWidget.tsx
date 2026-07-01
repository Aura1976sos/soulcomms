import { useState, useRef, useEffect, KeyboardEvent } from "react";
import { Bot, X, Send, RotateCcw, Loader2, WifiOff, ChevronDown, Settings, Volume2, VolumeX, CheckCircle, AlertCircle, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSolutionChat, type PageContext } from "@/hooks/useSolutionChat";
import { useAuth } from "@/contexts/AuthContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { speak, getVoiceSettings, saveVoiceSettings, VM, type VoiceSettings } from "@/lib/voice";
import { useNavigate } from "react-router-dom";

// ─── Page metadata ────────────────────────────────────────────────────────────
const PAGE_META: Record<string, { label: string; welcome: string }> = {
  checkin: {
    label: "Check-In Station",
    welcome: "I'm here to help with check-in operations — QR scanning, manual codes, walk-ins, and offline mode. What do you need?",
  },
  activity_recorder: {
    label: "Activity Recorder",
    welcome: "I can help with activity recording. Remember: participants must complete event check-in before being recorded for an activity.",
  },
  staff: {
    label: "Staff Management",
    welcome: "Need help with staff accounts? I can guide you through creating, editing, disabling, or managing roles and sessions.",
  },
  dashboard: {
    label: "Dashboard",
    welcome: "I can explain any attendance figures, check-in statistics, activity metrics, or leaderboard data you see here.",
  },
  participants: {
    label: "Participants",
    welcome: "I can help you search and understand participant records. To check someone in, head to the Check-In Station.",
  },
  service_providers: {
    label: "Service Providers",
    welcome: "I can help with service provider records. For check-in, use the Check-In Station page.",
  },
  crew: {
    label: "Crew Members",
    welcome: "I can help with crew records and management. For check-in, use the Check-In Station page.",
  },
  events: {
    label: "Events",
    welcome: "I can help you understand event setup, configuration, and management.",
  },
  leaderboard: {
    label: "Leaderboard",
    welcome: "I can explain leaderboard rankings, point calculations, and activity participation metrics.",
  },
  general: {
    label: "Soulcomms",
    welcome: "I'm Solution™, your Soulcomms assistant. How can I help you today?",
  },
};

interface SolutionWidgetProps {
  page: string;
  eventName?: string;
}

export function SolutionWidget({ page, eventName }: SolutionWidgetProps) {
  const { role } = useAuth();
  const { online } = useNetwork();
  const { messages, isLoading, aiUnavailable, sendMessage, resetChat } = useSolutionChat();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(getVoiceSettings);
  const [input, setInput] = useState("");
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);
  const prevAiUnavailable = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const meta = PAGE_META[page] || PAGE_META.general;

  const updateVoice = (patch: Partial<VoiceSettings>) => {
    const updated = { ...voiceSettings, ...patch };
    setVoiceSettings(updated);
    saveVoiceSettings(patch);
  };

  // Detect AI reconnection
  useEffect(() => {
    if (prevAiUnavailable.current && !aiUnavailable && messages.length > 0) {
      setJustReconnected(true);
      setTimeout(() => setJustReconnected(false), 4000);
    }
    prevAiUnavailable.current = aiUnavailable;
  }, [aiUnavailable, messages.length]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    if (!open && messages.length > 0) setHasNewMessage(true);
  }, [messages, open]);

  // Clear badge when opened
  useEffect(() => {
    if (open) {
      setHasNewMessage(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const pageContext: PageContext = {
    page,
    role: role || "viewer",
    online,
    eventName,
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    await sendMessage(text, pageContext);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const showWelcome = messages.length === 0;

  return (
    <>
      {/* ── Chat Panel ────────────────────────────────────────────────────── */}
      {open && (
        <div className="fixed bottom-20 right-4 sm:right-6 z-50 w-[calc(100vw-2rem)] sm:w-96 max-h-[520px] flex flex-col bg-card border border-primary/20 rounded-2xl shadow-2xl overflow-hidden slide-up">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card/95 shrink-0">
            <div className="p-1.5 rounded-lg bg-primary/20">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-black text-foreground leading-none">Solution™</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{meta.label}</p>
            </div>
            {!online && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <WifiOff className="h-3 w-3" /> Offline
              </span>
            )}
            {online && aiUnavailable && (
              <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full">
                <AlertCircle className="h-3 w-3" /> Limited
              </span>
            )}
            <div className="flex items-center gap-1">
              <button onClick={() => { setShowSettings(v => !v); }}
                className={cn("p-1.5 rounded-lg transition-colors",
                  showSettings ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
                title="Voice settings">
                <Settings className="h-3.5 w-3.5" />
              </button>
              {messages.length > 0 && !showSettings && (
                <button onClick={resetChat}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  title="Clear conversation">
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* ── Voice Settings Panel ─────────────────────────────────────────── */}
          {showSettings && (
            <div className="shrink-0 border-b border-border px-4 py-4 space-y-4 bg-secondary/50">
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">Voice Assistant</p>

              {/* Enable toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {voiceSettings.enabled ? <Volume2 className="h-4 w-4 text-primary" /> : <VolumeX className="h-4 w-4 text-muted-foreground" />}
                  <span className="text-sm font-bold text-foreground">
                    {voiceSettings.enabled ? "Voice Enabled" : "Voice Disabled"}
                  </span>
                </div>
                <button
                  onClick={() => updateVoice({ enabled: !voiceSettings.enabled })}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    voiceSettings.enabled ? "bg-primary" : "bg-muted"
                  )}>
                  <span className={cn(
                    "inline-block h-4 w-4 rounded-full bg-white shadow transition-transform",
                    voiceSettings.enabled ? "translate-x-6" : "translate-x-1"
                  )} />
                </button>
              </div>

              {/* Volume slider */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground">Volume</label>
                  <span className="text-xs text-muted-foreground">{Math.round(voiceSettings.volume * 100)}%</span>
                </div>
                <input type="range" min={0} max={1} step={0.05}
                  value={voiceSettings.volume}
                  onChange={e => updateVoice({ volume: parseFloat(e.target.value) })}
                  className="w-full h-1.5 rounded-full accent-primary cursor-pointer"
                  disabled={!voiceSettings.enabled}
                />
              </div>

              {/* Speech rate */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Speed</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {([["Slow", 0.75], ["Normal", 0.95], ["Fast", 1.3]] as [string, number][]).map(([label, rate]) => (
                    <button key={label}
                      onClick={() => updateVoice({ rate })}
                      disabled={!voiceSettings.enabled}
                      className={cn(
                        "py-1.5 rounded-lg text-xs font-bold transition-colors",
                        Math.abs(voiceSettings.rate - rate) < 0.1
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary border border-border text-muted-foreground hover:text-foreground"
                      )}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Test voice */}
              <Button size="sm" variant="outline"
                onClick={() => speak(VM.welcome)}
                disabled={!voiceSettings.enabled}
                className="w-full gap-2 border-border font-bold text-xs">
                <Volume2 className="h-3.5 w-3.5" />
                Test Voice
              </Button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {/* Welcome */}
            {showWelcome && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="bg-secondary rounded-2xl rounded-tl-sm px-3 py-2.5 max-w-[85%]">
                  <p className="text-sm text-foreground leading-relaxed">{meta.welcome}</p>
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={cn("flex gap-2.5", msg.role === "user" ? "flex-row-reverse" : "flex-row")}>
                {msg.role === "assistant" && (
                  <div className={cn(
                    "w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                    msg.isFallback ? "bg-amber-500/20" : "bg-primary/20"
                  )}>
                    {msg.isFallback
                      ? <AlertCircle className="h-3.5 w-3.5 text-amber-500" />
                      : <Bot className="h-3.5 w-3.5 text-primary" />}
                  </div>
                )}
                <div className={cn(
                  "rounded-2xl px-3 py-2.5 max-w-[85%] text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground rounded-tr-sm"
                    : msg.isFallback
                      ? "bg-amber-500/10 border border-amber-500/20 text-foreground rounded-tl-sm"
                      : "bg-secondary text-foreground rounded-tl-sm"
                )}>
                  {msg.content ? (
                    <span className="whitespace-pre-line">{msg.content}</span>
                  ) : (msg.isStreaming && (
                    <span className="flex gap-1 items-center h-5">
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:300ms]" />
                    </span>
                  ))}
                  {msg.content && msg.isStreaming && (
                    <span className="inline-block w-1 h-4 bg-current animate-pulse ml-0.5 align-text-bottom" />
                  )}
                </div>
              </div>
            ))}

            {/* Reconnected banner */}
            {justReconnected && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-success/10 border border-success/30 text-xs text-success">
                <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                Solution AI reconnected
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-border bg-card/95">
            {/* Escalation shortcuts when AI unavailable */}
            {aiUnavailable && messages.length > 0 && (
              <div className="px-3 pt-3">
                <div className="p-3 rounded-xl bg-secondary border border-border">
                  <p className="text-xs text-muted-foreground mb-2 font-medium">Need further assistance?</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate("/communications?dm=admin")}
                      className="flex-1 gap-1.5 text-xs border-border h-7"
                    >
                      <MessageSquare className="h-3 w-3" />
                      Contact Admin
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigate("/communications")}
                      className="flex-1 gap-1.5 text-xs border-border h-7"
                    >
                      <MessageSquare className="h-3 w-3" />
                      Team Chat
                    </Button>
                  </div>
                </div>
              </div>
            )}
            <div className="flex gap-2 items-end px-3 py-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask Solution™…"
              rows={1}
              className={cn(
                "flex-1 resize-none rounded-xl px-3 py-2.5 text-sm bg-secondary border border-border",
                "text-foreground placeholder:text-muted-foreground",
                "focus:outline-none focus:border-primary transition-colors",
                "max-h-24 overflow-y-auto leading-relaxed"
              )}
              style={{ minHeight: "40px" }}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              size="icon"
              className="h-10 w-10 shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-[10px] text-muted-foreground py-1.5 bg-card/95 border-t border-border shrink-0">
            Powered by Qwen · Soulcomms Operations Assistant
          </p>
        </div>
      )}

      {/* ── Floating Trigger Button ───────────────────────────────────────── */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "fixed bottom-4 right-4 sm:right-6 z-50",
          "h-14 w-14 rounded-full shadow-2xl",
          "flex items-center justify-center",
          "transition-all duration-200 hover:scale-105 active:scale-95",
          "bg-primary text-primary-foreground",
          open && "bg-primary/80"
        )}
        aria-label="Open Solution assistant"
      >
        {open ? <X className="h-5 w-5" /> : <Bot className="h-6 w-6" />}

        {/* Badge — new message or offline */}
        {!open && hasNewMessage && (
          <span className="absolute top-0 right-0 h-4 w-4 rounded-full bg-success border-2 border-background animate-pulse" />
        )}
        {!open && !online && (
          <span className="absolute top-0 left-0 h-4 w-4 rounded-full bg-amber-400 border-2 border-background" />
        )}
      </button>
    </>
  );
}
