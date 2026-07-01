import { useState, useEffect, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { STAFF_ROLES, STATUS_CONFIG, getRoleDef, StaffRoleValue } from "@/lib/staffRoles";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";
import {
  UserPlus, Search, RefreshCw, Pencil, Trash2,
  ToggleLeft, ToggleRight, X, CheckCircle, AlertTriangle,
  Users, Clock, History, Eye, EyeOff, LogOut, ShieldAlert, Wifi, MessageSquare,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────────────────────────────────
interface StaffMember {
  id: string;
  email: string;
  name?: string;
  phone?: string | null;
  role?: StaffRoleValue;
  status?: "active" | "disabled" | "suspended";
  assigned_event_id?: string | null;
  last_seen_at?: string | null;
  last_sign_in_at?: string | null;
  created_at?: string;
}

interface AuditLog {
  id: string;
  staff_name: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
const timeAgo = (iso: string | null | undefined) => {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const isOnline = (s: StaffMember) => {
  const t = s.last_seen_at;
  if (!t) return false;
  return Date.now() - new Date(t).getTime() < 30 * 60 * 1000;
};

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  account_created:    { label: "Account Created",    color: "text-success" },
  account_changed:    { label: "Profile Updated",    color: "text-primary" },
  account_disabled:   { label: "Account Disabled",   color: "text-destructive" },
  account_enabled:    { label: "Account Enabled",    color: "text-success" },
  account_suspended:  { label: "Account Suspended",  color: "text-amber-400" },
  account_deleted:    { label: "Account Deleted",    color: "text-destructive" },
  force_logout:       { label: "Force Logout",       color: "text-amber-400" },
  force_logout_all:   { label: "Logout All Users",   color: "text-destructive" },
  login:              { label: "Login",              color: "text-muted-foreground" },
  logout:             { label: "Logout",             color: "text-muted-foreground" },
  checkin_recorded:   { label: "Check-In Recorded",  color: "text-muted-foreground" },
  activity_recorded:  { label: "Activity Recorded",  color: "text-muted-foreground" },
};

type Tab = "directory" | "sessions" | "create" | "audit";

// ─── Sub-components ────────────────────────────────────────────────────────────
const RoleBadge = ({ role }: { role?: string }) => {
  const def = getRoleDef(role ?? "");
  if (!def) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border"
      style={{ color: def.color, backgroundColor: `${def.color}18`, borderColor: `${def.color}40` }}>
      {def.label}
    </span>
  );
};

const StatusBadge = ({ status }: { status?: string }) => {
  const cfg = STATUS_CONFIG[status ?? ""] ?? STATUS_CONFIG.active;
  return (
    <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full border capitalize", cfg.color, cfg.bg)}>
      {cfg.label}
    </span>
  );
};

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function StaffManagement() {
  const { user } = useAuth();
  const { events } = useEvent();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [tab, setTab] = useState<Tab>("directory");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const [editTarget, setEditTarget] = useState<StaffMember | null>(null);
  const [editForm, setEditForm] = useState({
    name: "", phone: "", email: "",
    role: "" as StaffRoleValue | "",
    status: "" as "active" | "disabled" | "suspended" | "",
    assigned_event_id: "",
  });

  const [deleteTarget, setDeleteTarget] = useState<StaffMember | null>(null);
  const [logoutAllConfirm, setLogoutAllConfirm] = useState(false);

  const [createForm, setCreateForm] = useState({
    name: "", email: "", password: "", phone: "",
    role: "" as StaffRoleValue | "", assigned_event_id: "",
  });
  const [creating, setCreating] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [justCreated, setJustCreated] = useState<string | null>(null);

  // ── Fetch staff ──────────────────────────────────────────────────────────────
  const fetchStaff = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: { action: "list_staff" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setStaff(data.users ?? []);
    } catch (err) {
      toast({ title: "Failed to load staff", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchAuditLogs = useCallback(async () => {
    const { data } = await supabase
      .from("staff_audit_logs")
      .select("id, staff_name, action, details, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    setAuditLogs((data ?? []) as AuditLog[]);
  }, []);

  useEffect(() => { fetchStaff(); }, [fetchStaff]);
  useEffect(() => { if (tab === "audit") fetchAuditLogs(); }, [tab, fetchAuditLogs]);

  // ── Derived ───────────────────────────────────────────────────────────────────
  const filteredStaff = staff.filter(s => {
    const q = search.toLowerCase();
    if (q && !(s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q) || s.phone?.includes(q))) return false;
    if (filterRole && s.role !== filterRole) return false;
    if (filterStatus && s.status !== filterStatus) return false;
    return true;
  });

  const onlineStaff = staff.filter(isOnline);

  // ── Actions ───────────────────────────────────────────────────────────────────
  const callManage = async (action: string, uid: string, extra: Record<string, unknown> = {}) => {
    setActionLoading(uid + action);
    try {
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: { action, userId: uid, ...extra },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data;
    } catch (err) {
      toast({ title: "Action failed", description: String(err), variant: "destructive" });
      throw err;
    } finally {
      setActionLoading(null);
    }
  };

  const handleDisableToggle = async (s: StaffMember) => {
    const action = s.status === "active" ? "disable" : "enable";
    const label = s.status === "active" ? "disabled" : "re-enabled";
    await callManage(action, s.id).catch(() => null);
    await fetchStaff();
    toast({ title: `${s.name ?? s.email} ${label}` });
  };

  const handleForceLogout = async (s: StaffMember) => {
    await callManage("force_logout", s.id).catch(() => null);
    toast({ title: `${s.name ?? s.email} has been logged out from all devices` });
  };

  const handleLogoutAll = async () => {
    setActionLoading("logout_all");
    try {
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: { action: "logout_all" },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: `Logged out ${data.count ?? "all"} users` });
      setLogoutAllConfirm(false);
      await fetchStaff();
    } catch (err) {
      toast({ title: "Logout all failed", description: String(err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (s: StaffMember) => {
    await callManage("delete", s.id, { name: s.name }).catch(() => null);
    await fetchStaff();
    toast({ title: `${s.name ?? s.email} deleted` });
    setDeleteTarget(null);
  };

  const openEdit = (s: StaffMember) => {
    setEditTarget(s);
    setEditForm({
      name: s.name ?? "", phone: s.phone ?? "", email: s.email ?? "",
      role: s.role ?? "", status: s.status ?? "active",
      assigned_event_id: s.assigned_event_id ?? "",
    });
  };

  const handleSaveEdit = async () => {
    if (!editTarget) return;
    setActionLoading("edit");
    try {
      const { data, error } = await supabase.functions.invoke("manage-staff", {
        body: {
          action: "update_profile", userId: editTarget.id,
          name: editForm.name, phone: editForm.phone,
          email: editForm.email !== editTarget.email ? editForm.email : undefined,
          role: editForm.role, status: editForm.status,
          assigned_event_id: editForm.assigned_event_id,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast({ title: "Staff profile updated" });
      setEditTarget(null);
      await fetchStaff();
    } catch (err) {
      toast({ title: "Update failed", description: String(err), variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name || !createForm.email || !createForm.password || !createForm.role) return;
    setCreating(true);
    setJustCreated(null);
    try {
      const { data, error } = await supabase.functions.invoke("create-staff", {
        body: {
          name: createForm.name, email: createForm.email,
          password: createForm.password, role: createForm.role,
          phone: createForm.phone || null,
          assigned_event_id: createForm.assigned_event_id || null,
        },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setJustCreated(createForm.email);
      setCreateForm({ name: "", email: "", password: "", phone: "", role: "", assigned_event_id: "" });
      await fetchStaff();
      toast({ title: "Staff account created!" });
    } catch (err) {
      toast({ title: "Failed to create staff", description: String(err), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const TABS: { id: Tab; label: string; icon: typeof Users; count?: number }[] = [
    { id: "directory", label: "Directory",     icon: Users,      count: staff.length },
    { id: "sessions",  label: "Active Now",    icon: Wifi,       count: onlineStaff.length },
    { id: "create",    label: "Create Staff",  icon: UserPlus },
    { id: "audit",     label: "Audit Log",     icon: History },
  ];

  return (
    <AppLayout title="Staff Management" subtitle="Manage team accounts, roles and access">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Stats bar */}
        <div className="grid grid-cols-4 gap-3">
          <div className="glass-card rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-black text-foreground">{staff.length}</p>
            <p className="text-[11px] text-muted-foreground">Total Staff</p>
          </div>
          <div className="glass-card rounded-xl px-4 py-3 text-center">
            <div className="flex items-center justify-center gap-1 mb-0.5">
              <div className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <p className="text-2xl font-black text-success">{onlineStaff.length}</p>
            </div>
            <p className="text-[11px] text-muted-foreground">Online Now</p>
          </div>
          <div className="glass-card rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-black text-foreground">{staff.filter(s => s.status === "active").length}</p>
            <p className="text-[11px] text-muted-foreground">Active</p>
          </div>
          <div className="glass-card rounded-xl px-4 py-3 text-center">
            <p className="text-2xl font-black text-destructive">{staff.filter(s => s.status !== "active").length}</p>
            <p className="text-[11px] text-muted-foreground">Disabled</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-secondary rounded-xl">
          {TABS.map(({ id, label, icon: Icon, count }) => (
            <button key={id} onClick={() => setTab(id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all",
                tab === id ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}>
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
              {count !== undefined && (
                <span className={cn(
                  "text-[10px] font-black px-1.5 py-0 rounded-full",
                  tab === id ? "bg-primary/20 text-primary" : "bg-secondary text-muted-foreground"
                )}>{count}</span>
              )}
            </button>
          ))}
        </div>

        {/* ── Directory ──────────────────────────────────────────────────────────── */}
        {tab === "directory" && (
          <div className="space-y-3">
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search name, email or phone…"
                  className="pl-10 bg-secondary border-border focus:border-primary" />
              </div>
              <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
                className="h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                <option value="">All Roles</option>
                {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="disabled">Disabled</option>
                <option value="suspended">Suspended</option>
              </select>
              <Button variant="outline" size="icon" onClick={fetchStaff} disabled={loading}
                className="border-border shrink-0" title="Refresh">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
            </div>

            {/* List */}
            {loading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-[72px] rounded-xl bg-secondary animate-pulse" />
                ))}
              </div>
            ) : filteredStaff.length === 0 ? (
              <div className="glass-card rounded-xl px-6 py-12 text-center">
                <Users className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-50" />
                <p className="text-sm text-muted-foreground">No staff found matching your filters.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredStaff.map(s => {
                  const online = isOnline(s);
                  const isSelf = s.id === user?.id;
                  const busy = actionLoading?.startsWith(s.id);
                  const eventName = events.find(e => e.id === s.assigned_event_id)?.name;
                  return (
                    <div key={s.id} className={cn(
                      "glass-card rounded-xl px-4 py-3 flex items-center gap-3 fade-in-up transition-opacity",
                      s.status !== "active" && "opacity-60",
                    )}>
                      {/* Avatar */}
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-black text-foreground border border-border">
                          {(s.name ?? s.email ?? "?").charAt(0).toUpperCase()}
                        </div>
                        {online && (
                          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-background" />
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-bold text-foreground">{s.name ?? "Unnamed"}</p>
                          {isSelf && <span className="text-[10px] text-primary font-bold">(You)</span>}
                          <RoleBadge role={s.role} />
                          <StatusBadge status={s.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                        <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                          {s.phone && <p className="text-xs text-muted-foreground">{s.phone}</p>}
                          {eventName && <p className="text-[11px] text-muted-foreground border border-border rounded px-1.5 py-0">{eventName}</p>}
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" />
                            <span className="text-[11px]">Login: {timeAgo(s.last_sign_in_at)}</span>
                          </div>
                          {online && (
                            <span className="text-[11px] text-success font-semibold">Active now</span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      {!isSelf && (
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            onClick={() => navigate(`/communications?startDm=${s.id}`)}
                            title="Send direct message"
                            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openEdit(s)} title="Edit profile" disabled={!!busy}
                            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDisableToggle(s)} disabled={!!busy}
                            title={s.status === "active" ? "Disable account" : "Enable account"}
                            className={cn("p-2 rounded-lg transition-colors",
                              s.status === "active"
                                ? "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10"
                                : "text-muted-foreground hover:text-success hover:bg-success/10"
                            )}>
                            {s.status === "active" ? <ToggleRight className="h-3.5 w-3.5" /> : <ToggleLeft className="h-3.5 w-3.5" />}
                          </button>
                          <button onClick={() => handleForceLogout(s)} disabled={!!busy}
                            title="Force logout from all devices"
                            className="p-2 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                            <LogOut className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setDeleteTarget(s)} disabled={!!busy}
                            title="Delete account"
                            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Active Sessions ────────────────────────────────────────────────────── */}
        {tab === "sessions" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground">
                  Currently Active — last 30 min
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">Based on app heartbeat activity</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={fetchStaff} disabled={loading}
                  className="gap-2 border-border text-xs">
                  <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />Refresh
                </Button>
                <Button size="sm" onClick={() => setLogoutAllConfirm(true)}
                  className="gap-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs">
                  <ShieldAlert className="h-3 w-3" />Logout All Users
                </Button>
              </div>
            </div>

            {onlineStaff.length === 0 ? (
              <div className="glass-card rounded-xl px-6 py-12 text-center">
                <Wifi className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">No active sessions detected.</p>
                <p className="text-xs text-muted-foreground mt-1">Staff who are actively using the app will appear here.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {onlineStaff.map(s => {
                  const isSelf = s.id === user?.id;
                  return (
                    <div key={s.id} className="glass-card rounded-xl px-4 py-3 flex items-center gap-3 fade-in-up">
                      <div className="relative shrink-0">
                        <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-sm font-black text-foreground border border-border">
                          {(s.name ?? s.email ?? "?").charAt(0).toUpperCase()}
                        </div>
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-success border-2 border-background animate-pulse" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-foreground">{s.name ?? "Unnamed"}</p>
                          {isSelf && <span className="text-[10px] text-primary font-bold">(You)</span>}
                          <RoleBadge role={s.role} />
                        </div>
                        <p className="text-xs text-muted-foreground">{s.email}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <div className="flex items-center gap-1 text-success">
                            <div className="w-1.5 h-1.5 rounded-full bg-success" />
                            <span className="text-[11px] font-semibold">Active {timeAgo(s.last_seen_at)}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground">Login: {timeAgo(s.last_sign_in_at)}</span>
                        </div>
                      </div>
                      {!isSelf && (
                        <Button variant="outline" size="sm"
                          onClick={() => handleForceLogout(s)}
                          disabled={actionLoading === s.id + "force_logout"}
                          className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground text-xs">
                          <LogOut className="h-3 w-3" />Force Logout
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Create Staff ───────────────────────────────────────────────────────── */}
        {tab === "create" && (
          <div className="max-w-xl mx-auto">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">
              {STAFF_ROLES.map(r => (
                <div key={r.value}
                  onClick={() => setCreateForm(f => ({ ...f, role: r.value }))}
                  className={cn(
                    "glass-card rounded-xl p-3 cursor-pointer border-2 transition-all select-none",
                    createForm.role === r.value ? "border-primary" : "border-transparent hover:border-primary/30"
                  )}>
                  <div className="w-2 h-2 rounded-full mb-2" style={{ backgroundColor: r.color }} />
                  <p className="text-xs font-bold text-foreground">{r.label}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{r.desc}</p>
                </div>
              ))}
            </div>

            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-primary/20 rounded-lg"><UserPlus className="h-5 w-5 text-primary" /></div>
                <div>
                  <h3 className="text-sm font-bold text-foreground">Create Staff Account</h3>
                  <p className="text-xs text-muted-foreground">Team members log in with email + password</p>
                </div>
              </div>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Full Name *</label>
                    <Input value={createForm.name} onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      placeholder="Jane Smith" required className="bg-secondary border-border focus:border-primary h-11" />
                  </div>
                  <div>
                    <label className="field-label">Phone</label>
                    <Input value={createForm.phone} onChange={e => setCreateForm(f => ({ ...f, phone: e.target.value }))}
                      placeholder="08XXXXXXXXX" type="tel" className="bg-secondary border-border focus:border-primary h-11" />
                  </div>
                </div>
                <div>
                  <label className="field-label">Email *</label>
                  <Input type="email" value={createForm.email} onChange={e => setCreateForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="jane@soulcomms.com" required className="bg-secondary border-border focus:border-primary h-11" />
                </div>
                <div>
                  <label className="field-label">Temporary Password *</label>
                  <div className="relative">
                    <Input type={showPassword ? "text" : "password"} value={createForm.password}
                      onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                      placeholder="Min 8 characters" minLength={8} required
                      className="bg-secondary border-border focus:border-primary h-11 pr-10" />
                    <button type="button" onClick={() => setShowPassword(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="field-label">Role *</label>
                    <select value={createForm.role}
                      onChange={e => setCreateForm(f => ({ ...f, role: e.target.value as StaffRoleValue }))}
                      required className="w-full h-11 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                      <option value="">Select role…</option>
                      {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">Assigned Event</label>
                    <select value={createForm.assigned_event_id}
                      onChange={e => setCreateForm(f => ({ ...f, assigned_event_id: e.target.value }))}
                      className="w-full h-11 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                      <option value="">All Events</option>
                      {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                    </select>
                  </div>
                </div>
                <Button type="submit"
                  disabled={creating || !createForm.name || !createForm.email || !createForm.password || !createForm.role}
                  className="w-full h-12 font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90">
                  {creating ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Creating…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2"><UserPlus className="h-4 w-4" />Create Account</span>
                  )}
                </Button>
              </form>
              {justCreated && (
                <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-success/10 border border-success/30">
                  <CheckCircle className="h-4 w-4 text-success shrink-0" />
                  <p className="text-sm text-foreground"><span className="font-semibold">{justCreated}</span> can now log in.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Audit Log ──────────────────────────────────────────────────────────── */}
        {tab === "audit" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground">Audit Trail</p>
                <p className="text-xs text-muted-foreground mt-0.5">Last 200 admin actions</p>
              </div>
              <Button variant="outline" size="sm" onClick={fetchAuditLogs} className="gap-2 border-border text-xs">
                <RefreshCw className="h-3 w-3" />Refresh
              </Button>
            </div>
            {auditLogs.length === 0 ? (
              <div className="glass-card rounded-xl px-6 py-12 text-center">
                <History className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">No audit logs yet.</p>
              </div>
            ) : auditLogs.map(log => {
              const meta = ACTION_LABELS[log.action] ?? { label: log.action, color: "text-muted-foreground" };
              return (
                <div key={log.id} className="glass-card rounded-xl px-4 py-3 flex items-center gap-3 fade-in-up">
                  <div className="p-2 rounded-lg bg-secondary shrink-0">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-semibold", meta.color)}>{meta.label}</p>
                    <p className="text-xs text-muted-foreground">
                      by <span className="text-foreground font-medium">{log.staff_name ?? "System"}</span>
                      {log.details?.email && ` · ${log.details.email}`}
                      {log.details?.target_name && ` · target: ${log.details.target_name}`}
                      {log.details?.count !== undefined && ` · ${log.details.count} users`}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-muted-foreground">{timeAgo(log.created_at)}</p>
                    <p className="text-[10px] text-muted-foreground">{formatDate(log.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Edit Modal ──────────────────────────────────────────────────────────── */}
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setEditTarget(null); }}>
          <div className="w-full max-w-md bg-card border border-primary/20 rounded-2xl shadow-2xl overflow-hidden slide-up">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <p className="text-sm font-black text-foreground">Edit — {editTarget.name ?? editTarget.email}</p>
              <button onClick={() => setEditTarget(null)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Full Name</label>
                  <Input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                    className="bg-secondary border-border focus:border-primary" />
                </div>
                <div>
                  <label className="field-label">Phone</label>
                  <Input value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))}
                    className="bg-secondary border-border focus:border-primary" />
                </div>
              </div>
              <div>
                <label className="field-label">Email</label>
                <Input type="email" value={editForm.email} onChange={e => setEditForm(f => ({ ...f, email: e.target.value }))}
                  className="bg-secondary border-border focus:border-primary" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Role</label>
                  <select value={editForm.role} onChange={e => setEditForm(f => ({ ...f, role: e.target.value as StaffRoleValue }))}
                    className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                    {STAFF_ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Status</label>
                  <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value as typeof editForm.status }))}
                    className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                    <option value="active">Active</option>
                    <option value="disabled">Disabled</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Assigned Event</label>
                <select value={editForm.assigned_event_id}
                  onChange={e => setEditForm(f => ({ ...f, assigned_event_id: e.target.value }))}
                  className="w-full h-10 px-3 rounded-lg bg-secondary border border-border text-sm text-foreground focus:outline-none focus:border-primary">
                  <option value="">All Events</option>
                  {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setEditTarget(null)} className="flex-1 border-border">Cancel</Button>
                <Button onClick={handleSaveEdit} disabled={actionLoading === "edit"}
                  className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">
                  {actionLoading === "edit" ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Delete Confirm ──────────────────────────────────────────────────────── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-destructive/30 rounded-2xl p-6 space-y-4 slide-up">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-destructive/15"><AlertTriangle className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="text-sm font-black text-foreground">Delete Staff Account</p>
                <p className="text-xs text-muted-foreground">This cannot be undone.</p>
              </div>
            </div>
            <p className="text-sm text-foreground">
              Permanently delete <strong>"{deleteTarget.name ?? deleteTarget.email}"</strong>? They will lose all access immediately.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} className="flex-1 border-border">Cancel</Button>
              <Button onClick={() => handleDelete(deleteTarget)}
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2">
                <Trash2 className="h-4 w-4" />Delete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Logout All Confirm ──────────────────────────────────────────────────── */}
      {logoutAllConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-destructive/30 rounded-2xl p-6 space-y-4 slide-up">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-full bg-destructive/15"><ShieldAlert className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="text-sm font-black text-foreground">Logout All Users</p>
                <p className="text-xs text-muted-foreground">Emergency security action.</p>
              </div>
            </div>
            <p className="text-sm text-foreground">
              This will immediately terminate all active sessions for every staff member except you. Use only in a security emergency.
            </p>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setLogoutAllConfirm(false)} className="flex-1 border-border">Cancel</Button>
              <Button onClick={handleLogoutAll} disabled={actionLoading === "logout_all"}
                className="flex-1 bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2">
                {actionLoading === "logout_all" ? "Logging out…" : <><ShieldAlert className="h-4 w-4" />Logout All</>}
              </Button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
