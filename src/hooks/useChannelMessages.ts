import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { queueOfflineMessage } from "@/lib/commOfflineQueue";
import {
  cacheMessages, getCachedMessages, pruneMessages,
} from "@/lib/commMessageCache";
import { trackEvent } from "@enter-pro/analytics-sdk";

export interface CommMessage {
  id: string;
  channel_id: string;
  sender_id: string;
  sender_name: string;
  sender_role: string;
  content: string;
  type: "text" | "file" | "system" | "broadcast" | "escalation";
  file_url: string | null;
  file_name: string | null;
  mentions: string[] | null;
  metadata: Record<string, string> | null;
  created_at: string;
  is_deleted: boolean;
  is_queued?: boolean;  // offline queued — never persisted to cache
}

const PAGE_SIZE = 50;

export function useChannelMessages(channelId: string | null) {
  const { user, profile } = useAuth();
  const { online } = useNetwork();
  const [messages, setMessages]   = useState<CommMessage[]>([]);
  const [loading, setLoading]     = useState(false);
  const [hasMore, setHasMore]     = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // Track which channels we've loaded from network this session (to avoid
  // re-fetching cache every time the realtime fires an update)
  const networkLoadedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (before?: string) => {
    if (!channelId) return;
    setLoading(true);

    // ── Step 1: Show cache instantly (first load only, no pagination) ────────
    if (!before && !networkLoadedRef.current.has(channelId)) {
      try {
        const cached = await getCachedMessages(channelId);
        if (cached.length > 0) {
          setMessages(cached);
        }
      } catch {
        // IDB not available — continue
      }
    }

    // ── Step 2: Fetch from network ─────────────────────────────────────────
    try {
      let q = supabase
        .from("comm_messages")
        .select("*")
        .eq("channel_id", channelId)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (before) q = q.lt("created_at", before);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []).reverse() as CommMessage[];

      if (before) {
        setMessages(prev => {
          // Preserve any queued (offline) messages at the tail
          const queued = prev.filter(m => m.is_queued);
          return [...rows, ...prev.filter(m => !m.is_queued && !rows.find(r => r.id === m.id)), ...queued];
        });
      } else {
        setMessages(prev => {
          // Preserve queued messages that aren't yet in the server response
          const queued = prev.filter(m => m.is_queued);
          return [...rows, ...queued];
        });
        networkLoadedRef.current.add(channelId);
      }

      setHasMore((data?.length ?? 0) === PAGE_SIZE);

      // ── Step 3: Write to cache ───────────────────────────────────────────
      try {
        await cacheMessages(rows);
        await pruneMessages(channelId);
      } catch {
        // Cache write failure is non-fatal
      }
    } catch {
      // Network failed (offline) — keep whatever is shown (cache or empty)
      // Don't clear messages; the cache-load in step 1 already populated them
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  // Initial load + realtime subscription
  useEffect(() => {
    if (!channelId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    load();

    channelRef.current = supabase
      .channel(`messages:${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comm_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const newMsg = payload.new as CommMessage;
          setMessages(prev => {
            // Replace optimistic queued version if content+sender match
            const withoutQueued = prev.filter(
              m => !(m.is_queued && m.content === newMsg.content && m.sender_id === newMsg.sender_id)
            );
            // Avoid duplicates
            if (withoutQueued.find(m => m.id === newMsg.id)) return withoutQueued;
            return [...withoutQueued, newMsg];
          });
          // Persist to cache (fire-and-forget)
          cacheMessages([newMsg]).catch(() => {});
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
    };
  }, [channelId, load]);

  // When coming back online, re-subscribe realtime and reload fresh messages
  useEffect(() => {
    if (!online || !channelId) return;
    // Give the flush a moment to complete, then reload to reflect delivered msgs
    const t = setTimeout(() => {
      networkLoadedRef.current.delete(channelId); // force fresh network load
      load();
    }, 3000);
    return () => clearTimeout(t);
  }, [online]); // eslint-disable-line react-hooks/exhaustive-deps

  const sendMessage = useCallback(async (opts: {
    content: string;
    type?: CommMessage["type"];
    fileUrl?: string;
    fileName?: string;
    mentions?: string[];
    metadata?: Record<string, string>;
  }) => {
    if (!channelId || !user || !profile) return;

    const base = {
      id:          crypto.randomUUID(),
      channel_id:  channelId,
      sender_id:   user.id,
      sender_name: profile.name,
      sender_role: profile.role,
      content:     opts.content,
      type:        opts.type ?? "text",
      file_url:    opts.fileUrl ?? null,
      file_name:   opts.fileName ?? null,
      mentions:    opts.mentions ?? [],
      metadata:    opts.metadata ?? null,
      created_at:  new Date().toISOString(),
      is_deleted:  false,
    };

    if (!online) {
      // Show optimistic + queue offline
      setMessages(prev => [...prev, { ...base, is_queued: true }]);
      await queueOfflineMessage({
        id:          base.id,
        channelId:   base.channel_id,
        senderId:    base.sender_id,
        senderName:  base.sender_name,
        senderRole:  base.sender_role,
        content:     base.content,
        type:        base.type,
        mentions:    base.mentions as string[],
        metadata:    base.metadata ?? undefined,
        createdAt:   base.created_at,
      });
      trackEvent("communication_sent", {
        eventType: "conversion",
        properties: { message_type: base.type, mode: "offline" },
      });
      return;
    }

    // Optimistic insert (will be replaced by realtime event)
    setMessages(prev => [...prev, { ...base, is_queued: false }]);

    await supabase.from("comm_messages").insert({
      id:          base.id,
      channel_id:  base.channel_id,
      sender_id:   base.sender_id,
      sender_name: base.sender_name,
      sender_role: base.sender_role,
      content:     base.content,
      type:        base.type,
      file_url:    base.file_url,
      file_name:   base.file_name,
      mentions:    base.mentions,
      metadata:    base.metadata,
      created_at:  base.created_at,
    });
    trackEvent("communication_sent", {
      eventType: "conversion",
      properties: { message_type: base.type, mode: "online" },
    });
  }, [channelId, user, profile, online]);

  const loadMore = useCallback(() => {
    if (messages.length > 0) load(messages[0].created_at);
  }, [load, messages]);

  return { messages, loading, hasMore, sendMessage, loadMore, reload: load };
}
