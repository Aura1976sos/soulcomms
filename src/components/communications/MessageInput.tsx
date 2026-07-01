import { useState, useRef, KeyboardEvent, ChangeEvent } from "react";
import { Send, Paperclip, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { type StaffMember } from "./StaffDirectory";

interface MessageInputProps {
  channelId: string;
  channelName: string;
  myId: string;
  myName: string;
  myRole: string;
  canBroadcast: boolean;
  staff: StaffMember[];
  onSend: (opts: {
    content: string;
    type?: "text" | "broadcast" | "escalation";
    fileUrl?: string;
    fileName?: string;
    mentions?: string[];
    metadata?: Record<string, string>;
  }) => Promise<void>;
  prefill?: string;
  prefillType?: "text" | "escalation";
  prefillMeta?: Record<string, string>;
}

export function MessageInput({
  channelId, channelName, myId, myName, myRole,
  canBroadcast, staff, onSend, prefill, prefillType, prefillMeta,
}: MessageInputProps) {
  const [text, setText]           = useState(prefill ?? "");
  const [isBroadcast, setIsBroadcast] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending]     = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionAnchor, setMentionAnchor] = useState(0);
  const fileRef  = useRef<HTMLInputElement>(null);
  const textRef  = useRef<HTMLTextAreaElement>(null);

  // Mention autocomplete
  const mentionSuggestions = mentionQuery !== null
    ? staff
        .filter(s => s.id !== myId && s.name.toLowerCase().includes(mentionQuery.toLowerCase()))
        .slice(0, 5)
    : [];

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    // Detect @mention
    const cursor = e.target.selectionStart;
    const before = val.slice(0, cursor);
    const mentionMatch = before.match(/@([\w\s]*)$/);
    if (mentionMatch) {
      setMentionQuery(mentionMatch[1]);
      setMentionAnchor(cursor - mentionMatch[0].length);
    } else {
      setMentionQuery(null);
    }
  };

  const insertMention = (member: StaffMember) => {
    const before   = text.slice(0, mentionAnchor);
    const after    = text.slice(textRef.current?.selectionStart ?? mentionAnchor + (mentionQuery?.length ?? 0) + 1);
    const newText  = `${before}@${member.name} ${after}`;
    setText(newText);
    setMentionQuery(null);
    textRef.current?.focus();
  };

  const extractMentions = (content: string): string[] => {
    const ids: string[] = [];
    const regex = /@([\w\s]+)/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const name = match[1].trim();
      const found = staff.find(s => s.name.toLowerCase() === name.toLowerCase());
      if (found && !ids.includes(found.id)) ids.push(found.id);
    }
    return ids;
  };

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setMentionQuery(null);

    const mentions = extractMentions(content);
    const msgType = prefillType === "escalation" && text === prefill
      ? "escalation"
      : isBroadcast ? "broadcast" : "text";

    await onSend({
      content,
      type:     msgType,
      mentions,
      metadata: prefillMeta,
    });

    // Insert mention rows
    if (mentions.length > 0) {
      for (const staffId of mentions) {
        const member = staff.find(s => s.id === staffId);
        await supabase.from("comm_mentions").insert({
          channel_id:         channelId,
          mentioned_staff_id: staffId,
          sender_name:        myName,
          channel_name:       channelName,
        });
        void member;
      }
    }

    setText("");
    setIsBroadcast(false);
    setSending(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === "Escape") setMentionQuery(null);
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext  = file.name.split(".").pop() ?? "bin";
    const path = `${channelId}/${crypto.randomUUID()}.${ext}`;
    const { data, error } = await supabase.storage.from("comm-files").upload(path, file);
    if (!error && data) {
      const { data: urlData } = supabase.storage.from("comm-files").getPublicUrl(data.path);
      await onSend({ content: file.name, type: "file", fileUrl: urlData.publicUrl, fileName: file.name });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="border-t border-border px-4 py-3 bg-background shrink-0">
      {/* Mention dropdown */}
      {mentionSuggestions.length > 0 && (
        <div className="mb-2 bg-card border border-border rounded-xl shadow-lg overflow-hidden">
          {mentionSuggestions.map(s => (
            <button
              key={s.id}
              onMouseDown={() => insertMention(s)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-secondary transition-colors"
            >
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                {s.name.charAt(0)}
              </div>
              <span className="font-medium text-foreground">{s.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">{s.role.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      )}

      {/* Broadcast toggle */}
      {canBroadcast && (
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setIsBroadcast(v => !v)}
            className={cn(
              "flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors font-medium",
              isBroadcast
                ? "bg-primary/10 border-primary/30 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            <Megaphone className="h-3 w-3" />
            {isBroadcast ? "Broadcast ON" : "Broadcast"}
          </button>
          {isBroadcast && (
            <span className="text-[10px] text-muted-foreground">All members will receive this as an announcement</span>
          )}
        </div>
      )}

      {/* Prefill type indicator */}
      {prefillType === "escalation" && text === prefill && (
        <div className="flex items-center gap-2 mb-2 text-xs text-destructive bg-destructive/8 border border-destructive/20 rounded-lg px-3 py-1.5">
          <span className="font-bold">Escalation</span> — this message will be highlighted for the team
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* File upload */}
        <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf,.txt,.csv" onChange={handleFileUpload} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="h-9 w-9 shrink-0 border-border text-muted-foreground hover:text-foreground"
        >
          {uploading
            ? <span className="w-3.5 h-3.5 border-2 border-border border-t-primary rounded-full animate-spin" />
            : <Paperclip className="h-3.5 w-3.5" />
          }
        </Button>

        {/* Text area */}
        <textarea
          ref={textRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          rows={1}
          placeholder={`Message ${channelName}… (type @ to mention)`}
          className="flex-1 resize-none bg-secondary border border-border rounded-xl px-3.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors min-h-[36px] max-h-32"
          style={{ height: "auto" }}
          onInput={e => {
            const t = e.currentTarget;
            t.style.height = "auto";
            t.style.height = Math.min(t.scrollHeight, 128) + "px";
          }}
        />

        {/* Send */}
        <Button
          onClick={handleSend}
          disabled={!text.trim() || sending}
          size="icon"
          className={cn(
            "h-9 w-9 shrink-0",
            isBroadcast ? "bg-primary" : ""
          )}
        >
          {sending
            ? <span className="w-3.5 h-3.5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
            : <Send className="h-3.5 w-3.5" />
          }
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground mt-1.5 ml-12">Press Enter to send · Shift+Enter for new line</p>
    </div>
  );
}
