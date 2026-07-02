import { useState, useEffect, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { stopAllEventActivityTimers } from "@/lib/activityTimeTracking";
import {
    Clock, Users, TrendingUp, Activity, Search, Filter, Download, ImageIcon, FileText, Table2,
    BarChart3, Award, Zap, Timer, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface ParticipantData {
    participant_id: string;
    participant_name: string;
    participant_code: string;
    participant_type: string;
    activities: Array<{
        activity_name: string;
        total_minutes: number;
        total_seconds: number;
        checkin_count: number;
        is_currently_active?: boolean;
        last_checkin?: string;
    }>;
    total_seconds: number;
    total_minutes: number;
}

interface ActivityEngagementData {
    activity_id: string;
    activity_name: string;
    total_participants: number;
    total_checkins: number;
    average_duration_seconds: number;
    total_time_seconds: number;
    total_time_minutes: number;
    total_time_hours: number;
}

type ParticipantRow = {
    id: string;
    name: string;
    code: string;
    source: string | null;
};

type ActivityRow = {
    id: string;
    name: string;
};

type ParticipationRow = {
    id: string;
    event_id: string;
    participant_id: string;
    activity_id: string;
    checkin_time: string;
    checkout_time: string | null;
    duration_minutes: number | null;
};

type ActivityLogRow = {
    participant_id: string | null;
    activity_id: string | null;
    recorded_at: string | null;
};

export default function ActivityTimeAnalytics() {
    const { user } = useAuth();
    const { activeEvent, setActiveEvent } = useEvent();
    const { toast } = useToast();
    const eventId = activeEvent?.id ?? "";
    const isEventClosed = activeEvent?.status === "completed";
    const captureRef = useRef<HTMLDivElement>(null);

    const [view, setView] = useState<"participants" | "activities">("participants");
    const [loading, setLoading] = useState(true);
    const [exporting, setExporting] = useState<"png" | "pdf" | "excel" | null>(null);
    const [stoppingAll, setStoppingAll] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [participantTypeFilter, setParticipantTypeFilter] = useState<string>("all");
    const [participantTypes, setParticipantTypes] = useState<string[]>([]);

    const [participants, setParticipants] = useState<ParticipantData[]>([]);
    const [activities, setActivities] = useState<ActivityEngagementData[]>([]);
    const [nowTick, setNowTick] = useState(() => Date.now());
    const [fetchedAtTick, setFetchedAtTick] = useState(() => Date.now());
    const [participantRows, setParticipantRows] = useState<ParticipantRow[]>([]);
    const [activityRows, setActivityRows] = useState<ActivityRow[]>([]);
    const [participationRows, setParticipationRows] = useState<ParticipationRow[]>([]);
    const [activityLogRows, setActivityLogRows] = useState<ActivityLogRow[]>([]);

    const withTimeout = async (promise: PromiseLike<any> | any, timeoutMs = 12000): Promise<any> => {
        return await new Promise<any>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error("Request timed out"));
            }, timeoutMs);

            promise
                .then((result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                })
                .catch((error) => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    };

    useEffect(() => {
        const interval = setInterval(() => setNowTick(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!user) {
            setLoading(false);
            return;
        }
        if (!eventId) {
            setParticipants([]);
            setActivities([]);
            setLoading(false);
            return;
        }
        fetchData();
    }, [eventId, user]);

    useEffect(() => {
        if (!participantRows.length || !activityRows.length) return;

        const rebuild = () => {
            const activityMap = new Map<string, string>();
            activityRows.forEach((activity) => activityMap.set(activity.id, activity.name));

            const fallbackLogsByParticipant = new Map<string, ActivityLogRow[]>();
            activityLogRows.forEach((row) => {
                if (!row.participant_id || !row.activity_id || !row.recorded_at) return;
                const rows = fallbackLogsByParticipant.get(row.participant_id) ?? [];
                rows.push(row);
                fallbackLogsByParticipant.set(row.participant_id, rows);
            });
            const activeParticipantSet = new Set(
                participationRows
                    .filter((row) => row.checkout_time == null)
                    .map((row) => row.participant_id)
            );
            const hasParticipationRows = participationRows.length > 0;
            const effectiveActiveParticipantSet = isEventClosed ? new Set<string>() : activeParticipantSet;
            const fallbackNowTick = isEventClosed
                ? fetchedAtTick
                : (hasParticipationRows
                    ? (effectiveActiveParticipantSet.size > 0 ? nowTick : fetchedAtTick)
                    : nowTick);

            const types = new Set<string>();
            const processedParticipants: ParticipantData[] = [];

            participantRows.forEach((participant) => {
                if (participant.source) {
                    types.add(participant.source);
                }

                const participations = participationRows.filter((row) => row.participant_id === participant.id);
                const activityActivityMap = new Map<string, { name: string; seconds: number; count: number; isActive: boolean; lastCheckin?: string }>();

                if (participations.length > 0) {
                    participations.forEach((participation) => {
                        const activityName = activityMap.get(participation.activity_id) || `Activity ${participation.activity_id}`;

                        if (!activityActivityMap.has(participation.activity_id)) {
                            activityActivityMap.set(participation.activity_id, {
                                name: activityName,
                                seconds: 0,
                                count: 0,
                                isActive: false,
                                lastCheckin: participation.checkin_time,
                            });
                        }

                        const data = activityActivityMap.get(participation.activity_id)!;
                        data.count += 1;
                        data.lastCheckin = participation.checkin_time;

                        const checkinTime = new Date(participation.checkin_time).getTime();
                        const checkoutTime = participation.checkout_time
                            ? new Date(participation.checkout_time).getTime()
                            : (isEventClosed ? fetchedAtTick : nowTick);
                        const seconds = Math.max(0, Math.round((checkoutTime - checkinTime) / 1000));
                        data.seconds += seconds;
                        if (!participation.checkout_time && !isEventClosed) data.isActive = true;
                    });
                } else {
                    const logs = (fallbackLogsByParticipant.get(participant.id) ?? []).slice().sort(
                        (a, b) => new Date(a.recorded_at!).getTime() - new Date(b.recorded_at!).getTime()
                    );

                    logs.forEach((log, index) => {
                        if (!log.activity_id || !log.recorded_at) return;
                        const activityName = activityMap.get(log.activity_id) || `Activity ${log.activity_id}`;
                        const nextLog = logs[index + 1];
                        const isTerminalActive = !nextLog
                            && !isEventClosed
                            && (!hasParticipationRows || effectiveActiveParticipantSet.has(participant.id));
                        const checkinTime = new Date(log.recorded_at).getTime();
                        const checkoutTime = nextLog?.recorded_at
                            ? new Date(nextLog.recorded_at).getTime()
                            : (isTerminalActive ? nowTick : fallbackNowTick);

                        if (!activityActivityMap.has(log.activity_id)) {
                            activityActivityMap.set(log.activity_id, {
                                name: activityName,
                                seconds: 0,
                                count: 0,
                                isActive: false,
                                lastCheckin: log.recorded_at,
                            });
                        }

                        const data = activityActivityMap.get(log.activity_id)!;
                        data.count += 1;
                        data.lastCheckin = log.recorded_at;
                        data.seconds += Math.max(0, Math.round((checkoutTime - checkinTime) / 1000));
                        data.isActive = isTerminalActive;
                    });
                }

                const activitiesList = Array.from(activityActivityMap.entries()).map(([_, data]) => ({
                    activity_name: data.name,
                    total_minutes: Math.round(data.seconds / 60),
                    total_seconds: data.seconds,
                    checkin_count: data.count,
                    is_currently_active: data.isActive,
                    last_checkin: data.lastCheckin,
                }));

                const totalSeconds = activitiesList.reduce((sum, a) => sum + a.total_seconds, 0);

                processedParticipants.push({
                    participant_id: participant.id,
                    participant_name: participant.name,
                    participant_code: participant.code || "N/A",
                    participant_type: participant.source || "General",
                    activities: activitiesList.sort((a, b) => b.total_seconds - a.total_seconds),
                    total_seconds: totalSeconds,
                    total_minutes: Math.round(totalSeconds / 60),
                });
            });

            const engagementMap = new Map<string, {
                name: string;
                participants: Set<string>;
                checkins: number;
                totalSeconds: number;
            }>();

            participationRows.forEach((record) => {
                const activityName = activityMap.get(record.activity_id) || `Activity ${record.activity_id}`;
                if (!engagementMap.has(record.activity_id)) {
                    engagementMap.set(record.activity_id, {
                        name: activityName,
                        participants: new Set(),
                        checkins: 0,
                        totalSeconds: 0,
                    });
                }

                const data = engagementMap.get(record.activity_id)!;
                data.participants.add(record.participant_id);
                data.checkins += 1;
                const checkinTime = new Date(record.checkin_time).getTime();
                const checkoutTime = record.checkout_time
                    ? new Date(record.checkout_time).getTime()
                    : (isEventClosed ? fetchedAtTick : nowTick);
                data.totalSeconds += Math.max(0, Math.round((checkoutTime - checkinTime) / 1000));
            });

            if (participationRows.length === 0) {
                activityLogRows.forEach((log) => {
                    if (!log.participant_id || !log.activity_id || !log.recorded_at) return;
                    const activityName = activityMap.get(log.activity_id) || `Activity ${log.activity_id}`;
                    if (!engagementMap.has(log.activity_id)) {
                        engagementMap.set(log.activity_id, {
                            name: activityName,
                            participants: new Set(),
                            checkins: 0,
                            totalSeconds: 0,
                        });
                    }

                    const data = engagementMap.get(log.activity_id)!;
                    data.participants.add(log.participant_id);
                    data.checkins += 1;
                });
            }

            const engagementList: ActivityEngagementData[] = Array.from(engagementMap.entries()).map(([activityId, data]) => {
                const avgDuration = data.checkins > 0 ? Math.round(data.totalSeconds / data.checkins) : 0;
                return {
                    activity_id: activityId,
                    activity_name: data.name,
                    total_participants: data.participants.size,
                    total_checkins: data.checkins,
                    average_duration_seconds: avgDuration,
                    total_time_seconds: data.totalSeconds,
                    total_time_minutes: Math.round(data.totalSeconds / 60),
                    total_time_hours: Math.round((data.totalSeconds / 3600) * 100) / 100,
                };
            });

            setParticipantTypes(Array.from(types).sort());
            setParticipants(processedParticipants.sort((a, b) => b.total_minutes - a.total_minutes));
            setActivities(engagementList.sort((a, b) => b.total_time_minutes - a.total_time_minutes));
        };

        rebuild();
    }, [participantRows, activityRows, participationRows, activityLogRows, nowTick, fetchedAtTick, isEventClosed]);

    const fetchData = async () => {
        if (!eventId) {
            setLoading(false);
            return;
        }
        const toMinutes = (checkinTime: string, checkoutTime?: string | null, durationMinutes?: number | null) => {
            if (typeof durationMinutes === "number" && Number.isFinite(durationMinutes)) {
                return Math.max(0, Math.round(durationMinutes));
            }

            const start = new Date(checkinTime).getTime();
            const end = checkoutTime ? new Date(checkoutTime).getTime() : Date.now();
            return Math.max(0, Math.round((end - start) / 60000));
        };

        try {
            setLoading(true);

            // Fetch simple participant data
            const { data: participantData, error: participantError } = await withTimeout(
                (supabase as any)
                    .from("participants")
                    .select("id, name, code, source")
                    .eq("event_id", eventId)
            );

            if (participantError) throw participantError;

            // Fetch all activity participation records
            const { data: allParticipationsRaw, error: participationError } = await withTimeout(
                (supabase as any)
                    .from("activity_participation_time")
                    .select("id, event_id, participant_id, activity_id, checkin_time, checkout_time, duration_minutes")
                    .eq("event_id", eventId)
            );

            // If time-tracking table is not yet available on an environment,
            // keep the page usable instead of hard-failing.
            const allParticipations = participationError ? [] : (allParticipationsRaw ?? []);

            // Fetch activities to get names
            const { data: activitiesData, error: activitiesError } = await withTimeout(
                (supabase as any)
                    .from("activities")
                    .select("id, name")
                    .eq("event_id", eventId)
            );

            if (activitiesError) throw activitiesError;

            const { data: activityLogsData, error: activityLogsError } = await withTimeout(
                (supabase as any)
                    .from("activity_logs")
                    .select("participant_id, activity_id, recorded_at")
                    .eq("event_id", eventId)
            );

            if (activityLogsError) throw activityLogsError;

            setParticipantRows((participantData ?? []) as ParticipantRow[]);
            setActivityRows((activitiesData ?? []) as ActivityRow[]);
            setParticipationRows(allParticipations as ParticipationRow[]);
            setActivityLogRows((activityLogsData ?? []) as ActivityLogRow[]);
            setFetchedAtTick(Date.now());
        } catch (error) {
            console.error("Error fetching analytics data:", error);
            toast({
                title: "Error loading analytics",
                description: error instanceof Error ? error.message : "Unknown error",
                variant: "destructive",
            });
        } finally {
            setLoading(false);
        }
    };

    // Filter participants based on search and type
    const filteredParticipants = participants.filter((p) => {
        const matchesSearch =
            p.participant_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            p.participant_code.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesType =
            participantTypeFilter === "all" || p.participant_type === participantTypeFilter;
        return matchesSearch && matchesType;
    });

    const formatDurationFromSeconds = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        const remainder = seconds % 60;
        if (minutes < 60) return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        return `${hours}h ${mins}m ${remainder}s`;
    };

    const formatLiveDuration = (baseSeconds: number) => {
        return formatDurationFromSeconds(baseSeconds);
    };

    const safeFileBase = activeEvent?.name?.trim().replace(/[^a-z0-9]+/gi, "_") || "activity_time_analytics";

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
            link.download = `${safeFileBase}_${view}.png`;
            link.click();
        } catch (error) {
            toast({
                title: "PNG export failed",
                description: error instanceof Error ? error.message : "Could not export the current view.",
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
            pdf.save(`${safeFileBase}_${view}.pdf`);
        } catch (error) {
            toast({
                title: "PDF export failed",
                description: error instanceof Error ? error.message : "Could not export the current view.",
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

            if (view === "participants") {
                const summarySheet = XLSX.utils.json_to_sheet(
                    filteredParticipants.map((participant) => ({
                        Participant: participant.participant_name,
                        Code: participant.participant_code,
                        Type: participant.participant_type,
                        "Total Time": formatDurationFromSeconds(participant.total_seconds),
                        "Total Seconds": participant.total_seconds,
                        "Activities Count": participant.activities.length,
                    }))
                );
                XLSX.utils.book_append_sheet(workbook, summarySheet, "Participants");

                const detailRows = filteredParticipants.flatMap((participant) =>
                    participant.activities.map((activity) => ({
                        Participant: participant.participant_name,
                        Code: participant.participant_code,
                        Type: participant.participant_type,
                        Activity: activity.activity_name,
                        Checkins: activity.checkin_count,
                        Duration: formatDurationFromSeconds(activity.total_seconds),
                        "Duration Seconds": activity.total_seconds,
                        Status: activity.is_currently_active ? "In progress" : "Complete",
                    }))
                );
                const detailSheet = XLSX.utils.json_to_sheet(detailRows.length > 0 ? detailRows : [{ Participant: "No data" }]);
                XLSX.utils.book_append_sheet(workbook, detailSheet, "Participant Activities");
            } else {
                const summarySheet = XLSX.utils.json_to_sheet(
                    activities.map((activity) => ({
                        Activity: activity.activity_name,
                        Participants: activity.total_participants,
                        Checkins: activity.total_checkins,
                        "Avg Duration": formatDurationFromSeconds(activity.average_duration_seconds),
                        "Avg Duration Seconds": activity.average_duration_seconds,
                        "Total Time": formatDurationFromSeconds(activity.total_time_seconds),
                        "Total Seconds": activity.total_time_seconds,
                    }))
                );
                XLSX.utils.book_append_sheet(workbook, summarySheet, "Activities");

                const participantRows = filteredParticipants.flatMap((participant) =>
                    participant.activities.map((activity) => ({
                        Participant: participant.participant_name,
                        Code: participant.participant_code,
                        Type: participant.participant_type,
                        Activity: activity.activity_name,
                        Checkins: activity.checkin_count,
                        Duration: formatDurationFromSeconds(activity.total_seconds),
                        "Duration Seconds": activity.total_seconds,
                    }))
                );
                const detailsSheet = XLSX.utils.json_to_sheet(participantRows.length > 0 ? participantRows : [{ Activity: "No data" }]);
                XLSX.utils.book_append_sheet(workbook, detailsSheet, "Activity Details");
            }

            const metaSheet = XLSX.utils.json_to_sheet([
                { Label: "Event", Value: activeEvent?.name || eventId || "N/A" },
                { Label: "View", Value: view },
                { Label: "Generated At", Value: generatedAt },
            ]);
            XLSX.utils.book_append_sheet(workbook, metaSheet, "Summary");
            XLSX.writeFile(workbook, `${safeFileBase}_${view}.xlsx`);
        } catch (error) {
            toast({
                title: "Excel export failed",
                description: error instanceof Error ? error.message : "Could not export the current view.",
                variant: "destructive",
            });
        } finally {
            setExporting(null);
        }
    };

    const handleCloseEvent = async () => {
        if (!eventId || stoppingAll || isEventClosed) return;

        const proceed = window.confirm(
            "Close this event now? This will stop all active timers for this event and mark it as completed."
        );
        if (!proceed) return;

        setStoppingAll(true);
        try {
            const stopTime = new Date();
            const result = await stopAllEventActivityTimers(eventId, stopTime);

            if (!result.success) {
                toast({
                    title: "Failed to stop timers",
                    description: result.message || "Could not stop active timers.",
                    variant: "destructive",
                });
                return;
            }

            const { error: eventUpdateError } = await (supabase as any)
                .from("events")
                .update({ status: "completed" })
                .eq("id", eventId);

            if (eventUpdateError) {
                toast({
                    title: "Event status update failed",
                    description: eventUpdateError.message || "Timers were stopped, but event could not be marked completed.",
                    variant: "destructive",
                });
            } else if (activeEvent) {
                setActiveEvent({ ...activeEvent, status: "completed" });
            }

            toast({
                title: "Event closed",
                description: result.stoppedCount > 0
                    ? `${result.stoppedCount} active timer${result.stoppedCount === 1 ? "" : "s"} stopped and this event is now completed.`
                    : "This event is now completed. No active timers were open.",
            });

            await fetchData();
            setNowTick(Date.now());
        } catch (error) {
            toast({
                title: "Failed to close event",
                description: error instanceof Error ? error.message : "Could not close this event.",
                variant: "destructive",
            });
        } finally {
            setStoppingAll(false);
        }
    };

    return (
        <AppLayout title="Activity Time Analytics" subtitle="Monitor participant engagement and time spent across activities">
            <div className="space-y-6 p-6">
                {/* Header */}
                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-xl bg-primary/10">
                            <Timer className="h-6 w-6 text-primary" />
                        </div>
                        <div>
                            <h1 className="text-3xl font-black text-foreground">Activity Time Analytics</h1>
                            <p className="text-sm text-muted-foreground">
                                Monitor participant engagement and time spent across activities
                            </p>
                            {isEventClosed && (
                                <p className="mt-1 inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-600">
                                    Event Closed
                                </p>
                            )}
                        </div>
                    </div>

                    {/* View Toggle */}
                    <div className="flex gap-2">
                        <Button
                            variant={view === "participants" ? "default" : "outline"}
                            onClick={() => setView("participants")}
                            className="gap-2"
                        >
                            <Users className="h-4 w-4" />
                            Per-Participant Breakdown
                        </Button>
                        <Button
                            variant={view === "activities" ? "default" : "outline"}
                            onClick={() => setView("activities")}
                            className="gap-2"
                        >
                            <BarChart3 className="h-4 w-4" />
                            Activity Engagement
                        </Button>
                        <Button variant="outline" className="gap-2 ml-auto" onClick={fetchData}>
                            <Download className="h-4 w-4" />
                            Refresh
                        </Button>
                        <Button
                            variant="destructive"
                            className="gap-2"
                            onClick={handleCloseEvent}
                            disabled={stoppingAll || loading || !eventId || isEventClosed}
                        >
                            <Clock className="h-4 w-4" />
                            {isEventClosed ? "Event Closed" : (stoppingAll ? "Closing Event..." : "Close Event")}
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleExportPng} disabled={exporting !== null}>
                            <ImageIcon className="h-4 w-4" />
                            PNG
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleExportPdf} disabled={exporting !== null}>
                            <FileText className="h-4 w-4" />
                            PDF
                        </Button>
                        <Button variant="outline" className="gap-2" onClick={handleExportExcel} disabled={exporting !== null}>
                            <Table2 className="h-4 w-4" />
                            Excel
                        </Button>
                    </div>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-12">
                        <div className="text-center space-y-2">
                            <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto" />
                            <p className="text-muted-foreground">Loading analytics...</p>
                        </div>
                    </div>
                ) : !eventId ? (
                    <div className="text-center py-12 text-muted-foreground">
                        Select an active event to view time analytics.
                    </div>
                ) : view === "participants" ? (
                    <div ref={captureRef}>
                        <ParticipantBreakdownView
                            participants={filteredParticipants}
                            types={participantTypes}
                            searchQuery={searchQuery}
                            participantTypeFilter={participantTypeFilter}
                            onSearchChange={setSearchQuery}
                            onTypeFilterChange={setParticipantTypeFilter}
                            formatDurationFromSeconds={formatDurationFromSeconds}
                            formatLiveDuration={formatLiveDuration}
                        />
                    </div>
                ) : (
                    <div ref={captureRef}>
                        <ActivityEngagementView
                            activities={activities}
                            formatDurationFromSeconds={formatDurationFromSeconds}
                        />
                    </div>
                )}
            </div>
        </AppLayout>
    );
}

interface ParticipantBreakdownViewProps {
    participants: ParticipantData[];
    types: string[];
    searchQuery: string;
    participantTypeFilter: string;
    onSearchChange: (query: string) => void;
    onTypeFilterChange: (type: string) => void;
    formatDurationFromSeconds: (seconds: number) => string;
    formatLiveDuration: (baseSeconds: number) => string;
}

function ParticipantBreakdownView({
    participants,
    types,
    searchQuery,
    participantTypeFilter,
    onSearchChange,
    onTypeFilterChange,
    formatDurationFromSeconds,
    formatLiveDuration,
}: ParticipantBreakdownViewProps) {
    return (
        <div className="space-y-4">
            {/* Filters */}
            <div className="flex gap-3 items-center flex-wrap bg-secondary/50 p-4 rounded-xl border border-secondary">
                <Search className="h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search by name or code..."
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="flex-1 min-w-64"
                />
                <Select value={participantTypeFilter} onValueChange={onTypeFilterChange}>
                    <SelectTrigger className="w-48">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        {types.map((type) => (
                            <SelectItem key={type} value={type}>
                                {type}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Participants List */}
            <div className="space-y-3">
                {participants.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                        No participants found matching your filters
                    </div>
                ) : (
                    participants.map((participant) => (
                        <div
                            key={participant.participant_id}
                            className="border border-secondary rounded-xl p-4 hover:border-primary/30 transition-colors"
                        >
                            {/* Participant Header */}
                            <div className="flex items-center justify-between mb-3 pb-3 border-b border-secondary">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-primary/10">
                                        <Users className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-foreground">{participant.participant_name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            Code: {participant.participant_code} • Type: {participant.participant_type}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-primary">
                                        {formatDurationFromSeconds(participant.total_seconds)}
                                    </p>
                                    <p className="text-xs text-muted-foreground">Total Time</p>
                                </div>
                            </div>

                            {/* Activities */}
                            {participant.activities.length > 0 ? (
                                <div className="space-y-2">
                                    {participant.activities.map((activity, idx) => (
                                        <div
                                            key={idx}
                                            className="flex items-center justify-between p-2 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                                        >
                                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                                <Activity className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                                <span className="truncate text-sm">{activity.activity_name}</span>
                                            </div>
                                            <div className="flex items-center gap-4 ml-4">
                                                <div className="text-right">
                                                    <p className="text-xs font-semibold text-foreground">
                                                        {activity.is_currently_active && activity.last_checkin
                                                            ? formatLiveDuration(activity.total_seconds)
                                                            : formatDurationFromSeconds(activity.total_seconds)}
                                                    </p>
                                                    <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                                                        <span>{activity.checkin_count}x</span>
                                                        {activity.is_currently_active && (
                                                            <span className="rounded-full bg-success/15 px-2 py-0.5 font-semibold text-success">
                                                                In progress
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-sm text-muted-foreground italic">No activities recorded</p>
                            )}
                        </div>
                    ))
                )}
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-secondary">
                <StatCard
                    icon={Users}
                    label="Total Participants"
                    value={participants.length}
                    color="primary"
                />
                <StatCard
                    icon={Clock}
                    label="Avg Time/Person"
                    value={
                        participants.length > 0
                            ? formatDurationFromSeconds(
                                Math.round(
                                    participants.reduce((sum, p) => sum + p.total_seconds, 0) / participants.length
                                )
                            )
                            : "0s"
                    }
                    color="blue"
                />
                <StatCard
                    icon={Zap}
                    label="Max Time/Person"
                    value={
                        participants.length > 0
                            ? formatDurationFromSeconds(Math.max(...participants.map((p) => p.total_seconds)))
                            : "0s"
                    }
                    color="amber"
                />
                <StatCard
                    icon={TrendingUp}
                    label="Total Hours"
                    value={Math.round(
                        (participants.reduce((sum, p) => sum + p.total_seconds, 0) / 3600) * 100
                    ) / 100}
                    color="green"
                />
            </div>
        </div>
    );
}

interface ActivityEngagementViewProps {
    activities: ActivityEngagementData[];
    formatDurationFromSeconds: (seconds: number) => string;
}

function ActivityEngagementView({
    activities,
    formatDurationFromSeconds,
}: ActivityEngagementViewProps) {
    return (
        <div className="space-y-4">
            {activities.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                    No activity engagement data available
                </div>
            ) : (
                <div className="space-y-3">
                    {activities.map((activity) => (
                        <div
                            key={activity.activity_id}
                            className="border border-secondary rounded-xl p-4 hover:border-primary/30 transition-colors"
                        >
                            {/* Activity Header */}
                            <div className="flex items-center justify-between mb-3 pb-3 border-b border-secondary">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-lg bg-primary/10">
                                        <Activity className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <p className="font-semibold text-foreground">{activity.activity_name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {activity.total_participants} participants • {activity.total_checkins} checkins
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="text-lg font-bold text-primary">{formatDurationFromSeconds(activity.total_time_seconds)}</p>
                                    <p className="text-xs text-muted-foreground">Total Time</p>
                                </div>
                            </div>

                            {/* Stats Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="p-3 rounded-lg bg-secondary/50">
                                    <p className="text-xs text-muted-foreground mb-1">Participants</p>
                                    <p className="text-xl font-bold text-foreground">
                                        {activity.total_participants}
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-secondary/50">
                                    <p className="text-xs text-muted-foreground mb-1">Total Checkins</p>
                                    <p className="text-xl font-bold text-foreground">{activity.total_checkins}</p>
                                </div>
                                <div className="p-3 rounded-lg bg-secondary/50">
                                    <p className="text-xs text-muted-foreground mb-1">Avg Duration</p>
                                    <p className="text-xl font-bold text-foreground">
                                        {formatDurationFromSeconds(activity.average_duration_seconds)}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        Based on {activity.total_checkins} checkins
                                    </p>
                                </div>
                                <div className="p-3 rounded-lg bg-secondary/50">
                                    <p className="text-xs text-muted-foreground mb-1">Engagement</p>
                                    <p className="text-xl font-bold text-primary">
                                        {activity.total_participants > 0
                                            ? Math.round(
                                                (activity.total_checkins / activity.total_participants) * 100
                                            )
                                            : 0}
                                        %
                                    </p>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-4 border-t border-secondary">
                <StatCard
                    icon={Activity}
                    label="Total Activities"
                    value={activities.length}
                    color="primary"
                />
                <StatCard
                    icon={Users}
                    label="Total Unique Participants"
                    value={new Set(
                        activities.flatMap((a) => Array(a.total_participants).fill(1))
                    ).size}
                    color="blue"
                />
                <StatCard
                    icon={TrendingUp}
                    label="Most Engaging"
                    value={
                        activities.length > 0
                            ? activities.reduce((max, a) =>
                                a.total_time_hours > max.total_time_hours ? a : max
                            ).activity_name
                            : "N/A"
                    }
                    color="amber"
                />
                <StatCard
                    icon={Clock}
                    label="Total Hours"
                    value={Math.round((activities.reduce((sum, a) => sum + a.total_time_seconds, 0) / 3600) * 100) / 100}
                    color="green"
                />
            </div>
        </div>
    );
}

interface StatCardProps {
    icon: LucideIcon;
    label: string;
    value: string | number;
    color: "primary" | "blue" | "amber" | "green";
}

function StatCard({ icon: Icon, label, value, color }: StatCardProps) {
    const colorClass = {
        primary: "text-primary bg-primary/10",
        blue: "text-blue-500 bg-blue-500/10",
        amber: "text-amber-500 bg-amber-500/10",
        green: "text-green-500 bg-green-500/10",
    }[color];

    return (
        <div className="p-4 rounded-xl border border-secondary hover:border-primary/30 transition-colors">
            <div className="flex items-center gap-2 mb-2">
                <div className={cn("p-2 rounded-lg", colorClass)}>
                    <Icon className="h-4 w-4" />
                </div>
                <p className="text-xs text-muted-foreground font-medium">{label}</p>
            </div>
            <p className="text-2xl font-bold text-foreground">{value}</p>
        </div>
    );
}
