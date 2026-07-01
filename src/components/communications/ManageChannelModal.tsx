import { useState, useEffect, useCallback } from "react";
import { X, Settings, Trash2, Archive, UserPlus, UserMinus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { getRoleDef } from "@/lib/staffRoles";
import { cn } from "@/lib/utils";

interface ChannelMember {
  staff_id: string;
  name: string;
  role: string;
}

interface ManageChannelModalProps {
  channelId: string;
  channelName: string;
  channelDescription: string | null;
  createdBy: string | null;
  myId: string;
  isAdmin: boolean;       // admin or event_admin
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
}

export function ManageChannelModal({
  channelId, channelName, channelDescription, createdBy,
  myId, isAdmin, onClose, onUpdated, onDeleted,
}: ManageChannelModalProps) {
  const [name, setName]               = useState(channelName);
  const [description, setDescription] = useState(channelDescription ?? "");
  const [members, setMembers]         = useState<ChannelMember[]>([]);
  const [allStaff, setAllStaff]       = useState<ChannelMember[]>([]);
  const [showAddMember, setShowAddMember] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [archiving, setArchiving]     = useState(false);
  const [deleting, setDeleting]       = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab]                 = useState<"info" | "members">("info");

  const loadMembers = useCallback(async () => {
    const { data } = await supabase
      .from("comm_channel_members")
      .select("staff_id, staff_profiles(name, role)")
      .eq("channel_id", channelId);

    setMembers(
      (data ?? []).map(m => ({
        staff_id: m.staff_id,
        name: (m.staff_profiles as { name?: string; role?: string } | null)?.name ?? "Unknown",
        role: (m.staff_profiles as { name?: string; role?: string } | null)?.role ?? "",
      }))
    );
  }, [channelId]);

  const loadAllStaff = useCallback(async () => {
    const { data } = await supabase
      .from("staff_profiles")
      .select("id, name, role")
      .order("name");
    setAllStaff((data ?? []).map(s => ({ staff_id: s.id, name: s.name, role: s.role })));
  }, []);

  useEffect(() => {
    loadMembers();
    loadAllStaff();
  }, [loadMembers, loadAllStaff]);

  const handleSaveInfo = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await supabase
      .from("comm_channels")
      .update({ name: name.trim(), description: description.trim() || null })
      .eq("id", channelId);
    setSaving(false);
    onUpdated();
  };

  const handleRemoveMember = async (staffId: string) => {
    await supabase
      .from("comm_channel_members")
      .delete()
      .eq("channel_id", channelId)
      .eq("staff_id", staffId);
    await loadMembers();
  };

  const handleAddMember = async (staffId: string) => {
    const { data: existing } = await supabase
      .from("comm_channel_members")
      .select("staff_id")
      .eq("channel_id", channelId)
      .eq("staff_id", staffId)
      .maybeSingle();
    if (!existing) {
      await supabase.from("comm_channel_members").insert({ channel_id: channelId, staff_id: staffId });
    }
    await loadMembers();
  };

  const handleArchive = async () => {
    setArchiving(true);
    await supabase.from("comm_channels").update({ is_archived: true }).eq("id", channelId);
    setArchiving(false);
    onDeleted();
  };

  const handleDelete = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return; }
    setDeleting(true);
    await supabase.from("comm_channels").delete().eq("id", channelId);
    setDeleting(false);
    onDeleted();
  };

  const nonMembers = allStaff.filter(s => !members.find(m => m.staff_id === s.staff_id));
  const canEdit = isAdmin || myId === createdBy;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-secondary">
              <Settings className="h-4 w-4 text-foreground" />
            </div>
            <h2 className="text-sm font-bold text-foreground">Manage Channel</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border shrink-0">
          {(["info", "members"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex-1 py-2.5 text-xs font-bold uppercase tracking-wider transition-colors border-b-2",
                tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "info" ? "Channel Info" : `Members (${members.length})`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {tab === "info" && (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Channel Name</label>
                <Input value={name} onChange={e => setName(e.target.value)} disabled={!canEdit} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={!canEdit}
                  rows={2}
                  className="w-full resize-none bg-secondary border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors disabled:opacity-60"
                />
              </div>
              {canEdit && (
                <Button onClick={handleSaveInfo} disabled={saving || !name.trim()} className="w-full">
                  {saving ? "Saving…" : "Save Changes"}
                </Button>
              )}

              {/* Danger Zone */}
              <div className="pt-4 border-t border-border space-y-2">
                <p className="text-xs font-bold text-destructive uppercase tracking-wider">Danger Zone</p>
                <Button
                  variant="outline"
                  onClick={handleArchive}
                  disabled={archiving}
                  className="w-full gap-2 border-amber-400/30 text-amber-500 hover:bg-amber-400/10 hover:border-amber-400"
                >
                  <Archive className="h-4 w-4" />
                  {archiving ? "Archiving…" : "Archive Channel"}
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="w-full gap-2 border-destructive/30 text-destructive hover:bg-destructive/10 hover:border-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                    {confirmDelete ? (deleting ? "Deleting…" : "Confirm Delete?") : "Delete Channel"}
                  </Button>
                )}
              </div>
            </>
          )}

          {tab === "members" && (
            <>
              {/* Existing members */}
              <div className="space-y-1">
                {members.map(m => {
                  const roleDef = getRoleDef(m.role);
                  const isCreator = m.staff_id === createdBy;
                  return (
                    <div key={m.staff_id} className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary group">
                      <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                        {m.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{m.name}</p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {roleDef?.label ?? m.role} {isCreator && "· Owner"}
                        </p>
                      </div>
                      {canEdit && !isCreator && m.staff_id !== myId && (
                        <button
                          onClick={() => handleRemoveMember(m.staff_id)}
                          className="shrink-0 opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-destructive/10 text-destructive transition-all"
                        >
                          <UserMinus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Add members */}
              {canEdit && (
                <div className="pt-3 border-t border-border">
                  <button
                    onClick={() => setShowAddMember(v => !v)}
                    className="flex items-center gap-2 text-xs text-primary font-semibold hover:underline"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    Add Members
                  </button>
                  {showAddMember && nonMembers.length > 0 && (
                    <div className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                      {nonMembers.map(s => {
                        const roleDef = getRoleDef(s.role);
                        return (
                          <button
                            key={s.staff_id}
                            onClick={() => handleAddMember(s.staff_id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-secondary text-left group transition-colors"
                          >
                            <div className="w-6 h-6 rounded-full bg-secondary border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground shrink-0">
                              {s.name.charAt(0)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-semibold text-foreground truncate">{s.name}</p>
                              <p className="text-[10px] text-muted-foreground">{roleDef?.label ?? s.role}</p>
                            </div>
                            <Check className="h-3.5 w-3.5 text-primary opacity-0 group-hover:opacity-100" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {showAddMember && nonMembers.length === 0 && (
                    <p className="text-xs text-muted-foreground mt-2">All staff are already members.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3 border-t border-border bg-secondary/30">
          <Button variant="outline" onClick={onClose} className="w-full border-border">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
