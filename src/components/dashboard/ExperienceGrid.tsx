import { Activity } from "@/contexts/ActivitiesContext";
import { resolveIcon } from "@/lib/experiences";

interface ExperienceGridProps {
  activities: Activity[];
  counts: Record<string, number>;
  totalCheckedIn: number;
}

export const ExperienceGrid = ({ activities, counts, totalCheckedIn }: ExperienceGridProps) => {
  if (activities.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {activities.map((activity, i) => {
        // Count matches on both id (UUID) and code (legacy string)
        const count = (counts[activity.id] ?? 0) + (counts[activity.code] ?? 0);
        const pct = totalCheckedIn > 0 ? Math.min((count / totalCheckedIn) * 100, 100) : 0;
        const Icon = resolveIcon(activity.icon_name);
        const color = activity.color ?? "hsl(var(--primary))";

        return (
          <div
            key={activity.id}
            className="glass-card rounded-xl p-4 fade-in-up"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1.5 rounded-lg" style={{ backgroundColor: `${color}20` }}>
                <Icon className="h-3.5 w-3.5" style={{ color }} />
              </div>
              <span className="text-xs font-semibold text-foreground leading-tight">{activity.name}</span>
            </div>
            <div className="flex items-end justify-between mb-2">
              <span className="text-2xl font-black text-foreground">{count.toLocaleString()}</span>
              <span className="text-xs text-muted-foreground">{pct.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{ width: `${pct}%`, backgroundColor: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};
