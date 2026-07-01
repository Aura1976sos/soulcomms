import { useRef, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList,
} from "recharts";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Download, ImageIcon, FileText, Table2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Activity } from "@/contexts/ActivitiesContext";
import { resolveIcon } from "@/lib/experiences";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
interface Props {
  activities: Activity[];
  counts: Record<string, number>;     // activityId → effectiveCount
  totalExperiences: number;
  eventName: string;
  canDownload: boolean;               // true for admin / event_admin
}

interface ChartRow {
  name: string;
  count: number;
  color: string;
  id: string;
  shortName: string;
}

// ─── CSV download ─────────────────────────────────────────────────────────────
function downloadCsv(rows: ChartRow[], eventName: string, total: number) {
  const headers = ["Activity", "Count", "Percentage (%)"];
  const lines = rows.map(r => [
    `"${r.name}"`,
    r.count,
    total > 0 ? ((r.count / total) * 100).toFixed(1) : "0.0",
  ].join(","));
  const csv = [
    `"Event","${eventName}"`,
    `"Total Experiences","${total}"`,
    `"Generated","${new Date().toLocaleString()}"`,
    "",
    headers.join(","),
    ...lines,
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${eventName.replace(/\s+/g, "_")}_Activities_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function ActivityBarChart({ activities, counts, totalExperiences, eventName, canDownload }: Props) {
  const captureRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState<"png" | "pdf" | null>(null);

  // Build chart data sorted descending
  const rows: ChartRow[] = activities
    .map(a => ({
      id: a.id,
      name: a.name,
      shortName: a.name.length > 14 ? a.name.slice(0, 13) + "…" : a.name,
      count: counts[a.id] ?? 0,
      color: a.color ?? "hsl(var(--primary))",
    }))
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count);

  if (rows.length === 0) return null;

  const maxCount = Math.max(...rows.map(r => r.count));

  // ── Export helpers ────────────────────────────────────────────────────────
  const captureChart = async (): Promise<HTMLCanvasElement> => {
    if (!captureRef.current) throw new Error("Chart not mounted");
    return html2canvas(captureRef.current, {
      backgroundColor: "#0f0f11",   // match dark background
      scale: 2,
      useCORS: true,
      logging: false,
    });
  };

  const handleDownloadPng = async () => {
    setExporting("png");
    try {
      const canvas = await captureChart();
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `${eventName.replace(/\s+/g, "_")}_Chart.png`;
      a.click();
    } finally { setExporting(null); }
  };

  const handleDownloadPdf = async () => {
    setExporting("pdf");
    try {
      const canvas = await captureChart();
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "landscape", unit: "px", format: [canvas.width / 2, canvas.height / 2] });
      pdf.addImage(imgData, "PNG", 0, 0, canvas.width / 2, canvas.height / 2);
      pdf.save(`${eventName.replace(/\s+/g, "_")}_Chart.pdf`);
    } finally { setExporting(null); }
  };

  const handleDownloadCsv = () => downloadCsv(rows, eventName, totalExperiences);

  // ── Custom bar label ──────────────────────────────────────────────────────
  const renderCustomLabel = (props: { x?: number; y?: number; width?: number; value?: number }) => {
    const { x = 0, y = 0, width = 0, value = 0 } = props;
    if (value === 0) return null;
    return (
      <text x={x + width + 6} y={y + 10} fill="hsl(var(--foreground))" fontSize={11} fontWeight="bold" dominantBaseline="middle">
        {value.toLocaleString()}
      </text>
    );
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Capture region */}
      <div ref={captureRef} className="p-6 bg-background">
        {/* Header inside capture */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[3px] text-muted-foreground">
              Activity Participation
            </p>
            <p className="text-base font-black text-foreground mt-0.5">{eventName}</p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-black text-primary">{totalExperiences.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground">Total Experiences</p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          </div>
        </div>

        {/* Bar chart */}
        <ResponsiveContainer width="100%" height={Math.max(180, rows.length * 44)}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 0, right: 80, left: 8, bottom: 0 }}
            barCategoryGap="25%"
          >
            <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
            <XAxis
              type="number"
              domain={[0, maxCount * 1.1]}
              tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
            />
            <YAxis
              type="category"
              dataKey="shortName"
              width={100}
              tick={{ fill: "hsl(var(--foreground))", fontSize: 11, fontWeight: 600 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
              contentStyle={{
                backgroundColor: "hsl(var(--card))",
                border: "1px solid hsl(var(--border))",
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, _: string, props: { payload?: ChartRow }) => [
                value.toLocaleString(),
                props.payload?.name ?? "Count",
              ]}
            />
            <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={28}>
              {rows.map(row => (
                <Cell key={row.id} fill={row.color} opacity={0.9} />
              ))}
              <LabelList dataKey="count" content={renderCustomLabel} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Branding footer inside capture */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground/60 font-semibold tracking-wider">
            SOULCOMMS · THE GATHERING 100
          </p>
          <p className="text-[10px] text-muted-foreground/40">
            Generated by TG100 Platform
          </p>
        </div>
      </div>

      {/* Download bar — outside capture region */}
      {canDownload && (
        <div className="flex items-center gap-2 px-6 py-3 border-t border-border bg-secondary/30">
          <Download className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-muted-foreground mr-2">Download Chart:</span>

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPng}
            disabled={!!exporting}
            className="h-7 gap-1.5 text-xs border-border hover:border-primary/40"
          >
            {exporting === "png"
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <ImageIcon className="h-3 w-3" />}
            PNG
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadPdf}
            disabled={!!exporting}
            className="h-7 gap-1.5 text-xs border-border hover:border-primary/40"
          >
            {exporting === "pdf"
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <FileText className="h-3 w-3" />}
            PDF
          </Button>

          <Button
            size="sm"
            variant="outline"
            onClick={handleDownloadCsv}
            disabled={!!exporting}
            className="h-7 gap-1.5 text-xs border-border hover:border-primary/40"
          >
            <Table2 className="h-3 w-3" />
            CSV
          </Button>

          {/* Legend */}
          <div className="ml-auto flex flex-wrap gap-3">
            {rows.slice(0, 6).map(r => {
              const Icon = resolveIcon(activities.find(a => a.id === r.id)?.icon_name);
              return (
                <div key={r.id} className="flex items-center gap-1">
                  <Icon className="h-3 w-3 shrink-0" style={{ color: r.color }} />
                  <span className="text-[10px] text-muted-foreground truncate max-w-16">{r.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Small inline count badge for ExperienceGrid ──────────────────────────────
export function ManualCountBadge({ className }: { className?: string }) {
  return (
    <span className={cn("text-[9px] font-bold uppercase tracking-wider bg-amber-500/20 text-amber-500 border border-amber-500/30 px-1.5 py-0.5 rounded-full", className)}>
      override
    </span>
  );
}
