import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  suffix?: string;
  trend?: string;
  delay?: number;
  highlight?: boolean;
  decimals?: number;
}

export const StatCard = ({ title, value, icon: Icon, suffix, trend, delay = 0, highlight, decimals = 0 }: StatCardProps) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    if (value === 0) return;
    const duration = 800;
    const startTime = Date.now() + delay;
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed < 0) return;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(parseFloat((eased * value).toFixed(decimals)));
      if (progress >= 1) clearInterval(timer);
    }, 16);
    return () => clearInterval(timer);
  }, [value, delay, decimals]);

  return (
    <div
      className={cn(
        "glass-card rounded-xl p-6 fade-in-up relative overflow-hidden",
        highlight && "border-primary/30"
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      {highlight && (
        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
      )}
      <div className="flex items-start justify-between mb-4">
        <div className={cn(
          "p-2.5 rounded-lg",
          highlight ? "bg-primary/20" : "bg-secondary"
        )}>
          <Icon className={cn("h-5 w-5", highlight ? "text-primary" : "text-muted-foreground")} />
        </div>
        {trend && (
          <span className="text-xs font-medium text-success bg-success/10 px-2 py-0.5 rounded-full">
            {trend}
          </span>
        )}
      </div>
      <div className="count-animate">
        <p className="text-3xl font-black tracking-tight text-foreground">
          {decimals > 0 ? displayValue.toFixed(decimals) : displayValue.toLocaleString()}
          {suffix && <span className="text-lg font-semibold text-muted-foreground ml-1">{suffix}</span>}
        </p>
        <p className="text-xs font-semibold uppercase tracking-[2px] text-muted-foreground mt-1">
          {title}
        </p>
      </div>
    </div>
  );
};
