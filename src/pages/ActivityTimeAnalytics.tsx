import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Clock, Users, TrendingUp, Activity, Search, Filter, Download,
  BarChart3, Award, Zap, Timer,
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
    checkin_count: number;
  }>;
  total_minutes: number;
}

interface ActivityEngagementData {
  activity_id: string;
  activity_name: string;
  total_participants: number;
  total_checkins: number;
  average_duration_minutes: number;
  total_time_minutes: number;
  total_time_hours: number;
}

export default function ActivityTimeAnalytics() {
  const { user } = useAuth();
  const { eventId } = useEvent();
  const { toast } = useToast();

  const [view, setView] = useState<"participants" | "activities">("participants");
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [participantTypeFilter, setParticipantTypeFilter] = useState<string>("all");
  const [participantTypes, setParticipantTypes] = useState<string[]>([]);

  const [participants, setParticipants] = useState<ParticipantData[]>([]);
  const [activities, setActivities] = useState<ActivityEngagementData[]>([]);

  useEffect(() => {
    if (!eventId || !user) return;
    fetchData();
  }, [eventId, user]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch participant time data
      const { data: participantData, error: participantError } = await supabase
        .from("participants")
        .select(`
          id,
          name,
          participant_code,
          participant_type,
          activity_participation_time (
            activity_id,
            checkin_time,
            checkout_time
          ),
          activities (
            id,
            name
          )
        `)
        .eq("event_id", eventId);

      if (participantError) throw participantError;

      // Fetch activity engagement data
      const { data: activityParticipationData, error: activityError } = await supabase
        .from("activity_participation_time")
        .select(`
          activity_id,
          checkin_time,
          checkout_time,
          activities (
            id,
            name
          )
        `)
        .eq("event_id", eventId);

      if (activityError) throw activityError;

      // Process participant data
      const types = new Set<string>();
      const processedParticipants: ParticipantData[] = [];

      if (participantData) {
        for (const participant of participantData) {
          if (participant.participant_type) {
            types.add(participant.participant_type);
          }

          const activityMap = new Map<string, { name: string; minutes: number; count: number }>();

          // Group participations by activity
          if (participant.activity_participation_time) {
            for (const participation of participant.activity_participation_time) {
              // Find activity name from activities context
              const activity = participant.activities?.find(
                (a: any) => a.id === participation.activity_id
              );
              const activityName = activity?.name || `Activity ${participation.activity_id}`;

              if (!activityMap.has(participation.activity_id)) {
                activityMap.set(participation.activity_id, {
                  name: activityName,
                  minutes: 0,
                  count: 0,
                });
              }

              const data = activityMap.get(participation.activity_id)!;
              data.count += 1;

              // Calculate duration
              if (participation.checkout_time && participation.checkin_time) {
                const checkoutTime = new Date(participation.checkout_time).getTime();
                const checkinTime = new Date(participation.checkin_time).getTime();
                const minutes = Math.round((checkoutTime - checkinTime) / 60000);
                data.minutes += minutes;
              }
            }
          }

          const activitiesList = Array.from(activityMap.entries()).map(([_, data]) => ({
            activity_name: data.name,
            total_minutes: data.minutes,
            checkin_count: data.count,
          }));

          const totalMinutes = activitiesList.reduce((sum, a) => sum + a.total_minutes, 0);

          processedParticipants.push({
            participant_id: participant.id,
            participant_name: participant.name,
            participant_code: participant.participant_code || "N/A",
            participant_type: participant.participant_type || "General",
            activities: activitiesList.sort((a, b) => b.total_minutes - a.total_minutes),
            total_minutes: totalMinutes,
          });
        }
      }

      setParticipantTypes(Array.from(types).sort());
      setParticipants(processedParticipants.sort((a, b) => b.total_minutes - a.total_minutes));

      // Process activity engagement data
      const activityMap = new Map<string, {
        name: string;
        participants: Set<string>;
        checkins: number;
        totalMinutes: number;
      }>();

      if (activityParticipationData) {
        for (const record of activityParticipationData) {
          const activityName = record.activities?.[0]?.name || `Activity ${record.activity_id}`;
          const activityId = record.activity_id;

          if (!activityMap.has(activityId)) {
            activityMap.set(activityId, {
              name: activityName,
              participants: new Set(),
              checkins: 0,
              totalMinutes: 0,
            });
          }

          const data = activityMap.get(activityId)!;
          data.checkins += 1;

          // Calculate duration
          if (record.checkout_time && record.checkin_time) {
            const checkoutTime = new Date(record.checkout_time).getTime();
            const checkinTime = new Date(record.checkin_time).getTime();
            const minutes = Math.round((checkoutTime - checkinTime) / 60000);
            data.totalMinutes += minutes;
          }
        }
      }

      const engagementList: ActivityEngagementData[] = Array.from(activityMap.entries()).map(
        ([_, data]) => {
          const avgDuration = data.checkins > 0 ? Math.round(data.totalMinutes / data.checkins) : 0;
          return {
            activity_id: _,
            activity_name: data.name,
            total_participants: data.participants.size,
            total_checkins: data.checkins,
            average_duration_minutes: avgDuration,
            total_time_minutes: data.totalMinutes,
            total_time_hours: Math.round((data.totalMinutes / 60) * 100) / 100,
          };
        }
      );

      setActivities(engagementList.sort((a, b) => b.total_time_minutes - a.total_time_minutes));
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

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  return (
    <AppLayout>
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
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center space-y-2">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent mx-auto" />
              <p className="text-muted-foreground">Loading analytics...</p>
            </div>
          </div>
        ) : view === "participants" ? (
          <ParticipantBreakdownView
            participants={filteredParticipants}
            types={participantTypes}
            searchQuery={searchQuery}
            participantTypeFilter={participantTypeFilter}
            onSearchChange={setSearchQuery}
            onTypeFilterChange={setParticipantTypeFilter}
            formatDuration={formatDuration}
          />
        ) : (
          <ActivityEngagementView
            activities={activities}
            formatDuration={formatDuration}
          />
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
  formatDuration: (minutes: number) => string;
}

function ParticipantBreakdownView({
  participants,
  types,
  searchQuery,
  participantTypeFilter,
  onSearchChange,
  onTypeFilterChange,
  formatDuration,
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
                    {formatDuration(participant.total_minutes)}
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
                            {formatDuration(activity.total_minutes)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {activity.checkin_count}x
                          </p>
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
              ? formatDuration(
                  Math.round(
                    participants.reduce((sum, p) => sum + p.total_minutes, 0) / participants.length
                  )
                )
              : "0m"
          }
          color="blue"
        />
        <StatCard
          icon={Zap}
          label="Max Time/Person"
          value={
            participants.length > 0
              ? formatDuration(Math.max(...participants.map((p) => p.total_minutes)))
              : "0m"
          }
          color="amber"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Hours"
          value={Math.round(
            (participants.reduce((sum, p) => sum + p.total_minutes, 0) / 60) * 100
          ) / 100}
          color="green"
        />
      </div>
    </div>
  );
}

interface ActivityEngagementViewProps {
  activities: ActivityEngagementData[];
  formatDuration: (minutes: number) => string;
}

function ActivityEngagementView({
  activities,
  formatDuration,
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
                  <p className="text-lg font-bold text-primary">{activity.total_time_hours}h</p>
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
                    {formatDuration(activity.average_duration_minutes)}
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
          value={Math.round(activities.reduce((sum, a) => sum + a.total_time_hours, 0) * 100) / 100}
          color="green"
        />
      </div>
    </div>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
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
          {typeof Icon === "function" ? <Icon className="h-4 w-4" /> : Icon}
        </div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
      </div>
      <p className="text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}
