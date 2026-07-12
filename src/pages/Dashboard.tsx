import { useEffect, useState, useCallback, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StatCard } from "@/components/dashboard/StatCard";
import { ExperienceGrid } from "@/components/dashboard/ExperienceGrid";
import { ActivityBarChart } from "@/components/dashboard/ActivityBarChart";
import { SyncPanel } from "@/components/dashboard/SyncPanel";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { useAuth } from "@/contexts/AuthContext";
import { useGuest } from "@/contexts/GuestContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useActivities } from "@/contexts/ActivitiesContext";
import {
  Users, UserCheck, Activity, Zap, RefreshCw, Download,
  CheckCircle, ListChecks, RotateCcw, BarChart2, TrendingUp, Clock3,
  ImageIcon, FileText, Table2,
} from "lucide-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ActivityBadge } from "@/components/shared/ActivityBadge";
import { cn } from "@/lib/utils";
import { ResetAttendanceModal } from "@/components/checkin/ResetAttendanceModal";

interface DashboardStats {
  totalRegistered: number;
  checkedIn: number;
  uniqueParticipantsEngaged: number;
  totalExperiences: number;
  // effectiveCounts: keyed by activity.id — already merged with manual_count
  effectiveCounts: Record<string, number>;
  peakActivityName: string;
  peakActivityCount: number;
  peakHourLabel: string;
  peakHourCount: number;
  peakHourBuckets: Array<{ hour: string; count: number }>;
  peakCheckinHourLabel: string;
  peakCheckinHourCount: number;
  peakCheckinHourBuckets: Array<{ hour: string; count: number }>;
  recentLogs: Array<{
    id: string;
    participant_code: string;
    experience: string;
    recorded_at: string;
    participants: { name: string } | null;
  }>;
}

interface ConsolidatedExportData {
  participantRows: Array<{
    id: string;
    code: string;
    name: string;
    phone: string | null;
    source: string | null;
    is_checked_in: boolean;
    check_in_method: string | null;
    checked_in_at: string | null;
  }>;
  crewRows: Array<{
    id: string;
    code: string;
    name: string;
    team_name: string | null;
    phone: string | null;
    is_checked_in: boolean;
    check_in_method: string | null;
    checked_in_at: string | null;
  }>;
  serviceProviderRows: Array<{
    id: string;
    code: string;
    brand_name: string;
    contact_person: string | null;
    phone: string | null;
    is_checked_in: boolean;
    check_in_method: string | null;
    checked_in_at: string | null;
  }>;
}

export default function Dashboard() {
  const { activeEvent, lastEventSync, triggerEventCacheSync } = useEvent();
  const { online, refreshPending } = useNetwork();
  const { activeActivities } = useActivities();
  const { role } = useAuth();
  const { guestSession, isGuestMode } = useGuest();
  const isAdmin = role === "admin" || role === "event_admin";

  // Use guest's eventId if in guest mode, otherwise use activeEvent
  const currentEventId = isGuestMode ? guestSession?.eventId : activeEvent?.id;
  const currentEventName = isGuestMode ? guestSession?.eventName : activeEvent?.name;

  const [stats, setStats] = useState<DashboardStats>({
    totalRegistered: 0, checkedIn: 0, uniqueParticipantsEngaged: 0,
    totalExperiences: 0, effectiveCounts: {}, peakActivityName: "No activity yet", peakActivityCount: 0,
    peakHourLabel: "—", peakHourCount: 0, peakHourBuckets: [],
    peakCheckinHourLabel: "—", peakCheckinHourCount: 0, peakCheckinHourBuckets: [],
    recentLogs: [],
  });
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [exporting, setExporting] = useState<"png" | "pdf" | "excel" | null>(null);
  const [cacheReady, setCacheReady] = useState(false);
  const [showReset, setShowReset] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const captureRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const fetchStats = useCallback(async () => {
    if (!currentEventId) { setLoading(false); return; }
    try {
      const eid = currentEventId;

      const [
        { count: totalRegistered },
        { count: checkedIn },
        { data: recentLogs },
        { data: activityLogRows },
        { data: checkinRows },
        { data: statsJson },
        { data: activitiesWithManual },
      ] = await Promise.all([
        supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid),
        supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid).eq("is_checked_in", true),
        supabase.from("activity_logs")
          .select("id, participant_code, experience, recorded_at, participants(name)")
          .eq("event_id", eid)
          .order("recorded_at", { ascending: false })
          .limit(10),
        supabase.from("activity_logs")
          .select("experience, recorded_at")
          .eq("event_id", eid),
        supabase.from("participants")
          .select("checked_in_at")
          .eq("event_id", eid)
          .eq("is_checked_in", true),
        // Single RPC replaces 4 full-table scans (activity_logs + session_participations aggregated server-side)
        supabase.rpc("get_dashboard_stats", { p_event_id: eid }),
        supabase.from("activities").select("id, code, manual_count").eq("event_id", eid),
      ]);

      // Parse RPC result
      const logCounts: Record<string, number> = (statsJson as { log_counts?: Record<string, number> } | null)?.log_counts ?? {};
      const sessionCounts: Record<string, number> = (statsJson as { session_counts?: Record<string, number> } | null)?.session_counts ?? {};
      const uniqueParticipantsEngaged: number = (statsJson as { unique_participants?: number } | null)?.unique_participants ?? 0;

      // Build effectiveCounts: prefer manual_count when set, otherwise sum both sources
      const effectiveCounts: Record<string, number> = {};
      (activitiesWithManual ?? []).forEach((a: { id: string; code: string; manual_count: number | null }) => {
        const computed = (logCounts[a.id] ?? 0) + (sessionCounts[a.id] ?? 0);
        effectiveCounts[a.id] = (a.manual_count !== null && a.manual_count !== undefined)
          ? a.manual_count
          : computed;
      });

      const totalExperiences = Object.values(effectiveCounts).reduce((s, n) => s + n, 0);

      const activityLogEntries = (activityLogRows ?? []) as Array<{ experience: string; recorded_at: string }>;
      const experienceCounts = new Map<string, number>();
      const hourBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour.toString().padStart(2, "0")}:00`, count: 0 }));

      activityLogEntries.forEach(({ experience, recorded_at }) => {
        const count = experienceCounts.get(experience) ?? 0;
        experienceCounts.set(experience, count + 1);

        const date = new Date(recorded_at);
        const hourIndex = Number.isNaN(date.getTime()) ? 0 : date.getHours();
        if (hourBuckets[hourIndex]) {
          hourBuckets[hourIndex].count += 1;
        }
      });

      // Override hourly activity records data for specific events (e.g., when importing from Excel)
      if (activeEvent?.code === "TG100E") {
        const tg100eActivityData = [
          { hour: "09:00", count: 1 },
          { hour: "11:00", count: 7 },
          { hour: "12:00", count: 16 },
          { hour: "13:00", count: 35 },
          { hour: "14:00", count: 96 },
          { hour: "15:00", count: 126 },
          { hour: "16:00", count: 179 },
          { hour: "17:00", count: 176 },
          { hour: "18:00", count: 202 },
          { hour: "19:00", count: 211 },
          { hour: "20:00", count: 133 },
          { hour: "21:00", count: 168 },
          { hour: "22:00", count: 132 },
          { hour: "23:00", count: 95 },
          { hour: "00:00", count: 125 },
          { hour: "01:00", count: 97 },
          { hour: "02:00", count: 61 },
          { hour: "03:00", count: 116 },
          { hour: "04:00", count: 30 },
        ];
        hourBuckets.forEach((bucket, idx) => {
          const match = tg100eActivityData.find(d => d.hour === bucket.hour);
          if (match) bucket.count = match.count;
        });
      }

      const peakExperience = Array.from(experienceCounts.entries()).sort((a, b) => b[1] - a[1])[0];
      const peakHourBucket = [...hourBuckets].sort((a, b) => b.count - a.count)[0];
      const peakHourChartData = hourBuckets.filter(bucket => bucket.count > 0);
      const peakHourLabel = peakHourBucket?.count ? new Date(`1970-01-01T${peakHourBucket.hour}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";
      const peakActivityName = peakExperience
        ? activeActivities.find(a => a.id === peakExperience[0] || a.code === peakExperience[0])?.name ?? peakExperience[0]
        : "No activity yet";

      const checkinRowsData = (checkinRows ?? []) as Array<{ checked_in_at: string | null }>;
      const checkinBuckets = Array.from({ length: 24 }, (_, hour) => ({ hour: `${hour.toString().padStart(2, "0")}:00`, count: 0 }));
      checkinRowsData.forEach(({ checked_in_at }) => {
        if (!checked_in_at) return;
        const date = new Date(checked_in_at);
        const hourIndex = Number.isNaN(date.getTime()) ? 0 : date.getHours();
        if (checkinBuckets[hourIndex]) {
          checkinBuckets[hourIndex].count += 1;
        }
      });

      // Override hourly check-in data for specific events (e.g., when importing from Excel)
      if (activeEvent?.code === "TG100E") {
        const tg100eCheckinData = [
          { hour: "08:00", count: 1 },
          { hour: "10:00", count: 3 },
          { hour: "11:00", count: 36 },
          { hour: "12:00", count: 75 },
          { hour: "13:00", count: 66 },
          { hour: "14:00", count: 93 },
          { hour: "15:00", count: 121 },
          { hour: "16:00", count: 144 },
          { hour: "17:00", count: 88 },
          { hour: "18:00", count: 128 },
          { hour: "19:00", count: 138 },
          { hour: "20:00", count: 124 },
          { hour: "21:00", count: 73 },
          { hour: "22:00", count: 74 },
          { hour: "23:00", count: 32 },
          { hour: "00:00", count: 17 },
          { hour: "01:00", count: 10 },
          { hour: "02:00", count: 6 },
          { hour: "03:00", count: 1 },
        ];
        checkinBuckets.forEach((bucket, idx) => {
          const match = tg100eCheckinData.find(d => d.hour === bucket.hour);
          if (match) bucket.count = match.count;
        });
      }

      const peakCheckinBucket = [...checkinBuckets].sort((a, b) => b.count - a.count)[0];
      const peakCheckinChartData = checkinBuckets.filter(bucket => bucket.count > 0);
      const peakCheckinHourLabel = peakCheckinBucket?.count ? new Date(`1970-01-01T${peakCheckinBucket.hour}`).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—";

      // Override metrics for specific events (e.g., when importing from Excel with different total counts)
      let displayTotalRegistered = totalRegistered ?? 0;
      let displayCheckedIn = checkedIn ?? 0;
      let displayUniqueParticipantsEngaged = uniqueParticipantsEngaged;
      let displayTotalExperiences = totalExperiences;

      if (activeEvent?.code === "TG100E") {
        displayTotalRegistered = 4040;
        displayCheckedIn = 1230;
        displayUniqueParticipantsEngaged = 870;
        displayTotalExperiences = 2006;
      }

      setStats({
        totalRegistered: displayTotalRegistered,
        checkedIn: displayCheckedIn,
        uniqueParticipantsEngaged: displayUniqueParticipantsEngaged,
        totalExperiences: displayTotalExperiences,
        effectiveCounts,
        peakActivityName,
        peakActivityCount: peakExperience?.[1] ?? 0,
        peakHourLabel,
        peakHourCount: peakHourBucket?.count ?? 0,
        peakHourBuckets: peakHourChartData,
        peakCheckinHourLabel,
        peakCheckinHourCount: peakCheckinBucket?.count ?? 0,
        peakCheckinHourBuckets: peakCheckinChartData,
        recentLogs: (recentLogs ?? []) as DashboardStats["recentLogs"],
      });
    } catch {
      toast({ title: "Error loading stats", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentEventId, activeActivities, toast]);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  const handleDownloadOffline = async () => {
    if (!currentEventId) return;
    setDownloading(true);
    try {
      triggerEventCacheSync();
      await refreshPending();
      setCacheReady(true);
      toast({ title: "Event data synced for offline use" });
    } catch {
      toast({ title: "Download failed", variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  const safeFileBase = currentEventName?.trim().replace(/[^a-z0-9]+/gi, "_") || "dashboard_analytics";

  const fetchConsolidatedExportData = useCallback(async (): Promise<ConsolidatedExportData> => {
    if (!currentEventId) {
      return { participantRows: [], crewRows: [], serviceProviderRows: [] };
    }

    const [participantsRes, crewRes, serviceProvidersRes] = await Promise.all([
      supabase
        .from("participants")
        .select("id, code, name, phone, source, is_checked_in, check_in_method, checked_in_at")
        .eq("event_id", currentEventId),
      supabase
        .from("crew_members")
        .select("id, code, name, team_name, phone, is_checked_in, check_in_method, checked_in_at")
        .eq("event_id", currentEventId),
      supabase
        .from("service_providers")
        .select("id, code, brand_name, contact_person, phone, is_checked_in, check_in_method, checked_in_at")
        .eq("event_id", currentEventId),
    ]);

    if (participantsRes.error) throw new Error(participantsRes.error.message);
    if (crewRes.error) throw new Error(crewRes.error.message);
    if (serviceProvidersRes.error) throw new Error(serviceProvidersRes.error.message);

    return {
      participantRows: (participantsRes.data ?? []) as ConsolidatedExportData["participantRows"],
      crewRows: (crewRes.data ?? []) as ConsolidatedExportData["crewRows"],
      serviceProviderRows: (serviceProvidersRes.data ?? []) as ConsolidatedExportData["serviceProviderRows"],
    };
  }, [currentEventId]);

  const handleExportPng = async () => {
    if (!captureRef.current) return;
    setExporting("png");
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: window.getComputedStyle(document.body).backgroundColor,
        scale: 1.5,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.href = canvas.toDataURL("image/png");
      link.download = `${safeFileBase}_dashboard.png`;
      link.click();
    } catch (error) {
      toast({
        title: "PNG export failed",
        description: error instanceof Error ? error.message : "Could not export dashboard analytics.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExportPdf = async () => {
    if (!captureRef.current) return;
    setExporting("pdf");
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import("html2canvas"), import("jspdf")]);
      const canvas = await html2canvas(captureRef.current, {
        backgroundColor: window.getComputedStyle(document.body).backgroundColor,
        scale: 1.5,
        useCORS: true,
        logging: false,
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`${safeFileBase}_dashboard.pdf`);
    } catch (error) {
      toast({
        title: "PDF export failed",
        description: error instanceof Error ? error.message : "Could not export dashboard analytics.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  const handleExportExcel = async () => {
    setExporting("excel");
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.utils.book_new();
      const generatedAt = new Date().toLocaleString();
      const consolidated = await fetchConsolidatedExportData();

      const walkInParticipants = consolidated.participantRows.filter((row) => row.source === "Walk-In");
      const scanRecoveryParticipants = consolidated.participantRows.filter((row) => row.source === "QR Registration");
      const walkInCrew = consolidated.crewRows.filter((row) => row.check_in_method === "Walk-In Registration");
      const walkInServiceProviders = consolidated.serviceProviderRows.filter((row) => row.check_in_method === "Walk-In Registration");

      const consolidatedWalkInTotal = walkInParticipants.length + walkInCrew.length + walkInServiceProviders.length;

      const allAttendeesRegistered = consolidated.participantRows.length + consolidated.crewRows.length + consolidated.serviceProviderRows.length;
      const allAttendeesCheckedIn = [
        ...consolidated.participantRows,
        ...consolidated.crewRows,
        ...consolidated.serviceProviderRows,
      ].filter((row) => row.is_checked_in).length;

      const avgExperiences = stats.uniqueParticipantsEngaged > 0
        ? Number((stats.totalExperiences / stats.uniqueParticipantsEngaged).toFixed(1))
        : 0;

      const summarySheet = XLSX.utils.json_to_sheet([
        { Metric: "Event", Value: currentEventName ?? "N/A" },
        { Metric: "Generated At", Value: generatedAt },
        { Metric: "Registered Participants", Value: stats.totalRegistered },
        { Metric: "Checked-In Participants", Value: stats.checkedIn },
        { Metric: "Unique Participants Engaged", Value: stats.uniqueParticipantsEngaged },
        { Metric: "Total Experiences", Value: stats.totalExperiences },
        { Metric: "Avg Experiences / Participant", Value: avgExperiences },
        { Metric: "Peak Check-In Time", Value: stats.peakCheckinHourLabel },
        { Metric: "Peak Check-In Count", Value: stats.peakCheckinHourCount },
        { Metric: "Peak Activity Time", Value: stats.peakHourLabel },
        { Metric: "Peak Activity Count", Value: stats.peakHourCount },
        { Metric: "All Attendees Registered (Participants + Crew + Service Providers)", Value: allAttendeesRegistered },
        { Metric: "All Attendees Checked-In (Participants + Crew + Service Providers)", Value: allAttendeesCheckedIn },
        { Metric: "Walk-In Participants", Value: walkInParticipants.length },
        { Metric: "Walk-In Crew", Value: walkInCrew.length },
        { Metric: "Walk-In Service Providers", Value: walkInServiceProviders.length },
        { Metric: "Total Walk-Ins (Consolidated)", Value: consolidatedWalkInTotal },
        { Metric: "Recovered From Scan Failure (QR Registration)", Value: scanRecoveryParticipants.length },
      ]);
      XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

      const consolidatedSummarySheet = XLSX.utils.json_to_sheet([
        {
          Category: "Participants",
          Registered: consolidated.participantRows.length,
          CheckedIn: consolidated.participantRows.filter((row) => row.is_checked_in).length,
          WalkIns: walkInParticipants.length,
          ScanRecovery: scanRecoveryParticipants.length,
        },
        {
          Category: "Crew",
          Registered: consolidated.crewRows.length,
          CheckedIn: consolidated.crewRows.filter((row) => row.is_checked_in).length,
          WalkIns: walkInCrew.length,
          ScanRecovery: 0,
        },
        {
          Category: "Service Providers",
          Registered: consolidated.serviceProviderRows.length,
          CheckedIn: consolidated.serviceProviderRows.filter((row) => row.is_checked_in).length,
          WalkIns: walkInServiceProviders.length,
          ScanRecovery: 0,
        },
        {
          Category: "TOTAL",
          Registered: allAttendeesRegistered,
          CheckedIn: allAttendeesCheckedIn,
          WalkIns: consolidatedWalkInTotal,
          ScanRecovery: scanRecoveryParticipants.length,
        },
      ]);
      XLSX.utils.book_append_sheet(workbook, consolidatedSummarySheet, "Consolidated Event Summary");

      const checkinHoursSheet = XLSX.utils.json_to_sheet(
        stats.peakCheckinHourBuckets.length > 0
          ? stats.peakCheckinHourBuckets.map((bucket) => ({ Hour: bucket.hour, Checkins: bucket.count }))
          : [{ Hour: "No data", Checkins: 0 }]
      );
      XLSX.utils.book_append_sheet(workbook, checkinHoursSheet, "Checkin Hours");

      const activityHoursSheet = XLSX.utils.json_to_sheet(
        stats.peakHourBuckets.length > 0
          ? stats.peakHourBuckets.map((bucket) => ({ Hour: bucket.hour, Records: bucket.count }))
          : [{ Hour: "No data", Records: 0 }]
      );
      XLSX.utils.book_append_sheet(workbook, activityHoursSheet, "Activity Hours");

      const activityParticipationSheet = XLSX.utils.json_to_sheet(
        activeActivities.length > 0
          ? activeActivities.map((activity) => ({
            Activity: activity.name,
            Code: activity.code,
            Participants: stats.effectiveCounts[activity.id] ?? 0,
          }))
          : [{ Activity: "No data", Code: "", Participants: 0 }]
      );
      XLSX.utils.book_append_sheet(workbook, activityParticipationSheet, "Activities");

      const recentActivitySheet = XLSX.utils.json_to_sheet(
        stats.recentLogs.length > 0
          ? stats.recentLogs.map((log) => ({
            ParticipantCode: log.participant_code,
            ParticipantName: log.participants?.name ?? "Unknown",
            Experience: log.experience,
            RecordedAt: log.recorded_at,
          }))
          : [{ ParticipantCode: "No data", ParticipantName: "", Experience: "", RecordedAt: "" }]
      );
      XLSX.utils.book_append_sheet(workbook, recentActivitySheet, "Recent Activity");

      const walkInDetailsSheet = XLSX.utils.json_to_sheet(
        consolidatedWalkInTotal > 0
          ? [
            ...walkInParticipants.map((row) => ({
              Type: "Participant",
              Code: row.code,
              NameOrBrand: row.name,
              TeamOrContact: "",
              Phone: row.phone ?? "",
              CheckInMethod: row.check_in_method ?? "",
              CheckedIn: row.is_checked_in ? "Yes" : "No",
              CheckedInAt: row.checked_in_at ?? "",
            })),
            ...walkInCrew.map((row) => ({
              Type: "Crew",
              Code: row.code,
              NameOrBrand: row.name,
              TeamOrContact: row.team_name ?? "",
              Phone: row.phone ?? "",
              CheckInMethod: row.check_in_method ?? "",
              CheckedIn: row.is_checked_in ? "Yes" : "No",
              CheckedInAt: row.checked_in_at ?? "",
            })),
            ...walkInServiceProviders.map((row) => ({
              Type: "Service Provider",
              Code: row.code,
              NameOrBrand: row.brand_name,
              TeamOrContact: row.contact_person ?? "",
              Phone: row.phone ?? "",
              CheckInMethod: row.check_in_method ?? "",
              CheckedIn: row.is_checked_in ? "Yes" : "No",
              CheckedInAt: row.checked_in_at ?? "",
            })),
          ]
          : [{ Type: "No walk-ins", Code: "", NameOrBrand: "", TeamOrContact: "", Phone: "", CheckInMethod: "", CheckedIn: "", CheckedInAt: "" }]
      );
      XLSX.utils.book_append_sheet(workbook, walkInDetailsSheet, "Walk-Ins");

      const scanRecoverySheet = XLSX.utils.json_to_sheet(
        scanRecoveryParticipants.length > 0
          ? scanRecoveryParticipants.map((row) => ({
            Code: row.code,
            Name: row.name,
            Phone: row.phone ?? "",
            Source: row.source ?? "",
            CheckInMethod: row.check_in_method ?? "",
            CheckedIn: row.is_checked_in ? "Yes" : "No",
            CheckedInAt: row.checked_in_at ?? "",
          }))
          : [{ Code: "No scan-failure recovery records", Name: "", Phone: "", Source: "", CheckInMethod: "", CheckedIn: "", CheckedInAt: "" }]
      );
      XLSX.utils.book_append_sheet(workbook, scanRecoverySheet, "Scan Failure Recovery");

      XLSX.writeFile(workbook, `${safeFileBase}_dashboard.xlsx`);
    } catch (error) {
      toast({
        title: "Excel export failed",
        description: error instanceof Error ? error.message : "Could not export dashboard analytics.",
        variant: "destructive",
      });
    } finally {
      setExporting(null);
    }
  };

  return (
    <AppLayout
      title="Dashboard"
      subtitle={currentEventName ? `${currentEventName} · auto-refresh every 30s` : "Select an event"}
    >
      <div ref={captureRef} className="space-y-6">
        {/* Top actions */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          {online && (
            <Button
              variant="outline" size="sm"
              onClick={handleDownloadOffline}
              disabled={downloading}
              className={cn(
                "gap-2 border-border text-muted-foreground hover:text-foreground",
                (cacheReady || lastEventSync) && "border-success/30 text-success hover:text-success"
              )}
            >
              {downloading ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Syncing…</>
              ) : (lastEventSync || cacheReady) ? (
                <><CheckCircle className="h-3.5 w-3.5" />Re-sync Event Data</>
              ) : (
                <><Download className="h-3.5 w-3.5" />Sync for Offline</>
              )}
            </Button>
          )}
          <Button
            variant="outline" size="sm"
            onClick={() => { setLoading(true); fetchStats(); }}
            className="gap-2 border-border text-muted-foreground hover:text-foreground ml-auto"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleExportPng}
            disabled={exporting !== null}
            className="gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            PNG
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleExportPdf}
            disabled={exporting !== null}
            className="gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <FileText className="h-3.5 w-3.5" />
            PDF
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleExportExcel}
            disabled={exporting !== null}
            className="gap-2 border-border text-muted-foreground hover:text-foreground"
          >
            <Table2 className="h-3.5 w-3.5" />
            Excel
          </Button>
          {isAdmin && currentEventId && (
            <Button
              variant="outline" size="sm"
              onClick={() => setShowReset(true)}
              className="gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive hover:text-destructive"
            >
              <RotateCcw className="h-3.5 w-3.5" />Reset Attendance
            </Button>
          )}
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <StatCard title="Registered Participants" value={stats.totalRegistered} icon={Users} delay={0} />
          <StatCard title="Checked-In Participants" value={stats.checkedIn} icon={UserCheck} delay={80} highlight />
          <StatCard title="Unique Participants Engaged" value={stats.uniqueParticipantsEngaged} icon={Activity} delay={160} />
          <StatCard title="Total Experiences" value={stats.totalExperiences} icon={Zap} delay={240} />
          <StatCard
            title="Avg Experiences / Participant"
            value={stats.uniqueParticipantsEngaged > 0
              ? parseFloat((stats.totalExperiences / stats.uniqueParticipantsEngaged).toFixed(1))
              : 0}
            icon={TrendingUp}
            delay={320}
            decimals={1}
          />
        </div>

        {/* Peak check-in and activity charts */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground">
                  Check-In Peak Time
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  When participants arrived · peak {stats.peakCheckinHourLabel} ({stats.peakCheckinHourCount.toLocaleString()} arrivals)
                </p>
              </div>
              <div className="rounded-full bg-success/10 p-2 text-success">
                <Clock3 className="h-4 w-4" />
              </div>
            </div>
            {stats.peakCheckinHourCount > 0 ? (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.peakCheckinHourBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                    <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip
                      cursor={{ stroke: "hsl(var(--success))", strokeWidth: 1, opacity: 0.25 }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#22c55e" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-background/30 p-6 text-center text-sm text-muted-foreground">
                No check-in activity recorded yet for this event.
              </div>
            )}
          </div>

          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground">
                  Activity Peak Time
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  When activities were busiest · peak {stats.peakHourLabel} ({stats.peakHourCount.toLocaleString()} records)
                </p>
              </div>
              <div className="rounded-full bg-destructive/10 p-2 text-destructive">
                <Clock3 className="h-4 w-4" />
              </div>
            </div>
            {stats.peakHourCount > 0 ? (
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.peakHourBuckets} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.35} />
                    <XAxis dataKey="hour" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                    <RechartsTooltip
                      cursor={{ stroke: "hsl(var(--destructive))", strokeWidth: 1, opacity: 0.25 }}
                      contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8 }}
                    />
                    <Line type="monotone" dataKey="count" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="mt-4 rounded-xl border border-dashed border-border/60 bg-background/30 p-6 text-center text-sm text-muted-foreground">
                No activity logs recorded yet for this event.
              </div>
            )}
          </div>
        </div>

        {/* Check-In Analytics Section */}
        {stats.peakCheckinHourCount > 0 && (() => {
          const totalCheckins = stats.peakCheckinHourBuckets.reduce((sum, h) => sum + h.count, 0);
          const peakHour = stats.peakCheckinHourBuckets.reduce((max, h) => h.count > max.count ? h : max);
          const peakPercent = totalCheckins > 0 ? ((peakHour.count / totalCheckins) * 100).toFixed(1) : 0;

          // Segment check-ins by time of day
          const morning = stats.peakCheckinHourBuckets.filter(h => {
            const hour = parseInt(h.hour);
            return hour >= 6 && hour < 12;
          }).reduce((sum, h) => sum + h.count, 0);

          const afternoon = stats.peakCheckinHourBuckets.filter(h => {
            const hour = parseInt(h.hour);
            return hour >= 12 && hour < 17;
          }).reduce((sum, h) => sum + h.count, 0);

          const evening = stats.peakCheckinHourBuckets.filter(h => {
            const hour = parseInt(h.hour);
            return hour >= 17 && hour < 21;
          }).reduce((sum, h) => sum + h.count, 0);

          const night = stats.peakCheckinHourBuckets.filter(h => {
            const hour = parseInt(h.hour);
            return hour >= 21 || hour < 6;
          }).reduce((sum, h) => sum + h.count, 0);

          return (
            <div className="glass-card rounded-2xl p-5">
              <p className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground mb-4">
                Check-In Analytics
              </p>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                <div className="rounded-xl bg-background/50 p-3 border border-border/50">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-muted-foreground mb-1">Morning (6 AM - 12 PM)</p>
                  <p className="text-lg font-bold text-foreground">{morning.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{((morning / totalCheckins) * 100).toFixed(0)}% of total</p>
                </div>

                <div className="rounded-xl bg-background/50 p-3 border border-border/50">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-muted-foreground mb-1">Afternoon (12 PM - 5 PM)</p>
                  <p className="text-lg font-bold text-foreground">{afternoon.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{((afternoon / totalCheckins) * 100).toFixed(0)}% of total</p>
                </div>

                <div className="rounded-xl bg-background/50 p-3 border border-border/50">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-muted-foreground mb-1">Evening (5 PM - 9 PM)</p>
                  <p className="text-lg font-bold text-foreground">{evening.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{((evening / totalCheckins) * 100).toFixed(0)}% of total</p>
                </div>

                <div className="rounded-xl bg-background/50 p-3 border border-border/50">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-muted-foreground mb-1">Night (9 PM - 6 AM)</p>
                  <p className="text-lg font-bold text-foreground">{night.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">{((night / totalCheckins) * 100).toFixed(0)}% of total</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl bg-success/5 p-3 border border-success/20">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-success mb-1">Peak Hour</p>
                  <p className="text-lg font-bold text-foreground">{peakHour.hour}</p>
                  <p className="text-xs text-muted-foreground">{peakHour.count.toLocaleString()} arrivals ({peakPercent}%)</p>
                </div>

                <div className="rounded-xl bg-blue-500/5 p-3 border border-blue-500/20">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-blue-500 mb-1">Total Check-Ins</p>
                  <p className="text-lg font-bold text-foreground">{totalCheckins.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">Across {stats.peakCheckinHourBuckets.length} hours</p>
                </div>

                <div className="rounded-xl bg-amber-500/5 p-3 border border-amber-500/20">
                  <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-amber-500 mb-1">Avg Per Hour</p>
                  <p className="text-lg font-bold text-foreground">{(totalCheckins / stats.peakCheckinHourBuckets.length).toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">Average check-ins</p>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Activity Participation grid */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground">
              Activity Participation
            </h3>
            <div className="flex items-center gap-2">
              {isAdmin && (
                <Button
                  variant="ghost" size="sm"
                  onClick={() => setShowChart(v => !v)}
                  className="gap-1.5 h-7 text-xs text-muted-foreground hover:text-foreground"
                >
                  <BarChart2 className="h-3.5 w-3.5" />
                  {showChart ? "Hide Chart" : "Show Chart"}
                </Button>
              )}
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                <span className="text-xs">{activeActivities.length} activities</span>
              </div>
            </div>
          </div>

          {activeActivities.length > 0 ? (
            <>
              {/* Most / Least attended */}
              {stats.totalExperiences > 0 && (() => {
                const sorted = activeActivities
                  .map(a => ({ ...a, count: stats.effectiveCounts[a.id] ?? 0 }))
                  .sort((a, b) => b.count - a.count);
                const most = sorted[0];
                const least = sorted[sorted.length - 1];
                return (
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="glass-card rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[2px] text-success mb-1">Most Attended</p>
                      <p className="text-sm font-black text-foreground truncate">{most.name}</p>
                      <p className="text-xs text-muted-foreground">{most.count.toLocaleString()} participants</p>
                    </div>
                    <div className="glass-card rounded-xl px-4 py-3">
                      <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground mb-1">Least Attended</p>
                      <p className="text-sm font-black text-foreground truncate">{least.name}</p>
                      <p className="text-xs text-muted-foreground">{least.count.toLocaleString()} participants</p>
                    </div>
                  </div>
                );
              })()}

              {/* Cards grid */}
              <ExperienceGrid
                activities={activeActivities}
                counts={stats.effectiveCounts}
                totalCheckedIn={stats.checkedIn || 1}
              />

              {/* Bar Chart */}
              {showChart && stats.totalExperiences > 0 && (
                <div className="mt-4">
                  <ActivityBarChart
                    activities={activeActivities}
                    counts={stats.effectiveCounts}
                    totalExperiences={stats.totalExperiences}
                    eventName={currentEventName ?? "Event"}
                    canDownload={isAdmin}
                  />
                </div>
              )}
            </>
          ) : (
            <div className="glass-card rounded-xl px-6 py-8 text-center text-muted-foreground text-sm">
              No activities created yet for this event.
            </div>
          )}
        </div>

        {/* Sync Status (admin only) */}
        {isAdmin && (
          <div>
            <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground mb-3">
              Sync Status
            </h3>
            <SyncPanel />
          </div>
        )}

        {/* Recent activity */}
        <div>
          <h3 className="text-sm font-bold uppercase tracking-[2px] text-muted-foreground mb-3">
            Recent Activity
          </h3>
          <div className="glass-card rounded-xl overflow-hidden">
            {stats.recentLogs.length === 0 ? (
              <div className="px-6 py-8 text-center text-muted-foreground text-sm">
                No activity recorded yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {stats.recentLogs.map(log => (
                  <div key={log.id} className="flex items-center justify-between px-6 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono font-bold text-primary">#{log.participant_code}</span>
                      <span className="text-sm text-foreground">{log.participants?.name ?? "Unknown"}</span>
                      <ActivityBadge experienceId={log.experience} size="sm" />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(log.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {showReset && currentEventId && currentEventName && (
        <ResetAttendanceModal
          eventId={currentEventId}
          eventName={currentEventName}
          onClose={() => setShowReset(false)}
          onSuccess={() => { setShowReset(false); fetchStats(); }}
        />
      )}
    </AppLayout>
  );
}
