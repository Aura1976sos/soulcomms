import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import {
  Users, UserCheck, Briefcase, HardHat, Zap, Wifi, Trophy,
  CalendarDays, MapPin, ArrowLeft, Medal,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface EventRow {
  id: string;
  name: string;
  code: string;
  slug: string | null;
  date: string | null;
  venue: string | null;
  status: string;
  banner_url: string | null;
}

interface LiveStats {
  pRegistered: number;
  pCheckedIn: number;
  crewRegistered: number;
  crewCheckedIn: number;
  spRegistered: number;
  spCheckedIn: number;
  totalExperiences: number;
  uniqueEngaged: number;
  // activity_id → count
  activityCounts: Record<string, number>;
  // sorted leaderboard of activities
  activityLeaderboard: Array<{ id: string; name: string; code: string; count: number }>;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatPill({
  label, value, icon: Icon, color,
}: { label: string; value: number; icon: typeof Users; color?: string }) {
  return (
    <div className="glass-card rounded-xl p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" style={color ? { color } : {}} />
        <span className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-black text-foreground" style={color ? { color } : {}}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LiveEvent() {
  const { slug } = useParams<{ slug: string }>();

  const [event, setEvent]       = useState<EventRow | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stats, setStats]       = useState<LiveStats>({
    pRegistered: 0, pCheckedIn: 0,
    crewRegistered: 0, crewCheckedIn: 0,
    spRegistered: 0, spCheckedIn: 0,
    totalExperiences: 0, uniqueEngaged: 0,
    activityCounts: {}, activityLeaderboard: [],
  });
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [loading, setLoading]         = useState(true);

  // ── Load event ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!slug) return;
    supabase
      .from("events")
      .select("id, name, code, slug, date, venue, status, banner_url")
      .or(`slug.eq.${slug},code.ilike.${slug}`)
      .maybeSingle()
      .then(({ data }) => {
        if (!data) { setNotFound(true); setLoading(false); }
        else setEvent(data as EventRow);
      });
  }, [slug]);

  // ── Fetch live stats ──────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    if (!event) return;
    const eid = event.id;

    const [
      { count: pReg },
      { count: pIn },
      { count: crewReg },
      { count: crewIn },
      { count: spReg },
      { count: spIn },
      { data: actList },
      { data: logCounts },
      { data: sessionCounts },
      { data: actLogParts },
      { data: sessParts },
    ] = await Promise.all([
      supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid),
      supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid).eq("is_checked_in", true),
      supabase.from("crew_members").select("*", { count: "exact", head: true }).eq("event_id", eid),
      supabase.from("crew_members").select("*", { count: "exact", head: true }).eq("event_id", eid).eq("is_checked_in", true),
      supabase.from("service_providers").select("*", { count: "exact", head: true }).eq("event_id", eid),
      supabase.from("service_providers").select("*", { count: "exact", head: true }).eq("event_id", eid).eq("is_checked_in", true),
      // Activities for this event
      supabase.from("activities").select("id, name, code").eq("event_id", eid).eq("is_active", true),
      // Direct activity logs (e.g. Club 100)
      supabase.from("activity_logs").select("activity_id").eq("event_id", eid),
      // Session-based participations (ticketed)
      supabase.from("session_participations").select("activity_id, participant_id").eq("event_id", eid),
      // For unique participant count
      supabase.from("activity_logs").select("participant_id").eq("event_id", eid),
      supabase.from("session_participations").select("participant_id").eq("event_id", eid),
    ]);

    // Per-activity counts from logs
    const logById: Record<string, number> = {};
    (logCounts ?? []).forEach((r: { activity_id: string | null }) => {
      if (r.activity_id) logById[r.activity_id] = (logById[r.activity_id] ?? 0) + 1;
    });

    // Per-activity counts from session_participations
    const sessById: Record<string, number> = {};
    (sessionCounts ?? []).forEach((r: { activity_id: string | null }) => {
      if (r.activity_id) sessById[r.activity_id] = (sessById[r.activity_id] ?? 0) + 1;
    });

    // Merge into activity counts
    const activityCounts: Record<string, number> = {};
    const activities = (actList ?? []) as { id: string; name: string; code: string }[];
    activities.forEach(a => {
      activityCounts[a.id] = (logById[a.id] ?? 0) + (sessById[a.id] ?? 0);
    });

    const totalExperiences = Object.values(activityCounts).reduce((s, n) => s + n, 0);

    // Unique participants
    const uniqueIds = new Set<string>();
    (actLogParts ?? []).forEach((r: { participant_id: string | null }) => {
      if (r.participant_id) uniqueIds.add(r.participant_id);
    });
    (sessParts ?? []).forEach((r: { participant_id: string | null }) => {
      if (r.participant_id) uniqueIds.add(r.participant_id);
    });

    // Activity leaderboard (sorted by count desc)
    const activityLeaderboard = activities
      .map(a => ({ ...a, count: activityCounts[a.id] ?? 0 }))
      .sort((a, b) => b.count - a.count);

    setStats({
      pRegistered: pReg ?? 0,
      pCheckedIn: pIn ?? 0,
      crewRegistered: crewReg ?? 0,
      crewCheckedIn: crewIn ?? 0,
      spRegistered: spReg ?? 0,
      spCheckedIn: spIn ?? 0,
      totalExperiences,
      uniqueEngaged: uniqueIds.size,
      activityCounts,
      activityLeaderboard,
    });
    setLastUpdated(new Date());
    setLoading(false);
  }, [event]);

  useEffect(() => {
    if (!event) return;
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [event, fetchStats]);

  // ── Realtime subscriptions scoped to event ────────────────────────────────
  useEffect(() => {
    if (!event) return;
    const eid = event.id;
    const tables = ["participants", "crew_members", "service_providers", "activity_logs", "session_participations"];
    const channels = tables.map(table =>
      supabase.channel(`live_${eid}_${table}`)
        .on("postgres_changes", { event: "*", schema: "public", table, filter: `event_id=eq.${eid}` }, fetchStats)
        .subscribe()
    );
    return () => { channels.forEach(c => supabase.removeChannel(c)); };
  }, [event, fetchStats]);

  // ── Render states ─────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center space-y-4">
          <SoulcommsLogo size="md" />
          <p className="text-lg font-bold text-foreground mt-4">Event Not Found</p>
          <p className="text-sm text-muted-foreground">No event matches <code className="font-mono text-primary">/live/{slug}</code></p>
          <Link to="/live" className="inline-flex items-center gap-2 text-xs text-primary hover:underline mt-2">
            <ArrowLeft className="h-3 w-3" />All Events
          </Link>
        </div>
      </div>
    );
  }

  const grandTotal      = stats.pCheckedIn + stats.crewCheckedIn + stats.spCheckedIn;
  const grandRegistered = stats.pRegistered + stats.crewRegistered + stats.spRegistered;
  const attendancePct   = grandRegistered > 0 ? Math.round((grandTotal / grandRegistered) * 100) : 0;
  const maxCount        = Math.max(1, ...stats.activityLeaderboard.map(a => a.count));

  const COLORS = [
    "hsl(0 85% 52%)",
    "hsl(200 85% 55%)",
    "hsl(142 72% 45%)",
    "hsl(270 75% 60%)",
    "hsl(35 90% 55%)",
    "hsl(180 60% 45%)",
    "hsl(310 70% 55%)",
    "hsl(60 80% 45%)",
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border px-6 py-4 sticky top-0 z-10 bg-background/80 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <Link to="/live" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <SoulcommsLogo size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-black text-foreground truncate">
                {event?.name ?? "…"}
              </p>
              <div className="flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                {event?.date && (
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-2.5 w-2.5" />
                    {new Date(event.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                {event?.venue && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-2.5 w-2.5" />
                    {event.venue}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground shrink-0">
            <Wifi className={cn("h-3 w-3", loading ? "text-muted-foreground" : "text-success")} />
            <span>Live · {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">

        {/* Grand total hero */}
        <div className="text-center py-4">
          <p className="text-[10px] font-bold uppercase tracking-[4px] text-muted-foreground mb-2">
            Grand Total Attendance
          </p>
          <div
            className="text-7xl font-black text-primary leading-none mb-1"
            style={{ textShadow: "0 0 40px hsl(0 85% 52% / 0.4)" }}
          >
            {grandTotal.toLocaleString()}
          </div>
          <p className="text-sm text-muted-foreground mb-3">
            of {grandRegistered.toLocaleString()} registered · {attendancePct}%
          </p>
          <div className="max-w-xs mx-auto w-full h-2 bg-secondary rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all duration-700"
              style={{ width: `${attendancePct}%` }}
            />
          </div>
        </div>

        {/* Key metrics grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatPill label="Registered"    value={stats.pRegistered}     icon={Users}      />
          <StatPill label="Checked In"    value={stats.pCheckedIn}      icon={UserCheck}  color="hsl(0 85% 52%)" />
          <StatPill label="Total Crew"    value={stats.crewRegistered}  icon={HardHat}    />
          <StatPill label="Total SPs"     value={stats.spRegistered}    icon={Briefcase}  />
          <StatPill label="Experiences"   value={stats.totalExperiences} icon={Zap}       color="hsl(270 75% 60%)" />
          <StatPill label="Unique Engaged" value={stats.uniqueEngaged}  icon={Users}      color="hsl(142 72% 45%)" />
        </div>

        {/* Attendance breakdown */}
        <div>
          <h2 className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground mb-4">
            Attendance Breakdown
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { label: "Participants", color: "hsl(0 85% 52%)",   reg: stats.pRegistered,    in: stats.pCheckedIn,    icon: Users },
              { label: "Crew",         color: "hsl(142 72% 45%)", reg: stats.crewRegistered, in: stats.crewCheckedIn, icon: HardHat },
              { label: "Service Providers", color: "hsl(200 85% 55%)", reg: stats.spRegistered, in: stats.spCheckedIn, icon: Briefcase },
            ].map(cat => {
              const Icon = cat.icon;
              const pct  = cat.reg > 0 ? Math.round((cat.in / cat.reg) * 100) : 0;
              return (
                <div key={cat.label} className="glass-card rounded-2xl p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${cat.color}20` }}>
                      <Icon className="h-4 w-4" style={{ color: cat.color }} />
                    </div>
                    <span className="text-sm font-bold text-foreground">{cat.label}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Registered</p>
                      <p className="text-2xl font-black text-foreground">{cat.reg.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Checked In</p>
                      <p className="text-2xl font-black" style={{ color: cat.color }}>{cat.in.toLocaleString()}</p>
                    </div>
                  </div>
                  <ProgressBar value={cat.in} max={cat.reg} color={cat.color} />
                  <p className="text-xs text-muted-foreground mt-1.5 text-right">{pct}% attendance</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity Leaderboard */}
        {stats.activityLeaderboard.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Trophy className="h-4 w-4 text-primary" />
              <h2 className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground">
                Activity Leaderboard
              </h2>
            </div>
            <div className="space-y-2">
              {stats.activityLeaderboard.map((activity, i) => {
                const rank  = i + 1;
                const color = COLORS[i % COLORS.length];
                const pct   = maxCount > 0 ? (activity.count / maxCount) * 100 : 0;
                const rankBg =
                  rank === 1 ? "bg-primary text-primary-foreground" :
                  rank === 2 ? "bg-foreground/20 text-foreground" :
                  rank === 3 ? "bg-foreground/15 text-foreground" :
                               "bg-secondary text-muted-foreground";
                return (
                  <div
                    key={activity.id}
                    className={cn(
                      "glass-card rounded-xl px-4 py-3 flex items-center gap-4",
                      rank === 1 && "border-primary/30"
                    )}
                  >
                    <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-black shrink-0", rankBg)}>
                      {rank <= 3 ? <Medal className="h-4 w-4" /> : rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{activity.name}</p>
                      <div className="mt-1.5 w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        <span className="text-lg font-black text-primary">{activity.count.toLocaleString()}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">experiences</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by <span className="text-primary font-bold">SOULCOMMS</span> · Auto-refreshes every 30 seconds
        </p>
      </footer>
    </div>
  );
}
