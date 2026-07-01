import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EXPERIENCES } from "@/lib/experiences";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import { Users, Briefcase, HardHat, Wifi, Zap, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  pRegistered: number;
  pCheckedIn: number;
  spRegistered: number;
  spCheckedIn: number;
  crewRegistered: number;
  crewCheckedIn: number;
  activityCounts: Record<string, number>;
  leaderboard: { id: string; code: string; name: string; activity_count: number }[];
}

function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, backgroundColor: color ?? "hsl(0 85% 52%)" }}
      />
    </div>
  );
}

export default function Live() {
  const [stats, setStats] = useState<Stats>({
    pRegistered: 0, pCheckedIn: 0,
    spRegistered: 0, spCheckedIn: 0,
    crewRegistered: 0, crewCheckedIn: 0,
    activityCounts: {}, leaderboard: [],
  });
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    const [
      { count: pReg }, { count: pIn },
      { count: spReg }, { count: spIn },
      { count: crewReg }, { count: crewIn },
      { data: actLogs },
      { data: leaders },
    ] = await Promise.all([
      supabase.from("participants").select("*", { count: "exact", head: true }),
      supabase.from("participants").select("*", { count: "exact", head: true }).eq("is_checked_in", true),
      supabase.from("service_providers").select("*", { count: "exact", head: true }),
      supabase.from("service_providers").select("*", { count: "exact", head: true }).eq("is_checked_in", true),
      supabase.from("crew_members").select("*", { count: "exact", head: true }),
      supabase.from("crew_members").select("*", { count: "exact", head: true }).eq("is_checked_in", true),
      supabase.from("activity_logs").select("experience"),
      supabase.from("participant_activity_counts" as "participants")
        .select("id, code, name, activity_count")
        .order("activity_count", { ascending: false })
        .limit(10),
    ]);

    const activityCounts: Record<string, number> = {};
    (actLogs ?? []).forEach((row: { experience: string }) => {
      activityCounts[row.experience] = (activityCounts[row.experience] ?? 0) + 1;
    });

    setStats({
      pRegistered: pReg ?? 0, pCheckedIn: pIn ?? 0,
      spRegistered: spReg ?? 0, spCheckedIn: spIn ?? 0,
      crewRegistered: crewReg ?? 0, crewCheckedIn: crewIn ?? 0,
      activityCounts,
      leaderboard: (leaders ?? []) as Stats["leaderboard"],
    });
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Realtime subscriptions
  useEffect(() => {
    const tables = ["participants", "service_providers", "crew_members", "activity_logs"];
    const channels = tables.map(table =>
      supabase.channel(`live_${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => fetchStats())
        .subscribe()
    );
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
  }, [fetchStats]);

  const grandTotal = stats.pCheckedIn + stats.spCheckedIn + stats.crewCheckedIn;
  const grandRegistered = stats.pRegistered + stats.spRegistered + stats.crewRegistered;

  const categories = [
    { label: "Participants", icon: Users, color: "hsl(0 85% 52%)", registered: stats.pRegistered, checkedIn: stats.pCheckedIn },
    { label: "Service Providers", icon: Briefcase, color: "hsl(200 85% 55%)", registered: stats.spRegistered, checkedIn: stats.spCheckedIn },
    { label: "Crew Team", icon: HardHat, color: "hsl(142 72% 45%)", registered: stats.crewRegistered, checkedIn: stats.crewCheckedIn },
  ];

  const maxActivityCount = Math.max(1, ...EXPERIENCES.map(e => stats.activityCounts[e.id] ?? 0));

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <SoulcommsLogo size="sm" />
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wifi className={cn("h-3.5 w-3.5", loading ? "text-muted-foreground" : "text-success")} />
            <span>Live · {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">

        {/* Grand Total */}
        <div className="text-center">
          <p className="text-xs font-bold uppercase tracking-[4px] text-muted-foreground mb-2">Grand Total Attendance</p>
          <div className="text-7xl font-black text-primary leading-none mb-1" style={{ textShadow: "0 0 40px hsl(0 85% 52% / 0.4)" }}>
            {grandTotal}
          </div>
          <p className="text-sm text-muted-foreground">of {grandRegistered} registered</p>
          <ProgressBar value={grandTotal} max={grandRegistered} />
        </div>

        {/* Category cards */}
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[3px] text-muted-foreground mb-4">Registration Summary</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {categories.map(cat => {
              const Icon = cat.icon;
              return (
                <div key={cat.label} className="glass-card rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cat.color}20` }}>
                      <Icon className="h-5 w-5" style={{ color: cat.color }} />
                    </div>
                    <span className="text-sm font-bold text-foreground">{cat.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Registered</p>
                      <p className="text-2xl font-black text-foreground">{cat.registered}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Checked In</p>
                      <p className="text-2xl font-black" style={{ color: cat.color }}>{cat.checkedIn}</p>
                    </div>
                  </div>
                  <ProgressBar value={cat.checkedIn} max={cat.registered} color={cat.color} />
                  <p className="text-xs text-muted-foreground mt-1.5 text-right">
                    {cat.registered > 0 ? Math.round((cat.checkedIn / cat.registered) * 100) : 0}% attendance
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity Stats */}
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[3px] text-muted-foreground mb-4">Activity Participation</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {EXPERIENCES.map(exp => {
              const Icon = exp.icon;
              const count = stats.activityCounts[exp.id] ?? 0;
              const pct = maxActivityCount > 0 ? (count / maxActivityCount) * 100 : 0;
              return (
                <div key={exp.id} className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${exp.color}20` }}>
                      <Icon className="h-3.5 w-3.5" style={{ color: exp.color }} />
                    </div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider leading-tight flex-1 min-w-0">{exp.name}</span>
                  </div>
                  <p className="text-2xl font-black text-foreground">{count}</p>
                  <div className="mt-2 w-full h-1 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: exp.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Leaderboard */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="h-4 w-4 text-primary" />
            <h2 className="text-xs font-bold uppercase tracking-[3px] text-muted-foreground">Live Leaderboard — Top 10</h2>
          </div>
          <div className="space-y-2">
            {stats.leaderboard.length === 0 ? (
              <div className="glass-card rounded-xl px-6 py-8 text-center text-muted-foreground text-sm">
                No activity recorded yet.
              </div>
            ) : stats.leaderboard.map((entry, i) => {
              const rank = i + 1;
              const rankColor = rank === 1 ? "bg-primary text-primary-foreground" : rank === 2 ? "bg-foreground/20 text-foreground" : rank === 3 ? "bg-foreground/15 text-foreground" : "bg-secondary text-muted-foreground";
              return (
                <div key={entry.id} className={cn("glass-card rounded-xl px-4 py-3 flex items-center gap-4", rank === 1 && "border-primary/30")}>
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0", rankColor)}>{rank}</div>
                  <div className="w-9 h-9 rounded-full bg-secondary flex items-center justify-center text-sm font-bold shrink-0">
                    {entry.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{entry.name}</p>
                    <p className="text-xs font-mono text-muted-foreground">#{entry.code}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1">
                      <Zap className="h-3.5 w-3.5 text-primary" />
                      <span className="text-lg font-black text-primary">{entry.activity_count}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{entry.activity_count * 10} pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      <footer className="border-t border-border px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by <span className="text-primary font-bold">SOULCOMMS</span> · Auto-refreshes every 30 seconds
        </p>
      </footer>
    </div>
  );
}
