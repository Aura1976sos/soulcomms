import {
  createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { getOfflineActivities, cacheActivities, CachedActivity } from "@/lib/offlineStore";

// ─── Types ────────────────────────────────────────────────────────────────────
export interface Activity {
  id: string;
  event_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  description: string | null;
  category: string | null;
  points_value: number;
  status: "active" | "inactive" | "archived";
  icon_name: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  manual_count?: number | null;
  is_single_session?: boolean;
}

interface ActivitiesState {
  activities: Activity[];
  activeActivities: Activity[];
  loading: boolean;
  getActivity: (idOrCode: string) => Activity | undefined;
  subActivities: (parentId: string) => Activity[];
  topLevel: Activity[];
  refresh: () => Promise<void>;
}

const ActivitiesContext = createContext<ActivitiesState>({
  activities: [],
  activeActivities: [],
  loading: true,
  getActivity: () => undefined,
  subActivities: () => [],
  topLevel: [],
  refresh: async () => {},
});

export const useActivities = () => useContext(ActivitiesContext);

export const ActivitiesProvider = ({ children }: { children: ReactNode }) => {
  const { activeEvent } = useEvent();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = useCallback(async () => {
    if (!activeEvent) { setActivities([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("event_id", activeEvent.id)
        .order("sort_order", { ascending: true });

      if (!error && data && data.length > 0) {
        setActivities(data as Activity[]);
        // Non-blocking IDB cache update
        cacheActivities(activeEvent.id, data as CachedActivity[]).catch(() => {});
      } else {
        const cached = await getOfflineActivities(activeEvent.id);
        setActivities(cached.length > 0 ? (cached as Activity[]) : ((data ?? []) as Activity[]));
      }
    } catch {
      try {
        const cached = await getOfflineActivities(activeEvent.id);
        setActivities(cached as Activity[]);
      } catch {
        setActivities([]);
      }
    } finally {
      setLoading(false);
    }
  }, [activeEvent]);

  useEffect(() => { fetchActivities(); }, [fetchActivities]);

  // Keep a ref so the realtime subscription always calls the latest fetchActivities
  // without needing to recreate the subscription on every activeEvent change
  const fetchRef = useRef(fetchActivities);
  useEffect(() => { fetchRef.current = fetchActivities; }, [fetchActivities]);

  // Realtime subscription — only subscribe once there's an active event
  // (i.e. after login). No active event means no user-facing data to watch.
  useEffect(() => {
    if (!activeEvent) return;
    const channel = supabase.channel("activities_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "activities" }, () => {
        fetchRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeEvent?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeActivities = activities.filter(a => a.status === "active");
  const topLevel = activities.filter(a => a.parent_id === null);
  const getActivity = (idOrCode: string) =>
    activities.find(a => a.id === idOrCode || a.code === idOrCode);
  const subActivities = (parentId: string) =>
    activities.filter(a => a.parent_id === parentId);

  return (
    <ActivitiesContext.Provider value={{
      activities, activeActivities, loading, getActivity, subActivities, topLevel,
      refresh: fetchActivities,
    }}>
      {children}
    </ActivitiesContext.Provider>
  );
};
