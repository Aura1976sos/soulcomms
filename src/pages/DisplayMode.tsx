import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EXPERIENCES } from "@/lib/experiences";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import { Users, Briefcase, HardHat, Maximize2, Minimize2, Wifi, Trophy, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stats {
  pRegistered: number; pCheckedIn: number;
  spRegistered: number; spCheckedIn: number;
  crewRegistered: number; crewCheckedIn: number;
  activityCounts: Record<string, number>;
  leaderboard: { id: string; code: string; name: string; activity_count: number }[];
}

const REFRESH_INTERVAL = 15000; // 15 seconds

function StatPill({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <p className="text-[11px] font-bold uppercase tracking-[2px] text-white/50 mb-1">{label}</p>
      <p className="font-black leading-none" style={{ fontSize: "clamp(2rem, 5vw, 4rem)", color: color ?? "white" }}>
        {value}
      </p>
    </div>
  );
}

export default function DisplayMode() {
  const [stats, setStats] = useState<Stats>({
    pRegistered: 0, pCheckedIn: 0,
    spRegistered: 0, spCheckedIn: 0,
    crewRegistered: 0, crewCheckedIn: 0,
    activityCounts: {}, leaderboard: [],
  });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [tick, setTick] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [now, setNow] = useState<Date>(new Date());
  const containerRef = useRef<HTMLDivElement>(null);

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
  }, []);

  // Auto-refresh
  useEffect(() => {
    fetchStats();
    const interval = setInterval(() => {
      fetchStats();
      setTick(t => t + 1);
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // Live clock
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Realtime
  useEffect(() => {
    const tables = ["participants", "service_providers", "crew_members", "activity_logs"];
    const channels = tables.map(table =>
      supabase.channel(`display_${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table }, () => fetchStats())
        .subscribe()
    );
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
  }, [fetchStats]);

  const toggleFullscreen = async () => {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      await document.exitFullscreen();
      setIsFullscreen(false);
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const grandTotal = stats.pCheckedIn + stats.spCheckedIn + stats.crewCheckedIn;
  const grandRegistered = stats.pRegistered + stats.spRegistered + stats.crewRegistered;

  const maxActivityCount = Math.max(1, ...EXPERIENCES.map(e => stats.activityCounts[e.id] ?? 0));

  const progressPct = grandRegistered > 0 ? Math.min(100, (grandTotal / grandRegistered) * 100) : 0;

  // Rotating counter for progress bar animation
  const animKey = tick;

  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-background text-foreground flex flex-col select-none"
      style={{ fontFamily: "inherit" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border shrink-0">
        <SoulcommsLogo size="sm" />
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wifi className="h-3 w-3 text-success" />
            <span className="font-mono">{lastUpdated.toLocaleTimeString()}</span>
          </div>
          <div className="text-lg font-black font-mono text-primary">
            {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0 overflow-hidden">

        {/* Left column */}
        <div className="flex flex-col gap-0 p-6 overflow-y-auto">

          {/* Grand Total hero */}
          <div className="text-center py-6 border-b border-border mb-6">
            <p className="text-[10px] font-black uppercase tracking-[6px] text-muted-foreground mb-2">Grand Total Attendance</p>
            <div
              className="font-black text-primary leading-none mb-2"
              style={{ fontSize: "clamp(4rem, 12vw, 8rem)", textShadow: "0 0 60px hsl(0 85% 52% / 0.5)" }}
            >
              {grandTotal}
            </div>
            <p className="text-sm text-muted-foreground mb-3">of {grandRegistered} registered</p>
            <div className="max-w-sm mx-auto h-2 bg-secondary rounded-full overflow-hidden">
              <div
                key={animKey}
                className="h-full bg-primary rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">{Math.round(progressPct)}% of total registered</p>
          </div>

          {/* Category stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: "Participants", icon: Users, color: "hsl(0 85% 52%)", reg: stats.pRegistered, chk: stats.pCheckedIn },
              { label: "Service Providers", icon: Briefcase, color: "hsl(200 85% 55%)", reg: stats.spRegistered, chk: stats.spCheckedIn },
              { label: "Crew Team", icon: HardHat, color: "hsl(142 72% 45%)", reg: stats.crewRegistered, chk: stats.crewCheckedIn },
            ].map(cat => {
              const Icon = cat.icon;
              return (
                <div key={cat.label} className="glass-card rounded-2xl p-5 text-center">
                  <div className="flex justify-center mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cat.color}20` }}>
                      <Icon className="h-5 w-5" style={{ color: cat.color }} />
                    </div>
                  </div>
                  <p className="text-xs font-bold text-muted-foreground mb-3">{cat.label}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <StatPill label="Reg." value={cat.reg} />
                    <StatPill label="In" value={cat.chk} color={cat.color} />
                  </div>
                  <div className="mt-3 h-1.5 bg-secondary rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-1000" style={{
                      width: `${cat.reg > 0 ? Math.min(100, (cat.chk / cat.reg) * 100) : 0}%`,
                      backgroundColor: cat.color,
                    }} />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Activity Stats */}
          <div>
            <p className="text-[10px] font-black uppercase tracking-[4px] text-muted-foreground mb-3">Activity Zones</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {EXPERIENCES.map(exp => {
                const Icon = exp.icon;
                const count = stats.activityCounts[exp.id] ?? 0;
                const pct = (count / maxActivityCount) * 100;
                return (
                  <div key={exp.id} className="glass-card rounded-xl p-3 text-center">
                    <div className="flex justify-center mb-1.5">
                      <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${exp.color}20` }}>
                        <Icon className="h-3.5 w-3.5" style={{ color: exp.color }} />
                      </div>
                    </div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase leading-tight mb-1.5">{exp.name}</p>
                    <p className="text-xl font-black text-foreground">{count}</p>
                    <div className="mt-1.5 h-1 bg-secondary rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: exp.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right column — Leaderboard */}
        <div className="border-l border-border p-6 overflow-y-auto bg-secondary/20">
          <div className="flex items-center gap-2 mb-5">
            <Trophy className="h-4 w-4 text-primary" />
            <p className="text-[10px] font-black uppercase tracking-[4px] text-muted-foreground">Live Leaderboard</p>
          </div>
          <div className="space-y-2">
            {stats.leaderboard.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No activity yet</p>
            ) : stats.leaderboard.map((entry, i) => {
              const rank = i + 1;
              const rankStyle = rank === 1
                ? "bg-primary text-primary-foreground shadow-glow-primary"
                : rank === 2 ? "bg-foreground/20 text-foreground"
                : rank === 3 ? "bg-foreground/15 text-foreground"
                : "bg-secondary text-muted-foreground";
              return (
                <div key={entry.id} className={cn("glass-card rounded-xl px-3 py-3 flex items-center gap-3", rank === 1 && "border-primary/30")}>
                  <div className={cn("w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shrink-0", rankStyle)}>
                    {rank}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate leading-tight">{entry.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">#{entry.code}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1">
                      <Zap className="h-3 w-3 text-primary" />
                      <span className="text-base font-black text-primary">{entry.activity_count}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{entry.activity_count * 10} pts</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 py-2 border-t border-border flex items-center justify-between shrink-0">
        <p className="text-xs text-muted-foreground">Auto-refreshes every 15s · Powered by <span className="text-primary font-bold">SOULCOMMS</span></p>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="w-1.5 h-1.5 rounded-full" style={{
              backgroundColor: i === (tick % 5) ? "hsl(0 85% 52%)" : "hsl(0 85% 52% / 0.2)",
              transition: "background-color 0.3s",
            }} />
          ))}
        </div>
      </div>
    </div>
  );
}
