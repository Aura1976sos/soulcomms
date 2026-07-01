import { useEffect, useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { useGuest } from "@/contexts/GuestContext";
import { useActivities } from "@/contexts/ActivitiesContext";
import { resolveIcon } from "@/lib/experiences";
import { Trophy, Zap, Wifi } from "lucide-react";
import { cn } from "@/lib/utils";

interface LeaderEntry {
  id: string; code: string; name: string; activity_count: number; points: number; rank: number;
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("all");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { activeActivities } = useActivities();
  const currentEventId = isGuestMode ? guestSession?.eventId : activeEvent?.id;

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    const eventId = currentEventId;
    try {
      if (filter === "all") {
        let q = supabase
          .from("participant_activity_counts" as "participants")
          .select("id, code, name, activity_count")
          .order("activity_count", { ascending: false })
          .limit(100);
        if (eventId) q = q.eq("event_id" as "id", eventId);

        const { data } = await q;
        setEntries(
          (data ?? []).map((p: { id: string; code: string; name: string; activity_count: number }, i: number) => ({
            ...p,
            points: p.activity_count * 10,
            rank: i + 1,
          }))
        );
      } else {
        // filter is activity UUID or legacy code — try both
        let q = supabase
          .from("activity_logs")
          .select("participant_id, participant_code, participants(id, code, name)")
          .or(`activity_id.eq.${filter},experience.eq.${filter}`);
        if (eventId) q = q.eq("event_id", eventId);
        const { data: logs } = await q;

        const countMap: Record<string, { id: string; code: string; name: string; count: number }> = {};
        (logs ?? []).forEach((log: { participant_id: string; participant_code: string; participants: { id: string; code: string; name: string } | null }) => {
          if (!log.participants) return;
          const pid = log.participants.id;
          if (!countMap[pid]) countMap[pid] = { id: pid, code: log.participants.code, name: log.participants.name, count: 0 };
          countMap[pid].count++;
        });

        const sorted = Object.values(countMap)
          .sort((a, b) => b.count - a.count)
          .map((e, i) => ({ id: e.id, code: e.code, name: e.name, activity_count: e.count, points: e.count * 10, rank: i + 1 }));

        setEntries(sorted);
      }
      setLastUpdated(new Date());
    } finally {
      setLoading(false);
    }
  }, [filter, currentEventId]);

  useEffect(() => { fetchLeaderboard(); }, [fetchLeaderboard]);

  useEffect(() => {
    const channel = supabase.channel("leaderboard_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, () => { fetchLeaderboard(); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchLeaderboard]);

  const getRankStyle = (rank: number) => {
    if (rank === 1) return "bg-primary text-primary-foreground shadow-glow-primary";
    if (rank === 2) return "bg-foreground/20 text-foreground";
    if (rank === 3) return "bg-foreground/15 text-foreground";
    return "bg-secondary text-muted-foreground";
  };

  return (
    <AppLayout title="Leaderboard" subtitle="Participants ranked by activities completed · updates live">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center pb-2">
          <div className="inline-flex items-center gap-2 mb-2">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-xs font-bold uppercase tracking-[3px] text-primary">Most Active</span>
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <Wifi className="h-3 w-3 text-success" />
            <p className="text-xs text-muted-foreground">
              Live · updated {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
        </div>

        {/* Filter tabs — dynamic from DB activities */}
        <div className="flex gap-2 overflow-x-auto pb-2" style={{ scrollbarWidth: "none" }}>
          <button
            onClick={() => setFilter("all")}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border shrink-0",
              filter === "all"
                ? "bg-primary text-primary-foreground border-primary shadow-glow-primary"
                : "bg-secondary border-border text-muted-foreground hover:text-foreground"
            )}
          >
            All Zones
          </button>
          {activeActivities.map(activity => {
            const Icon = resolveIcon(activity.icon_name);
            return (
              <button
                key={activity.id}
                onClick={() => setFilter(activity.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition-all border shrink-0",
                  filter === activity.id
                    ? "bg-primary text-primary-foreground border-primary shadow-glow-primary"
                    : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3 w-3" />
                {activity.name}
              </button>
            );
          })}
        </div>

        {/* Entries */}
        <div className="space-y-2">
          {loading ? (
            Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-secondary animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
            ))
          ) : entries.length === 0 ? (
            <div className="glass-card rounded-xl px-6 py-10 text-center">
              <p className="text-muted-foreground text-sm">No participants yet for this filter.</p>
            </div>
          ) : (
            entries.map(entry => (
              <div
                key={entry.id}
                className={cn(
                  "glass-card rounded-xl px-4 py-3 flex items-center gap-4 fade-in-up",
                  entry.rank === 1 && "border-primary/40"
                )}
              >
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0", getRankStyle(entry.rank))}>
                  {entry.rank}
                </div>
                <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sm font-bold text-foreground shrink-0">
                  {entry.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{entry.name}</p>
                  <p className="text-xs font-mono text-muted-foreground">#{entry.code}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-primary" />
                    <div>
                      <p className="text-lg font-black text-primary leading-none">{entry.activity_count}</p>
                      <p className="text-xs text-muted-foreground">{entry.activity_count === 1 ? "zone" : "zones"}</p>
                    </div>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground mt-0.5">{entry.points} pts</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
