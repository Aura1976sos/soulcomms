import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cacheEventData, getLastEventSyncTime } from "@/lib/offlineStore";
import { trackEvent } from "@enter-pro/analytics-sdk";
import { useAuth } from "@/contexts/AuthContext";

export interface SoulEvent {
  id: string;
  name: string;
  code: string;
  slug: string | null;
  date: string | null;
  venue: string | null;
  status: "draft" | "active" | "completed";
  banner_url: string | null;
  created_at: string;
}

interface EventContextType {
  activeEvent: SoulEvent | null;
  events: SoulEvent[];
  setActiveEvent: (event: SoulEvent) => void;
  loading: boolean;
  refetch: () => Promise<void>;
  lastEventSync: Date | null;
  triggerEventCacheSync: () => void;
}

const STORAGE_KEY = "soulcomms_active_event_id";
const MIN_SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes between auto-syncs

const EventContext = createContext<EventContextType>({
  activeEvent: null,
  events: [],
  setActiveEvent: () => {},
  loading: true,
  refetch: async () => {},
  lastEventSync: null,
  triggerEventCacheSync: () => {},
});

export const useEvent = () => useContext(EventContext);

export const EventProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const [events, setEvents] = useState<SoulEvent[]>([]);
  const [activeEvent, setActiveEventState] = useState<SoulEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastEventSync, setLastEventSync] = useState<Date | null>(null);

  // Track in-progress cache operations to avoid duplicate syncs
  const syncingRef = useRef<string | null>(null);

  // Trigger a background cache of event data (non-blocking)
  const triggerCache = (event: SoulEvent) => {
    if (!navigator.onLine) return;
    if (syncingRef.current === event.id) return;

    // Throttle: don't re-sync within 30 minutes
    const lastSync = getLastEventSyncTime(event.id);
    if (lastSync && Date.now() - lastSync.getTime() < MIN_SYNC_INTERVAL_MS) {
      // Already cached recently – just update the displayed timestamp
      setLastEventSync(lastSync);
      return;
    }

    syncingRef.current = event.id;
    cacheEventData(event.id)
      .then(() => {
        const ts = getLastEventSyncTime(event.id);
        setLastEventSync(ts);
        trackEvent("event_data_synced", {
          eventType: "custom",
          properties: { event_name: event.name },
        });
      })
      .catch(() => {/* best-effort */})
      .finally(() => {
        if (syncingRef.current === event.id) syncingRef.current = null;
      });
  };

  const fetchEvents = async () => {
    try {
      const { data } = await supabase
        .from("events")
        .select("*")
        .order("created_at", { ascending: true });

      const list = (data ?? []) as SoulEvent[];
      setEvents(list);

      if (list.length > 0) {
        const storedId = localStorage.getItem(STORAGE_KEY);
        const restored = list.find(e => e.id === storedId);
        const defaultEvent =
          restored ??
          list.find(e => e.status === "active") ??
          list[0];
        setActiveEventState(defaultEvent);
        // Restore last sync timestamp even before the background cache completes
        setLastEventSync(getLastEventSyncTime(defaultEvent.id));
        // Background pre-download
        triggerCache(defaultEvent);
      }
    } finally {
      setLoading(false);
    }
  };

  // Only load events (and trigger the offline pre-cache) once a user is logged in.
  // This keeps the public login page free of any Supabase REST/realtime calls.
  useEffect(() => {
    if (!user?.id) {
      setEvents([]);
      setActiveEventState(null);
      setLoading(false);
      return;
    }
    fetchEvents();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When the device comes back online, re-trigger a cache of the active event
  useEffect(() => {
    const handleOnline = () => {
      if (activeEvent) triggerCache(activeEvent);
    };
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [activeEvent]);  const setActiveEvent = (event: SoulEvent) => {
    setActiveEventState(event);
    localStorage.setItem(STORAGE_KEY, event.id);
    setLastEventSync(getLastEventSyncTime(event.id));
    triggerCache(event);
  };

  const triggerEventCacheSync = () => {
    if (!activeEvent) return;
    // Force re-sync regardless of cooldown
    syncingRef.current = null;
    cacheEventData(activeEvent.id)
      .then(() => setLastEventSync(getLastEventSyncTime(activeEvent.id)))
      .catch(() => {});
  };

  return (
    <EventContext.Provider value={{
      activeEvent, events, setActiveEvent, loading, refetch: fetchEvents,
      lastEventSync, triggerEventCacheSync,
    }}>
      {children}
    </EventContext.Provider>
  );
};
