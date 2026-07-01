import { useState } from "react";
import { X, Hash, Lock, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { STAFF_ROLES } from "@/lib/staffRoles";
import { cn } from "@/lib/utils";

interface CreateChannelModalProps {
  eventId: string;
  creatorId: string;
  onClose: () => void;
  onCreated: () => void;
}

type Visibility = "public" | "private";

export function CreateChannelModal({ eventId, creatorId, onClose, onCreated }: CreateChannelModalProps) {
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility]   = useState<Visibility>("public");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError("Channel name is required."); return; }
    setSaving(true);
    setError("");

    const slug = name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    const allowed_roles = visibility === "public" ? null : selectedRoles.length ? selectedRoles : null;

    // Insert channel
    const { data: channel, error: chErr } = await supabase
      .from("comm_channels")
      .insert({
        event_id:      eventId,
        type:          "group",
        name:          name.trim(),
        slug,
        description:   description.trim() || null,
        allowed_roles,
        created_by:    creatorId,
      })
      .select("id")
      .single();

    if (chErr || !channel) {
      setError(chErr?.message ?? "Failed to create channel.");
      setSaving(false);
      return;
    }

    // Add creator as member
    await supabase.from("comm_channel_members").insert({ channel_id: channel.id, staff_id: creatorId });

    // If private: add all staff who match the selected roles
    if (visibility === "private" && selectedRoles.length > 0) {
      const { data: eligible } = await supabase
        .from("staff_profiles")
        .select("id")
        .in("role", selectedRoles)
        .neq("id", creatorId);

      if (eligible?.length) {
        await supabase.from("comm_channel_members").insert(
          eligible.map(s => ({ channel_id: channel.id, staff_id: s.id }))
        );
      }
    }

    setSaving(false);
    onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-card border border-border rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Plus className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-sm font-bold text-foreground">Create Channel</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-secondary transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">Channel Name <span className="text-destructive">*</span></label>
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Event Operations"
                className="pl-8"
                autoFocus
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-foreground">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What is this channel for?"
              rows={2}
              className="w-full resize-none bg-secondary border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Visibility */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-foreground">Visibility</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { key: "public",  label: "Public",  desc: "All staff can join", icon: Hash },
                { key: "private", label: "Private", desc: "Selected roles only", icon: Lock },
              ] as { key: Visibility; label: string; desc: string; icon: typeof Hash }[]).map(({ key, label, desc, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setVisibility(key)}
                  className={cn(
                    "flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors",
                    visibility === key
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/30 hover:bg-secondary"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn("h-3.5 w-3.5", visibility === key ? "text-primary" : "text-muted-foreground")} />
                    <span className={cn("text-xs font-bold", visibility === key ? "text-primary" : "text-foreground")}>{label}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Role selection (private only) */}
          {visibility === "private" && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-foreground">Who can access this channel?</label>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {STAFF_ROLES.map(r => (
                  <label key={r.value} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-secondary cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={selectedRoles.includes(r.value)}
                      onChange={() => toggleRole(r.value)}
                      className="accent-primary w-3.5 h-3.5 rounded"
                    />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{r.label}</p>
                      <p className="text-[10px] text-muted-foreground">{r.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive font-medium">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex gap-2 px-6 py-4 border-t border-border bg-secondary/30">
          <Button variant="outline" onClick={onClose} className="flex-1 border-border">
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim()} className="flex-1">
            {saving ? "Creating…" : "Create Channel"}
          </Button>
        </div>
      </div>
    </div>
  );
}
