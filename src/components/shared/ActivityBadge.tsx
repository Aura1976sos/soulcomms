import { cn } from "@/lib/utils";
import { useActivities } from "@/contexts/ActivitiesContext";
import { getExperience, resolveIcon } from "@/lib/experiences";

interface ActivityBadgeProps {
  experienceId: string;   // can be activity UUID, activity code, or legacy hardcoded id
  size?: "sm" | "md";
  className?: string;
}

export const ActivityBadge = ({ experienceId, size = "md", className }: ActivityBadgeProps) => {
  // 1. Try DB-driven activities first
  const { getActivity } = useActivities();
  const dbActivity = getActivity(experienceId);

  if (dbActivity) {
    const Icon = resolveIcon(dbActivity.icon_name);
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-semibold",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs",
          className
        )}
        style={{
          backgroundColor: `${dbActivity.color}18`,
          borderColor: `${dbActivity.color}40`,
          color: dbActivity.color ?? undefined,
        }}
      >
        <Icon className={cn("shrink-0", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
        {dbActivity.name}
      </span>
    );
  }

  // 2. Fallback to legacy hardcoded EXPERIENCES (for old activity_logs)
  const legacy = getExperience(experienceId);
  if (legacy) {
    const Icon = legacy.icon;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border font-semibold",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs",
          className
        )}
        style={{
          backgroundColor: `${legacy.color}18`,
          borderColor: `${legacy.color}40`,
          color: legacy.color,
        }}
      >
        <Icon className={cn("shrink-0", size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3")} />
        {legacy.name}
      </span>
    );
  }

  // 3. Unknown — show raw id as fallback
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full border font-semibold text-muted-foreground border-border bg-secondary",
      size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs",
      className
    )}>
      {experienceId}
    </span>
  );
};
