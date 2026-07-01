import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { useGuest } from "@/contexts/GuestContext";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Search, Download, CheckCircle2, Clock, HardHat, Phone, Building2,
  RefreshCw, Pencil, Trash2, Save, X, Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { UncheckModal } from "@/components/checkin/UncheckModal";

interface CrewMember {
  id: string;
  code: string;
  name: string;
  department: string | null;
  phone: string | null;
  is_checked_in: boolean;
  checked_in_at: string | null;
  created_at: string;
}

type Filter = "all" | "checked_in" | "not_checked_in";

export default function CrewMembers() {
  const [crew, setCrew] = useState<CrewMember[]>([]);
  const [selected, setSelected] = useState<CrewMember | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  // Edit state
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDept, setEditDept] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // Delete state
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Uncheck state
  const [showUncheck, setShowUncheck] = useState(false);

  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { role } = useAuth();
  const canUncheck = role === "admin" || role === "event_admin";
  const currentEventId = isGuestMode ? guestSession?.eventId : activeEvent?.id;

  const fetchCrew = useCallback(async (q: string, f: Filter) => {
    setLoading(true);
    let req = supabase.from("crew_members").select("*", { count: "exact" });
    if (currentEventId) req = req.eq("event_id", currentEventId);
    if (q.trim()) {
      req = req.or(`code.ilike.%${q}%,name.ilike.%${q}%,department.ilike.%${q}%,phone.ilike.%${q}%`);
    }
    if (f === "checked_in") req = req.eq("is_checked_in", true);
    if (f === "not_checked_in") req = req.eq("is_checked_in", false);
    req = req.order("name", { ascending: true }).limit(100);
    const { data, count } = await req;
    setCrew((data as CrewMember[]) ?? []);
    if (!q && f === "all") setTotal(count ?? 0);
    setLoading(false);
  }, [currentEventId]);

  useEffect(() => {
    const t = setTimeout(() => fetchCrew(query, filter), 300);
    return () => clearTimeout(t);
  }, [query, filter, fetchCrew]);

  useEffect(() => {
    const channel = supabase.channel("crew_realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "crew_members" }, () => {
        fetchCrew(query, filter);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [query, filter, fetchCrew]);

  const selectMember = (m: CrewMember) => {
    setSelected(selected?.id === m.id ? null : m);
    setEditing(false);
    setConfirmDelete(false);
  };

  const startEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditDept(selected.department ?? "");
    setEditPhone(selected.phone ?? "");
    setEditing(true);
    setConfirmDelete(false);
  };

  const handleSave = async () => {
    if (!selected || !editName.trim()) return;
    setSaving(true);
    const { data, error } = await supabase
      .from("crew_members")
      .update({ name: editName.trim(), department: editDept.trim() || null, phone: editPhone.trim() || null })
      .eq("id", selected.id)
      .select("*")
      .single();
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      setSelected(data as CrewMember);
      setEditing(false);
      toast({ title: "Changes saved" });
      fetchCrew(query, filter);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!selected) return;
    setDeleting(true);
    const { error } = await supabase.from("crew_members").delete().eq("id", selected.id);
    if (error) {
      toast({ title: "Failed to delete", variant: "destructive" });
    } else {
      toast({ title: `${selected.name} removed` });
      setSelected(null);
      setConfirmDelete(false);
      fetchCrew(query, filter);
    }
    setDeleting(false);
  };

  const exportCsv = () => {
    const rows = [["Code", "Name", "Department", "Phone", "Checked In", "Check-In Time"],
    ...crew.map(c => [c.code, c.name, c.department ?? "", c.phone ?? "",
    c.is_checked_in ? "Yes" : "No", c.checked_in_at ?? ""])];
    const csv = rows.map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "tg100_crew_members.csv"; a.click();
  };

  return (
    <AppLayout title="Crew Members" subtitle={`${total} registered crew`}>
      <div className="flex flex-col lg:flex-row gap-6 h-full">
        {/* Left Panel */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search code, name, department..."
                className="pl-9 bg-secondary border-border focus:border-primary h-10" />
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2 border-border text-muted-foreground">
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate("/import-crew")} className="gap-2 border-border text-muted-foreground">
              Import
            </Button>
          </div>

          <div className="flex gap-2 mb-4">
            {(["all", "checked_in", "not_checked_in"] as Filter[]).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn("px-4 py-1.5 rounded-full text-xs font-bold transition-all",
                  filter === f ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground")}>
                {f === "all" ? "All" : f === "checked_in" ? "Checked In" : "Not Checked In"}
              </button>
            ))}
          </div>

          <div className="glass-card rounded-2xl overflow-hidden flex-1">
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <RefreshCw className="h-5 w-5 text-primary animate-spin" />
              </div>
            ) : crew.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                <HardHat className="h-8 w-8 mb-2 opacity-30" />
                <p>No crew members found</p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "600px" }}>
                {crew.map(m => (
                  <button key={m.id} onClick={() => selectMember(m)}
                    className={cn("w-full flex items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-secondary/60",
                      selected?.id === m.id && "bg-primary/10 border-l-2 border-primary")}>
                    <div className="px-3 py-1 bg-primary/10 border border-primary/30 rounded-lg shrink-0">
                      <span className="text-sm font-black font-mono text-primary">#{m.code}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{m.name}</p>
                      {m.department && <p className="text-xs text-muted-foreground truncate">{m.department}</p>}
                    </div>
                    <div className={cn("shrink-0 w-2 h-2 rounded-full", m.is_checked_in ? "bg-success" : "bg-muted-foreground/30")} />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Panel */}
        {selected && (
          <div className="w-full lg:w-80 glass-card rounded-2xl p-6 self-start sticky top-4 slide-up">
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Crew Profile</span>
              <div className="flex items-center gap-1">
                {!editing && (
                  <>
                    <button onClick={startEdit}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(true)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
                <button onClick={() => { setSelected(null); setEditing(false); setConfirmDelete(false); }}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {!editing && !confirmDelete && (
              <>
                <div className="flex flex-col items-center text-center mb-6">
                  <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mb-3">
                    <HardHat className="h-7 w-7 text-primary" />
                  </div>
                  <h2 className="text-lg font-black text-foreground">{selected.name}</h2>
                  <span className="text-xs font-mono text-primary font-bold mt-1">Code #{selected.code}</span>
                </div>
                <div className="space-y-3">
                  {selected.department && (
                    <div className="flex items-center gap-3 bg-secondary rounded-xl px-4 py-3">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Department</p>
                        <p className="text-sm font-semibold text-foreground">{selected.department}</p>
                      </div>
                    </div>
                  )}
                  {selected.phone && (
                    <div className="flex items-center gap-3 bg-secondary rounded-xl px-4 py-3">
                      <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Phone</p>
                        <p className="text-sm font-semibold text-foreground">{selected.phone}</p>
                      </div>
                    </div>
                  )}
                  <div className={cn("flex items-center gap-3 rounded-xl px-4 py-3",
                    selected.is_checked_in ? "bg-success/10 border border-success/30" : "bg-secondary")}>
                    {selected.is_checked_in
                      ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" />
                      : <Clock className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <div>
                      <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Status</p>
                      <p className={cn("text-sm font-bold", selected.is_checked_in ? "text-success" : "text-muted-foreground")}>
                        {selected.is_checked_in ? "Checked In" : "Not Yet Checked In"}
                      </p>
                      {selected.checked_in_at && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(selected.checked_in_at).toLocaleTimeString()}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {selected.is_checked_in && canUncheck && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowUncheck(true)}
                    className="w-full mt-3 gap-2 border-amber-500/40 text-amber-500 hover:bg-amber-500/10 hover:border-amber-500 hover:text-amber-500"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    Uncheck Crew Member
                  </Button>
                )}
              </>
            )}

            {showUncheck && selected && currentEventId && (
              <UncheckModal
                type="crew"
                id={selected.id}
                name={selected.name}
                code={selected.code}
                checkedInAt={selected.checked_in_at}
                eventId={currentEventId}
                onClose={() => setShowUncheck(false)}
                onSuccess={() => {
                  setShowUncheck(false);
                  setSelected(prev => prev ? { ...prev, is_checked_in: false, checked_in_at: null } : null);
                  fetchCrew(query, filter);
                }}
              />
            )}

            {editing && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">Edit Crew Member</p>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Full Name *</label>
                  <Input value={editName} onChange={e => setEditName(e.target.value)}
                    className="mt-1 bg-secondary border-border focus:border-primary h-10" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Department</label>
                  <Input value={editDept} onChange={e => setEditDept(e.target.value)}
                    className="mt-1 bg-secondary border-border focus:border-primary h-10" />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Phone</label>
                  <Input value={editPhone} onChange={e => setEditPhone(e.target.value.replace(/\D/g, ""))}
                    className="mt-1 bg-secondary border-border focus:border-primary h-10" />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button onClick={handleSave} disabled={saving || !editName.trim()}
                    className="flex-1 gap-2 bg-primary text-primary-foreground font-bold">
                    {saving ? <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                  <Button variant="outline" onClick={() => setEditing(false)} className="border-border">Cancel</Button>
                </div>
              </div>
            )}

            {confirmDelete && (
              <div className="space-y-4">
                <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 text-center">
                  <Trash2 className="h-6 w-6 text-destructive mx-auto mb-2" />
                  <p className="text-sm font-bold text-foreground">Delete this crew member?</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-semibold text-foreground">{selected.name}</span> will be permanently removed.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={handleDelete} disabled={deleting}
                    className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 font-bold gap-2">
                    {deleting ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete
                  </Button>
                  <Button variant="outline" onClick={() => setConfirmDelete(false)} className="border-border">Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
