import {
  createContext, useContext, useEffect, useState, useCallback, ReactNode, useRef,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { speak } from "@/lib/voice";

interface CommunicationsState {
  totalUnread: number;
  mentionCount: number;
  markChannelRead: (channelId: string) => Promise<void>;
  refreshUnread: () => Promise<void>;
}

const CommunicationsContext = createContext<CommunicationsState>({
  totalUnread: 0,
  mentionCount: 0,
  markChannelRead: async () => {},
  refreshUnread: async () => {},
});

export const useCommunications = () => useContext(CommunicationsContext);

export const CommunicationsProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [totalUnread, setTotalUnread]   = useState(0);
  const [mentionCount, setMentionCount] = useState(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const refreshUnread = useCallback(async () => {
    if (!user?.id) return;
    if (!navigator.onLine) return;  // skip when offline — avoid failed DB calls
    try {
      // Count unread: messages newer than last_read_at per channel
      const { data: memberships } = await supabase
        .from("comm_channel_members")
        .select("channel_id, last_read_at")
        .eq("staff_id", user.id);

      if (!memberships?.length) { setTotalUnread(0); return; }

      // Run all per-channel count queries in parallel — not sequentially
      const unreadCounts = await Promise.all(
        memberships.map(m =>
          supabase
            .from("comm_messages")
            .select("id", { count: "exact", head: true })
            .eq("channel_id", m.channel_id)
            .eq("is_deleted", false)
            .neq("sender_id", user.id)
            .gt("created_at", m.last_read_at ?? "1970-01-01")
            .then(r => r.count ?? 0)
        )
      );
      const unread = unreadCounts.reduce((a, b) => a + b, 0);
      setTotalUnread(unread);

      // Mention count
      const { count: mc } = await supabase
        .from("comm_mentions")
        .select("id", { count: "exact", head: true })
        .eq("mentioned_staff_id", user.id)
        .is("seen_at", null);
      setMentionCount(mc ?? 0);
    } catch {
      // silent
    }
  }, [user?.id]);

  const markChannelRead = useCallback(async (channelId: string) => {
    if (!user?.id) return;
    await supabase
      .from("comm_channel_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("channel_id", channelId)
      .eq("staff_id", user.id);

    // Mark mentions in this channel as seen
    await supabase
      .from("comm_mentions")
      .update({ seen_at: new Date().toISOString() })
      .eq("mentioned_staff_id", user.id)
      .eq("channel_id", channelId)
      .is("seen_at", null);

    await refreshUnread();
  }, [user?.id, refreshUnread]);

  // Subscribe to new mentions via Realtime
  useEffect(() => {
    if (!user?.id) return;

    refreshUnread();

    // Poll for unread every 60s — realtime covers new mentions instantly
    let interval: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        if (navigator.onLine) refreshUnread();
      }, 60_000);
    };

    const handleOnline = () => {
      refreshUnread();
      startPolling();
    };
    const handleOffline = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };

    startPolling();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    channelRef.current = supabase
      .channel(`mentions:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "comm_mentions",
          filter: `mentioned_staff_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as { sender_name?: string; channel_name?: string };
          setMentionCount(prev => prev + 1);
          setTotalUnread(prev => prev + 1);
          // Voice alert
          speak(
            `You have been mentioned by ${row.sender_name ?? "a colleague"} in ${row.channel_name ?? "team chat"}`
          );
        }
      )
      .subscribe();

    return () => {
      if (interval) clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [user?.id, refreshUnread]);

  return (
    <CommunicationsContext.Provider value={{ totalUnread, mentionCount, markChannelRead, refreshUnread }}>
      {children}
    </CommunicationsContext.Provider>
  );
};
