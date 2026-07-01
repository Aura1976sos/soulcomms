import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { useActivities, Activity } from "@/contexts/ActivitiesContext";
import { ICON_MAP, ICON_NAMES, PRESET_COLORS, resolveIcon } from "@/lib/experiences";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Pencil, Trash2, ChevronDown, ChevronRight, Copy, ToggleLeft, ToggleRight,
  Archive, ListChecks, X, Check, AlertTriangle, Hash, RotateCcw, CalendarDays,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SessionManager } from "@/components/activity/SessionPickerModal";

// ─── Edit Count Modal ─────────────────────────────────────────────────────────
interface EditCountModalProps {
  activity: Activity & { manual_count?: number | null };
  actualCount: number;
  onClose: () => void;
  onSaved: () => void;
}

function EditCountModal({ activity, actualCount, onClose, onSaved }: EditCountModalProps) {
  const [value, setValue] = useState<string>(
    activity.manual_count != null ? String(activity.manual_count) : ""
  );
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = async () => {
    const num = value.trim() === "" ? null : parseInt(value);
    if (value.trim() !== "" && (isNaN(num!) || num! < 0)) {
      toast({ title: "Enter a valid non-negative number", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("activities")
      .update({ manual_count: num } as Record<string, unknown>)
      .eq("id", activity.id);
    setSaving(false);
    if (error) { toast({ title: error.message, variant: "destructive" }); return; }
    toast({ title: num != null ? `Count set to ${num.toLocaleString()}` : "Override cleared" });
    onSaved();
    onClose();
  };

  const clearOverride = async () => {
    setSaving(true);
    await supabase.from("activities").update({ manual_count: null } as Record<string, unknown>).eq("id", activity.id);
    setSaving(false);
    toast({ title: "Manual override cleared — using actual count" });
    onSaved();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-card border border-primary/20 rounded-2xl p-6 space-y-4 slide-up">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <Hash className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Edit Count</p>
              <p className="text-xs text-muted-foreground truncate max-w-40">{activity.name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:bg-secondary">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Current info */}
        <div className="grid grid-cols-2 gap-2 text-center">
          <div className="bg-secondary rounded-xl py-3">
            <p className="text-xl font-black text-foreground">{actualCount.toLocaleString()}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Actual Logs</p>
          </div>
          <div className={cn(
            "rounded-xl py-3",
            activity.manual_count != null ? "bg-amber-500/10 border border-amber-500/20" : "bg-secondary"
          )}>
            <p className={cn("text-xl font-black", activity.manual_count != null ? "text-amber-500" : "text-muted-foreground")}>
              {activity.manual_count != null ? activity.manual_count.toLocaleString() : "—"}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Manual Override</p>
          </div>
        </div>

        <div>
          <label className="field-label">New Count</label>
          <Input
            type="number"
            min={0}
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={`Actual: ${actualCount.toLocaleString()}`}
            className="bg-secondary border-border focus:border-primary text-lg font-bold"
            autoFocus
          />
          <p className="text-[10px] text-muted-foreground mt-1.5">
            Leave empty to clear override and use actual count.
          </p>
        </div>

        <div className="flex gap-2">
          {activity.manual_count != null && (
            <Button variant="outline" onClick={clearOverride} disabled={saving} className="gap-1.5 border-amber-500/40 text-amber-500 hover:bg-amber-500/10 text-xs">
              <RotateCcw className="h-3 w-3" />Clear
            </Button>
          )}
          <Button variant="outline" onClick={onClose} className="flex-1 border-border">Cancel</Button>
          <Button onClick={handleSave} disabled={saving} className="flex-1 bg-primary text-primary-foreground">
            {saving ? "Saving…" : <><Check className="h-3.5 w-3.5 mr-1" />Save</>}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Form state ───────────────────────────────────────────────────────────────
interface FormState {
  name: string; code: string; description: string; category: string;
  points_value: number; status: "active" | "inactive" | "archived";
  icon_name: string; color: string; parent_id: string;
}

const DEFAULT_FORM: FormState = {
  name: "", code: "", description: "", category: "",
  points_value: 10, status: "active",
  icon_name: "Zap", color: "hsl(0 85% 52%)", parent_id: "",
};

// ─── Row component ────────────────────────────────────────────────────────────
function ActivityRow({
  activity,
  depth = 0,
  subs,
  onEdit,
  onDelete,
  onToggle,
  onArchive,
  onEditCount,
  onManageSessions,
  actualCount,
}: {
  activity: Activity & { manual_count?: number | null };
  depth?: number;
  subs: Activity[];
  onEdit: (a: Activity) => void;
  onDelete: (a: Activity) => void;
  onToggle: (a: Activity) => void;
  onArchive: (a: Activity) => void;
  onEditCount?: (a: Activity & { manual_count?: number | null }) => void;
  onManageSessions?: (a: Activity) => void;
  actualCount?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = resolveIcon(activity.icon_name);
  const statusColors = {
    active: "text-success bg-success/10 border-success/30",
    inactive: "text-muted-foreground bg-secondary border-border",
    archived: "text-destructive bg-destructive/10 border-destructive/30",
  };

  return (
    <>
      <div className={cn(
        "glass-card rounded-xl px-4 py-3 flex items-center gap-3 fade-in-up",
        depth > 0 && "ml-6 border-l-2 rounded-l-none",
      )} style={depth > 0 ? { borderLeftColor: activity.color ?? "hsl(var(--primary))" } : {}}>
        {/* Expand toggle if has subs */}
        <button
          onClick={() => setExpanded(v => !v)}
          className={cn("text-muted-foreground transition-transform", subs.length > 0 ? "opacity-100" : "opacity-0 pointer-events-none")}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>

        {/* Icon */}
        <div className="p-2 rounded-lg shrink-0" style={{ backgroundColor: `${activity.color}25` }}>
          <Icon className="h-4 w-4" style={{ color: activity.color ?? "hsl(var(--primary))" }} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-foreground truncate">{activity.name}</p>
            <span className="text-[10px] font-mono font-bold text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
              {activity.code}
            </span>
            {activity.category && (
              <span className="text-[10px] font-semibold text-muted-foreground">{activity.category}</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border", statusColors[activity.status])}>
              {activity.status}
            </span>
            <span className="text-[10px] text-muted-foreground">{activity.points_value} pts</span>
            {subs.length > 0 && (
              <span className="text-[10px] text-muted-foreground">{subs.length} sub-activit{subs.length > 1 ? "ies" : "y"}</span>
            )}
            {activity.manual_count != null && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-500">
                override: {activity.manual_count.toLocaleString()}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {onManageSessions && (
            <button onClick={() => onManageSessions(activity)}
              title="Manage sessions"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
              <CalendarDays className="h-3.5 w-3.5" />
            </button>
          )}
          {onEditCount && (
            <button onClick={() => onEditCount(activity)}
              title="Edit count override"
              className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 transition-colors">
              <Hash className="h-3.5 w-3.5" />
            </button>
          )}
          <button onClick={() => onEdit(activity)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onToggle(activity)}
            title={activity.status === "active" ? "Deactivate" : "Activate"}
            className={cn("p-1.5 rounded-lg transition-colors", activity.status === "active" ? "text-success hover:text-muted-foreground hover:bg-secondary" : "text-muted-foreground hover:text-success hover:bg-secondary")}>
            {activity.status === "active" ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
          </button>
          <button onClick={() => onArchive(activity)} title="Archive"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-secondary transition-colors">
            <Archive className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(activity)} title="Delete"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Sub-activities */}
      {expanded && subs.map(sub => (
        <ActivityRow
          key={sub.id} activity={sub} depth={depth + 1} subs={[]}
          onEdit={onEdit} onDelete={onDelete} onToggle={onToggle} onArchive={onArchive}
          onEditCount={onEditCount} onManageSessions={onManageSessions}
        />
      ))}
    </>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────────────
export default function Activities() {
  const { activeEvent, events } = useEvent();
  const { activities, topLevel, subActivities, refresh, loading } = useActivities();
  const { user, role } = useAuth();
  const isAdmin = role === "admin" || role === "event_admin";
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState<Activity | null>(null);
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Activity | null>(null);
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [copying, setCopying] = useState(false);
  const [editCountTarget, setEditCountTarget] = useState<(Activity & { manual_count?: number | null }) | null>(null);
  const [actualCounts, setActualCounts] = useState<Record<string, number>>({});
  const [sessionTarget, setSessionTarget] = useState<Activity | null>(null);

  // Open form for create / edit
  const openCreate = () => {
    setEditTarget(null);
    setForm(DEFAULT_FORM);
    setShowForm(true);
  };
  const openEdit = (a: Activity) => {
    setEditTarget(a);
    setForm({
      name: a.name, code: a.code, description: a.description ?? "",
      category: a.category ?? "", points_value: a.points_value,
      status: a.status, icon_name: a.icon_name ?? "Zap",
      color: a.color ?? "hsl(0 85% 52%)", parent_id: a.parent_id ?? "",
    });
    setShowForm(true);
  };

  // Fetch actual activity_logs counts for comparison in Edit Count modal
  useEffect(() => {
    if (!activeEvent || !isAdmin) return;
    supabase.from("activity_logs").select("activity_id").eq("event_id", activeEvent.id)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        (data ?? []).forEach((row: { activity_id: string | null }) => {
          if (row.activity_id) counts[row.activity_id] = (counts[row.activity_id] ?? 0) + 1;
        });
        setActualCounts(counts);
      });
  }, [activeEvent, isAdmin, activities]);

  // Auto-generate code from name
  const handleNameChange = (name: string) => {
    const code = name.toUpperCase().replace(/[^A-Z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
    setForm(f => ({ ...f, name, ...(!editTarget ? { code } : {}) }));
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim() || !activeEvent) return;
    setSaving(true);
    try {
      const payload = {
        event_id: activeEvent.id,
        parent_id: form.parent_id || null,
        name: form.name.trim(),
        code: form.code.trim(),
        description: form.description.trim() || null,
        category: form.category.trim() || null,
        points_value: form.points_value,
        status: form.status,
        icon_name: form.icon_name,
        color: form.color,
        created_by: user?.id ?? null,
      };

      if (editTarget) {
        const { error } = await supabase.from("activities").update(payload).eq("id", editTarget.id);
        if (error) throw error;
        toast({ title: "Activity updated" });
      } else {
        const maxOrder = Math.max(0, ...activities.map(a => a.sort_order));
        const { error } = await supabase.from("activities").insert({ ...payload, sort_order: maxOrder + 1 });
        if (error) throw error;
        toast({ title: "Activity created" });
      }

      setShowForm(false);
      await refresh();
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (a: Activity) => {
    const { error } = await supabase.from("activities").delete().eq("id", a.id);
    if (error) toast({ title: error.message, variant: "destructive" });
    else { toast({ title: `"${a.name}" deleted` }); await refresh(); }
    setDeleteConfirm(null);
  };

  const handleToggle = async (a: Activity) => {
    const newStatus = a.status === "active" ? "inactive" : "active";
    await supabase.from("activities").update({ status: newStatus }).eq("id", a.id);
    await refresh();
  };

  const handleArchive = async (a: Activity) => {
    await supabase.from("activities").update({ status: "archived" }).eq("id", a.id);
    toast({ title: `"${a.name}" archived` });
    await refresh();
  };

  const handleCopyFromEvent = async () => {
    if (!copySourceId || !activeEvent) return;
    setCopying(true);
    try {
      const { data: source } = await supabase
        .from("activities")
        .select("*")
        .eq("event_id", copySourceId)
        .eq("status", "active");

      if (!source || source.length === 0) {
        toast({ title: "No active activities found in source event", variant: "destructive" });
        return;
      }

      // Insert parent activities first, then sub-activities
      const parents = source.filter((a: Activity) => !a.parent_id);
      const subs = source.filter((a: Activity) => a.parent_id);

      const idMap: Record<string, string> = {};

      for (const p of parents) {
        const { data: inserted } = await supabase.from("activities").insert({
          event_id: activeEvent.id,
          parent_id: null,
          name: p.name, code: p.code, description: p.description,
          category: p.category, points_value: p.points_value,
          status: "active", icon_name: p.icon_name, color: p.color, sort_order: p.sort_order,
          created_by: user?.id,
        }).select("id").maybeSingle();
        if (inserted) idMap[p.id] = inserted.id;
      }

      for (const s of subs) {
        await supabase.from("activities").insert({
          event_id: activeEvent.id,
          parent_id: s.parent_id ? idMap[s.parent_id] ?? null : null,
          name: s.name, code: s.code, description: s.description,
          category: s.category, points_value: s.points_value,
          status: "active", icon_name: s.icon_name, color: s.color, sort_order: s.sort_order,
          created_by: user?.id,
        });
      }

      toast({ title: `Copied ${source.length} activities from event` });
      await refresh();
      setCopySourceId("");
    } catch (err) {
      toast({ title: (err as Error).message, variant: "destructive" });
    } finally {
      setCopying(false);
    }
  };

  const topLevelActive = topLevel.filter(a => a.status !== "archived");
  const topLevelArchived = topLevel.filter(a => a.status === "archived");
  const otherEvents = events.filter(e => e.id !== activeEvent?.id);

  return (
    <AppLayout title="Activities" subtitle="Manage experience zones for this event">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header actions */}
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <ListChecks className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">{activeEvent?.name ?? "No event selected"}</p>
              <p className="text-xs text-muted-foreground">{activities.length} activities total</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {otherEvents.length > 0 && (
              <div className="flex items-center gap-2">
                <select
                  value={copySourceId}
                  onChange={e => setCopySourceId(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-secondary border border-border text-xs text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">Copy from event…</option>
                  {otherEvents.map(e => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
                {copySourceId && (
                  <Button size="sm" variant="outline" onClick={handleCopyFromEvent} disabled={copying} className="gap-1.5 border-border">
                    <Copy className="h-3.5 w-3.5" />
                    {copying ? "Copying…" : "Copy"}
                  </Button>
                )}
              </div>
            )}
            <Button onClick={openCreate} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />New Activity
            </Button>
          </div>
        </div>

        {/* Activity list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-secondary animate-pulse" />
            ))}
          </div>
        ) : topLevelActive.length === 0 ? (
          <div className="glass-card rounded-xl px-6 py-12 text-center space-y-3">
            <ListChecks className="h-8 w-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">No activities yet. Create the first one.</p>
            <Button onClick={openCreate} size="sm" className="gap-2 bg-primary text-primary-foreground">
              <Plus className="h-3.5 w-3.5" />Create Activity
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {topLevelActive.map(a => (
              <ActivityRow
                key={a.id} activity={a}
                subs={subActivities(a.id)}
                onEdit={openEdit} onDelete={setDeleteConfirm}
                onToggle={handleToggle} onArchive={handleArchive}
                onEditCount={isAdmin ? setEditCountTarget : undefined}
                onManageSessions={isAdmin ? setSessionTarget : undefined}
                actualCount={actualCounts[a.id] ?? 0}
              />
            ))}
          </div>
        )}

        {/* Archived section */}
        {topLevelArchived.length > 0 && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground/60 mb-2">Archived</p>
            <div className="space-y-2 opacity-50">
              {topLevelArchived.map(a => (
                <ActivityRow
                  key={a.id} activity={a} subs={subActivities(a.id)}
                  onEdit={openEdit} onDelete={setDeleteConfirm}
                  onToggle={handleToggle} onArchive={handleArchive}
                  onEditCount={isAdmin ? setEditCountTarget : undefined}
                  onManageSessions={isAdmin ? setSessionTarget : undefined}
                  actualCount={actualCounts[a.id] ?? 0}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ─── Create/Edit Form Modal ─────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="w-full max-w-lg bg-card border border-primary/20 rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
              <p className="text-sm font-black text-foreground">
                {editTarget ? "Edit Activity" : "Create Activity"}
              </p>
              <button onClick={() => setShowForm(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Name + Code */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Activity Name *</label>
                  <Input value={form.name} onChange={e => handleNameChange(e.target.value)}
                    placeholder="Club 100" className="bg-secondary border-border focus:border-primary" />
                </div>
                <div>
                  <label className="field-label">Code *</label>
                  <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                    placeholder="CLUB100" className="bg-secondary border-border focus:border-primary font-mono" />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="field-label">Description</label>
                <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  placeholder="Brief description" className="bg-secondary border-border focus:border-primary" />
              </div>

              {/* Category + Points */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Category</label>
                  <Input value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    placeholder="e.g. Gaming, Music" className="bg-secondary border-border focus:border-primary" />
                </div>
                <div>
                  <label className="field-label">Points Value</label>
                  <Input type="number" min={0} value={form.points_value}
                    onChange={e => setForm(f => ({ ...f, points_value: parseInt(e.target.value) || 0 }))}
                    className="bg-secondary border-border focus:border-primary" />
                </div>
              </div>

              {/* Parent activity (sub-activity) */}
              <div>
                <label className="field-label">Parent Activity (optional — for sub-activities)</label>
                <select
                  value={form.parent_id}
                  onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary"
                >
                  <option value="">None (top-level activity)</option>
                  {topLevel.filter(a => a.id !== editTarget?.id).map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="field-label">Status</label>
                <div className="flex gap-2">
                  {(["active", "inactive", "archived"] as const).map(s => (
                    <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-bold capitalize transition-all",
                        form.status === s
                          ? s === "active" ? "bg-success/20 border-success text-success"
                          : s === "archived" ? "bg-destructive/20 border-destructive text-destructive"
                          : "bg-secondary border-border text-foreground"
                          : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                      )}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Icon picker */}
              <div>
                <label className="field-label">Icon</label>
                <div className="grid grid-cols-8 gap-1.5">
                  {ICON_NAMES.map(iconName => {
                    const IconComp = ICON_MAP[iconName];
                    return (
                      <button key={iconName} onClick={() => setForm(f => ({ ...f, icon_name: iconName }))}
                        title={iconName}
                        className={cn(
                          "p-2 rounded-lg border transition-all aspect-square flex items-center justify-center",
                          form.icon_name === iconName
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border bg-secondary text-muted-foreground hover:text-foreground hover:border-border"
                        )}>
                        <IconComp className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Color picker */}
              <div>
                <label className="field-label">Color</label>
                <div className="flex gap-2 flex-wrap">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setForm(f => ({ ...f, color: c }))}
                      className="w-7 h-7 rounded-full border-2 transition-all"
                      style={{
                        backgroundColor: c,
                        borderColor: form.color === c ? "white" : "transparent",
                        boxShadow: form.color === c ? `0 0 0 2px ${c}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-xl bg-secondary border border-border p-3 flex items-center gap-3">
                <div className="p-2 rounded-lg" style={{ backgroundColor: `${form.color}25` }}>
                  {(() => { const I = resolveIcon(form.icon_name); return <I className="h-4 w-4" style={{ color: form.color }} />; })()}
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">{form.name || "Activity Name"}</p>
                  <p className="text-xs text-muted-foreground">{form.code || "CODE"} · {form.points_value} pts · {form.category || "Category"}</p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1 border-border">Cancel</Button>
                <Button onClick={handleSave} disabled={saving || !form.name || !form.code} className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
                  {saving ? "Saving…" : editTarget ? "Save Changes" : "Create Activity"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Delete confirm modal ────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-destructive/30 rounded-2xl p-6 space-y-4 slide-up">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-destructive/15">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-sm font-black text-foreground">Delete Activity</p>
                <p className="text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-foreground">
              Delete <strong>"{deleteConfirm.name}"</strong>? Existing activity logs referencing this activity will remain but the activity won't appear in new selections.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDeleteConfirm(null)} className="flex-1 border-border">Cancel</Button>
              <Button onClick={() => handleDelete(deleteConfirm)} className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2">
                <Trash2 className="h-4 w-4" />Delete
              </Button>
            </div>
          </div>
        </div>
      )}
      {/* ─── Edit Count Modal ────────────────────────────────────────────────────── */}
      {editCountTarget && (
        <EditCountModal
          activity={editCountTarget}
          actualCount={actualCounts[editCountTarget.id] ?? 0}
          onClose={() => setEditCountTarget(null)}
          onSaved={() => { refresh(); setEditCountTarget(null); }}
        />
      )}

      {/* ─── Session Manager Modal ─────────────────────────────────────────────── */}
      {sessionTarget && activeEvent && (
        <SessionManager
          activity={sessionTarget}
          eventId={activeEvent.id}
          staffId={user?.id}
          onClose={() => setSessionTarget(null)}
        />
      )}
    </AppLayout>
  );
}
