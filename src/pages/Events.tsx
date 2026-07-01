import { useState, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent, SoulEvent } from "@/contexts/EventContext";
import { Input } from "@/components/ui/input";
import { EventAccessTokenManager } from "@/components/EventAccessTokenManager";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays, MapPin, Plus, CheckCircle2, Archive,
  Clock, Pencil, Save, X, Radio, Zap, ExternalLink, Link,
} from "lucide-react";
import { cn } from "@/lib/utils";

type EventStatus = "draft" | "active" | "completed";

const STATUS_CONFIG: Record<EventStatus, { label: string; color: string; icon: typeof Radio }> = {
  active: { label: "Active", color: "text-success border-success/30 bg-success/10", icon: Radio },
  draft: { label: "Draft", color: "text-muted-foreground border-border bg-secondary", icon: Clock },
  completed: { label: "Completed", color: "text-primary border-primary/30 bg-primary/10", icon: Archive },
};

interface EventFormData {
  name: string; code: string; slug: string; date: string; venue: string; status: EventStatus;
}

const EMPTY_FORM: EventFormData = { name: "", code: "", slug: "", date: "", venue: "", status: "active" };

function toSlug(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export default function Events() {
  const { events, activeEvent, setActiveEvent, refetch } = useEvent();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<EventFormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [importUrl, setImportUrl] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importingFile, setImportingFile] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (event: SoulEvent) => {
    setEditingId(event.id);
    setForm({
      name: event.name,
      code: event.code,
      slug: event.slug ?? toSlug(event.name),
      date: event.date ?? "",
      venue: event.venue ?? "",
      status: event.status,
    });
    setShowForm(true);
  };

  const handleNameChange = (name: string) => {
    setForm(f => ({
      ...f,
      name,
      // Auto-fill slug only if slug hasn't been manually edited
      slug: f.slug === toSlug(f.name) || f.slug === "" ? toSlug(name) : f.slug,
    }));
  };

  const handleImportFromUrl = async () => {
    if (!importUrl.trim()) {
      setImportError("Please enter an event URL.");
      return;
    }

    const targetEvent = activeEvent ?? (events.length === 1 ? events[0] : null);
    if (!targetEvent) {
      setImportError("Select an event first, or create one before importing.");
      return;
    }

    if (!activeEvent) {
      setActiveEvent(targetEvent);
      toast({ title: `Selected ${targetEvent.name} for import` });
    }

    setImportingUrl(true);
    setImportError(null);

    try {
      const { data, error } = await supabase.functions.invoke("import-event", {
        body: { url: importUrl.trim() },
      });

      if (error) {
        throw new Error(error?.message || "Unable to call import function");
      }

      if (!data || data.ok !== true) {
        const msg = data?.error || "Could not import event details from URL";
        setImportError(msg);
        setImportingUrl(false);
        return;
      }

      const generatedCode = data.name
        ? data.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 30)
        : "";
      const generatedSlug = data.name ? toSlug(data.name) : "";

      setForm({
        name: data.name ?? targetEvent.name,
        date: data.date ?? targetEvent.date ?? "",
        venue: data.venue ?? targetEvent.venue ?? "",
        slug: targetEvent.slug ?? generatedSlug,
        code: targetEvent.code ?? generatedCode,
        status: targetEvent.status,
      });

      setEditingId(targetEvent.id);
      toast({ title: "Selected event updated", description: "Imported details will overwrite the active event." });
      setShowForm(true);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImportingUrl(false);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) {
      toast({ title: "Name and Code are required", variant: "destructive" });
      return;
    }
    const slug = form.slug.trim() || toSlug(form.name);
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await supabase.from("events").update({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          slug,
          date: form.date || null,
          venue: form.venue.trim() || null,
          status: form.status,
        }).eq("id", editingId);
        if (error) throw error;
        toast({ title: "Event updated" });
      } else {
        const { error } = await supabase.from("events").insert({
          name: form.name.trim(),
          code: form.code.trim().toUpperCase(),
          slug,
          date: form.date || null,
          venue: form.venue.trim() || null,
          status: form.status,
        });
        if (error) throw error;
        toast({ title: "Event created" });
      }
      await refetch();
      setShowForm(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleSwitch = (event: SoulEvent) => {
    setActiveEvent(event);
    toast({ title: `Switched to ${event.name}` });
  };

  const liveUrl = (event: SoulEvent) => {
    const slug = event.slug ?? toSlug(event.name);
    return `${window.location.origin}/live/${slug}`;
  };

  return (
    <AppLayout title="Events" subtitle="Manage Soulcomms events · click an event to make it active">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* Header action */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Button onClick={openCreate} className="gap-2 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 font-bold">
            <Plus className="h-4 w-4" /> New Event
          </Button>
          <div className="w-full sm:max-w-md">
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Import event from URL</label>
            <div className="mt-2 flex gap-2">
              <Input
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="https://..."
                className="bg-secondary border-border focus:border-primary h-11"
              />
              <Button
                onClick={handleImportFromUrl}
                disabled={importingUrl}
                className="gap-2 bg-secondary border-border text-foreground hover:bg-secondary/80"
              >
                {importingUrl ? "Importing..." : "Import"}
              </Button>
            </div>
            {importError && <p className="text-xs text-destructive mt-2">{importError}</p>}
            <div className="mt-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Or import from Excel</label>
              <div className="mt-2 flex gap-2 items-center">
                <input ref={fileRef as any} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  if (!f) return;
                  // reuse active event selection logic
                  const targetEvent = activeEvent ?? (events.length === 1 ? events[0] : null);
                  if (!targetEvent) {
                    setImportError("Select an event first, or create one before importing.");
                    return;
                  }
                  if (!activeEvent) {
                    setActiveEvent(targetEvent);
                    toast({ title: `Selected ${targetEvent.name} for import` });
                  }
                  setImportingFile(true);
                  setImportError(null);
                  try {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      try {
                        const data = ev.target?.result;
                        const workbook = XLSX.read(data as ArrayBuffer, { type: "array" });
                        const sheetName = workbook.SheetNames[0];
                        const sheet = workbook.Sheets[sheetName];
                        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
                        if (!rows || rows.length === 0) throw new Error("Empty spreadsheet");
                        const header = rows[0].map(h => String(h || "").toLowerCase().trim());
                        const firstRow = rows[1] ?? rows[0];
                        const getByNames = (names: string[]) => {
                          for (const n of names) {
                            const idx = header.findIndex(h => h.includes(n));
                            if (idx >= 0) return firstRow[idx] ?? null;
                          }
                          return null;
                        };
                        const name = getByNames(["name", "event name", "title"]) || String(firstRow[0] || "");
                        const date = getByNames(["date", "event date", "start date"]) || "";
                        const venue = getByNames(["venue", "location", "place"]) || "";

                        const generatedCode = name
                          ? String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 30)
                          : "";
                        const generatedSlug = name ? toSlug(String(name)) : "";

                        setForm({
                          name: String(name ?? targetEvent.name),
                          date: String(date ?? targetEvent.date ?? ""),
                          venue: String(venue ?? targetEvent.venue ?? ""),
                          slug: targetEvent.slug ?? generatedSlug,
                          code: targetEvent.code ?? generatedCode,
                          status: targetEvent.status,
                        });
                        setEditingId(targetEvent.id);
                        setShowForm(true);
                        toast({ title: "Selected event updated", description: "Imported details will overwrite the active event." });
                      } catch (err) {
                        setImportError(err instanceof Error ? err.message : String(err));
                      } finally {
                        setImportingFile(false);
                      }
                    };
                    reader.onerror = (err) => {
                      setImportError("Failed to read file");
                      setImportingFile(false);
                    };
                    reader.readAsArrayBuffer(f);
                  } catch (err) {
                    setImportError(err instanceof Error ? err.message : String(err));
                    setImportingFile(false);
                  }
                }} />
                <Button onClick={() => (fileRef as any).current?.click()} disabled={importingFile} className="gap-2 bg-secondary border-border text-foreground hover:bg-secondary/80">
                  {importingFile ? "Importing..." : "Import Excel"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1.5">CSV or Excel (.xlsx/.xls)</p>
              </div>
            </div>
          </div>
        </div>

        {/* Create / Edit form */}
        {showForm && (
          <div className="glass-card rounded-2xl p-6 border border-primary/20 slide-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-bold text-foreground">
                {editingId ? "Edit Event" : "Create New Event"}
              </h3>
              <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Event Name *</label>
                <Input value={form.name} onChange={e => handleNameChange(e.target.value)}
                  placeholder="The Gathering 100 - MTN"
                  className="mt-1 bg-secondary border-border focus:border-primary h-11" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Event Code *</label>
                <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))}
                  placeholder="TG100-MTN"
                  className="mt-1 bg-secondary border-border focus:border-primary h-11 font-mono" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  Live Page Slug
                </label>
                <Input
                  value={form.slug}
                  onChange={e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))}
                  placeholder="the-gathering-100"
                  className="mt-1 bg-secondary border-border focus:border-primary h-11 font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground mt-1 font-mono truncate">
                  /live/{form.slug || toSlug(form.name) || "slug"}
                </p>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Status</label>
                <div className="flex gap-2 mt-1">
                  {(["draft", "active", "completed"] as EventStatus[]).map(s => (
                    <button key={s} onClick={() => setForm(f => ({ ...f, status: s }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg border text-xs font-bold capitalize transition-all",
                        form.status === s ? "border-primary bg-primary/10 text-primary" : "border-border bg-secondary text-muted-foreground hover:text-foreground"
                      )}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Event Date</label>
                <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="mt-1 bg-secondary border-border focus:border-primary h-11" />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Venue</label>
                <Input value={form.venue} onChange={e => setForm(f => ({ ...f, venue: e.target.value }))}
                  placeholder="Lagos, Nigeria"
                  className="mt-1 bg-secondary border-border focus:border-primary h-11" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <Button onClick={handleSave} disabled={saving || !form.name.trim() || !form.code.trim()}
                className="gap-2 bg-primary text-primary-foreground font-bold shadow-glow-primary hover:bg-primary/90">
                {saving
                  ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  : <Save className="h-4 w-4" />}
                {editingId ? "Save Changes" : "Create Event"}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)} className="border-border">Cancel</Button>
            </div>
          </div>
        )}

        {/* Events list */}
        <div className="space-y-3">
          {events.length === 0 ? (
            <div className="glass-card rounded-2xl px-6 py-10 text-center text-muted-foreground text-sm">
              No events yet. Create one above.
            </div>
          ) : events.map(event => {
            const isActive = activeEvent?.id === event.id;
            const cfg = STATUS_CONFIG[event.status as EventStatus] ?? STATUS_CONFIG.draft;
            const StatusIcon = cfg.icon;
            const url = liveUrl(event);
            return (
              <div
                key={event.id}
                className={cn(
                  "glass-card rounded-2xl p-5 transition-all duration-150",
                  isActive && "border-primary/50 shadow-glow-primary"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-base font-black text-foreground">{event.name}</h3>
                      {isActive && (
                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-[10px] font-black text-primary uppercase tracking-wider">
                          <Zap className="h-2.5 w-2.5" />Active
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="text-xs font-mono font-bold text-muted-foreground">{event.code}</span>
                      <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-bold", cfg.color)}>
                        <StatusIcon className="h-2.5 w-2.5" />
                        {cfg.label}
                      </span>
                      {event.date && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(event.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </span>
                      )}
                      {event.venue && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />
                          {event.venue}
                        </span>
                      )}
                    </div>

                    {/* Live page URL */}
                    <div className="flex items-center gap-2 mt-2">
                      <Link className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-[10px] font-mono text-muted-foreground hover:text-primary transition-colors truncate"
                      >
                        {url}
                      </a>
                      <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/60 shrink-0" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => openEdit(event)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <EventAccessTokenManager eventId={event.id} eventName={event.name} />
                    {!isActive && (
                      <Button
                        size="sm"
                        onClick={() => handleSwitch(event)}
                        variant="outline"
                        className="gap-1.5 border-primary/30 text-primary hover:bg-primary/10 hover:text-primary text-xs font-bold"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />Switch
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AppLayout>
  );
}
