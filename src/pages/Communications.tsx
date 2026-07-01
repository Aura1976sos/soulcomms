import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEvent } from "@/contexts/EventContext";
import { useGuest } from "@/contexts/GuestContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useCommunications } from "@/contexts/CommunicationsContext";
import { useChannelMessages } from "@/hooks/useChannelMessages";
import { ChannelList, type Channel } from "@/components/communications/ChannelList";
import { MessageThread } from "@/components/communications/MessageThread";
import { MessageInput } from "@/components/communications/MessageInput";
import { StaffDirectory, type StaffMember } from "@/components/communications/StaffDirectory";
import { CreateChannelModal } from "@/components/communications/CreateChannelModal";
import { ManageChannelModal } from "@/components/communications/ManageChannelModal";
import { Hash, MessageSquare, Users, MessageCircle, Plus, Settings, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { getRoleDef } from "@/lib/staffRoles";
import {
  cacheChannels, getCachedChannels,
  cacheStaff, getCachedStaff,
} from "@/lib/commMessageCache";

type LeftTab = "channels" | "dms" | "directory";

interface RawChannel {
  id: string;
  name: string | null;
  slug: string | null;
  type: "dm" | "group";
  allowed_roles: string[] | null;
  description: string | null;
  is_archived: boolean | null;
  created_by: string | null;
}

interface SelectedChannelMeta {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  createdBy: string | null;
  type: "dm" | "group";
}

export default function Communications() {
  const { user, profile, role } = useAuth();
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { online } = useNetwork();
  const { markChannelRead, refreshUnread } = useCommunications();
  const [searchParams] = useSearchParams();

  const [leftTab, setLeftTab] = useState<LeftTab>("channels");
  const [groupChannels, setGroupChannels] = useState<Channel[]>([]);
  const [dmChannels, setDmChannels] = useState<Channel[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedChannelName, setSelectedChannelName] = useState("");
  const [selectedChannelMeta, setSelectedChannelMeta] = useState<SelectedChannelMeta | null>(null);
  const [canBroadcast, setCanBroadcast] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showManageChannel, setShowManageChannel] = useState(false);

  const canAdmin = role === "admin" || role === "event_admin";
  const currentEventId = isGuestMode ? guestSession?.eventId : activeEvent?.id;

  // URL params
  const escalateType = searchParams.get("escalate");
  const escalateCode = searchParams.get("code");
  const escalateError = searchParams.get("error");
  const escalateParticipant = searchParams.get("participant");
  const escalateActivity = searchParams.get("activity");
  const dmTarget = searchParams.get("dm");
  const startDmStaffId = searchParams.get("startDm");

  const prefillMsg = escalateType
    ? escalateType === "checkin"
      ? `@EventAdmin ${profile?.name ?? "Officer"} needs assistance at Check-In. Participant code: ${escalateCode ?? "—"}. Error: ${escalateError ?? "Unknown issue"}. Please advise.`
      : `@EventAdmin ${profile?.name ?? "Officer"} is escalating an issue at Activity Recorder. Participant: ${escalateParticipant ?? "—"}. Activity: ${escalateActivity ?? "—"}. Error: ${escalateError ?? "Unknown issue"}.`
    : undefined;

  const prefillMeta = escalateType
    ? escalateType === "checkin"
      ? { participant_code: escalateCode ?? "", error: escalateError ?? "", officer: profile?.name ?? "" }
      : { participant: escalateParticipant ?? "", activity: escalateActivity ?? "", error: escalateError ?? "", officer: profile?.name ?? "" }
    : undefined;

  const { messages, loading, hasMore, sendMessage, loadMore } = useChannelMessages(selectedChannelId);

  // Heartbeat: update last_seen_at every 60s
  useEffect(() => {
    if (!user?.id) return;
    const update = () => supabase.from("staff_profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", user.id);
    update();
    const interval = setInterval(update, 60_000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const init = useCallback(async () => {
    if (!currentEventId || !user?.id || initialized) return;
    await supabase.rpc("ensure_event_channels", { p_event_id: currentEventId });
    setInitialized(true);
    await loadChannels();
  }, [currentEventId, user?.id, initialized]); // eslint-disable-line

  const loadChannels = useCallback(async () => {
    if (!user?.id) return;

    // ── Offline: serve from cache immediately ─────────────────────────────
    if (!navigator.onLine) {
      try {
        const cached = await getCachedChannels();
        if (cached.length) {
          setGroupChannels(cached.filter(c => c.type === "group"));
          setDmChannels(cached.filter(c => c.type === "dm"));
        }
      } catch { /* IDB unavailable */ }
      return;
    }

    try {
      const { data: memberships } = await supabase
        .from("comm_channel_members")
        .select("channel_id, last_read_at")
        .eq("staff_id", user.id);
      if (!memberships) return;

      const channelIds = memberships.map(m => m.channel_id);
      const readMap: Record<string, string> = {};
      memberships.forEach(m => { readMap[m.channel_id] = m.last_read_at ?? ""; });

      if (!channelIds.length) return;

      const { data: channels } = await supabase
        .from("comm_channels")
        .select("id, name, slug, type, allowed_roles, description, is_archived, created_by")
        .in("id", channelIds)
        .eq("is_archived", false);
      if (!channels) return;

      const withMeta = await Promise.all(
        (channels as RawChannel[]).map(async ch => {
          const [{ count: unread }, { data: last }] = await Promise.all([
            supabase.from("comm_messages")
              .select("id", { count: "exact", head: true })
              .eq("channel_id", ch.id)
              .eq("is_deleted", false)
              .neq("sender_id", user.id)
              .gt("created_at", readMap[ch.id] ?? "1970-01-01"),
            supabase.from("comm_messages")
              .select("content, created_at, sender_name")
              .eq("channel_id", ch.id)
              .order("created_at", { ascending: false })
              .limit(1),
          ]);

          let dmPeerName: string | undefined;
          let dmPeerRole: string | undefined;
          let dmPeerStaffId: string | undefined;
          if (ch.type === "dm") {
            const { data: members } = await supabase
              .from("comm_channel_members")
              .select("staff_id, staff_profiles(name, role)")
              .eq("channel_id", ch.id)
              .neq("staff_id", user.id)
              .limit(1);
            const peer = members?.[0]?.staff_profiles as { name?: string; role?: string } | null;
            dmPeerName = peer?.name ?? "Direct Message";
            dmPeerRole = peer?.role ? getRoleDef(peer.role)?.label : undefined;
            dmPeerStaffId = members?.[0]?.staff_id;
          }

          return {
            id: ch.id,
            name: ch.name,
            slug: ch.slug,
            type: ch.type,
            description: ch.description,
            createdBy: ch.created_by,
            unread: unread ?? 0,
            lastMessage: last?.[0]?.content,
            lastAt: last?.[0]?.created_at,
            dmPeerName,
            dmPeerRole,
            dmPeerStaffId,
          } as Channel;
        })
      );

      const grouped = withMeta.filter(c => c.type === "group").sort((a, b) => {
        const slugOrder = ["event_ops", "checkin_team", "activity_team", "leadership"];
        return (slugOrder.indexOf(a.slug ?? "")) - (slugOrder.indexOf(b.slug ?? ""));
      });
      const dms = withMeta.filter(c => c.type === "dm").sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));

      setGroupChannels(grouped);
      setDmChannels(dms);

      // Persist to cache for offline access
      try { await cacheChannels([...grouped, ...dms]); } catch { /* non-fatal */ }
    } catch {
      // Network failed — fall back to cache
      try {
        const cached = await getCachedChannels();
        if (cached.length) {
          setGroupChannels(cached.filter(c => c.type === "group"));
          setDmChannels(cached.filter(c => c.type === "dm"));
        }
      } catch { /* IDB unavailable */ }
    }
  }, [user?.id]);

  const loadStaff = useCallback(async () => {
    if (!navigator.onLine) {
      try {
        const cached = await getCachedStaff();
        if (cached.length) setStaff(cached);
      } catch { /* non-fatal */ }
      return;
    }
    try {
      const { data } = await supabase
        .from("staff_profiles")
        .select("id, name, role, last_seen_at")
        .order("name");
      const fresh = (data ?? []) as StaffMember[];
      setStaff(fresh);
      try { await cacheStaff(fresh); } catch { /* non-fatal */ }
    } catch {
      try {
        const cached = await getCachedStaff();
        if (cached.length) setStaff(cached);
      } catch { /* non-fatal */ }
    }
  }, []);

  useEffect(() => { init(); }, [init]);
  useEffect(() => { loadStaff(); }, [loadStaff]);

  // Auto-select from URL params
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current) return;

    if (startDmStaffId && staff.length > 0) {
      handleStartDm(startDmStaffId);
      autoSelectedRef.current = true;
    } else if (dmTarget === "admin" && staff.length > 0) {
      const admin = staff.find(s => s.role === "admin" || s.role === "event_admin");
      if (admin) handleStartDm(admin.id);
      autoSelectedRef.current = true;
    } else if (escalateType && groupChannels.length > 0) {
      const opsChannel = groupChannels.find(c => c.slug === "event_ops");
      if (opsChannel) selectChannel(opsChannel);
      autoSelectedRef.current = true;
    }
  }, [groupChannels, staff, startDmStaffId, dmTarget, escalateType]); // eslint-disable-line

  const selectChannel = (ch: Channel) => {
    const displayName = ch.type === "dm" ? (ch.dmPeerName ?? "Direct Message") : (ch.name ?? "Channel");
    setSelectedChannelId(ch.id);
    setSelectedChannelName(displayName);
    setSelectedChannelMeta({
      id: ch.id,
      name: ch.name ?? "Channel",
      slug: ch.slug ?? null,
      description: (ch as Channel & { description?: string | null }).description ?? null,
      createdBy: (ch as Channel & { createdBy?: string | null }).createdBy ?? null,
      type: ch.type,
    });
    setCanBroadcast(canAdmin && ch.type !== "dm");
    markChannelRead(ch.id);
    refreshUnread();
    setGroupChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unread: 0 } : c));
    setDmChannels(prev => prev.map(c => c.id === ch.id ? { ...c, unread: 0 } : c));
  };

  const handleStartDm = async (staffId: string) => {
    const { data } = await supabase.rpc("get_or_create_dm", { p_other_staff_id: staffId });
    if (!data) return;
    await loadChannels();
    const peer = staff.find(s => s.id === staffId);
    const peerRole = peer?.role ? getRoleDef(peer.role)?.label : undefined;
    const dmCh: Channel = {
      id: data, name: null, slug: null, type: "dm", unread: 0,
      dmPeerName: peer?.name, dmPeerRole: peerRole,
      dmPeerStaffId: staffId,
    };
    selectChannel(dmCh);
    setLeftTab("dms");
  };

  // Build DM unread map for Directory/DMs tab
  const dmUnreadMap: Record<string, number> = {};
  dmChannels.forEach(dm => {
    if (dm.dmPeerStaffId && dm.unread > 0) dmUnreadMap[dm.dmPeerStaffId] = dm.unread;
  });

  const canManageChannel =
    selectedChannelMeta?.type === "group" &&
    (canAdmin || selectedChannelMeta?.createdBy === user?.id);

  return (
    <AppLayout title="Communications" subtitle="Staff messaging & escalation hub">
      <div className="flex h-[calc(100vh-120px)] gap-0 rounded-2xl overflow-hidden border border-border bg-card">

        {/* ── Left Panel ─────────────────────────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col border-r border-border">
          {/* Offline pill */}
          {!online && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20">
              <WifiOff className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="text-[10px] text-amber-500 font-semibold">Offline Mode Active</span>
            </div>
          )}
          <div className="flex border-b border-border">
            {([
              { key: "channels", label: "Channels", icon: Hash },
              { key: "dms", label: "DMs", icon: MessageCircle },
              { key: "directory", label: "Directory", icon: Users },
            ] as { key: LeftTab; label: string; icon: typeof Hash }[]).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setLeftTab(key)}
                className={cn(
                  "flex-1 flex flex-col items-center gap-0.5 py-3 text-[10px] font-bold uppercase tracking-wider transition-colors border-b-2",
                  leftTab === key
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Tab header actions */}
          {leftTab === "channels" && canAdmin && (
            <button
              onClick={() => setShowCreateChannel(true)}
              className="flex items-center gap-2 px-3 py-2.5 text-xs font-semibold text-primary hover:bg-secondary/80 transition-colors border-b border-border"
            >
              <Plus className="h-3.5 w-3.5" />
              Create Channel
            </button>
          )}
          {leftTab === "dms" && (
            <div className="px-3 py-2 border-b border-border">
              <p className="text-[10px] text-muted-foreground font-medium">Click any staff member to message them</p>
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-2">
            {leftTab === "directory" ? (
              <StaffDirectory
                staff={staff}
                myId={user?.id ?? ""}
                dmUnreadMap={dmUnreadMap}
                onStartDm={handleStartDm}
              />
            ) : leftTab === "dms" ? (
              /* DMs tab: show full staff directory — clicking opens DM */
              <StaffDirectory
                staff={staff}
                myId={user?.id ?? ""}
                dmUnreadMap={dmUnreadMap}
                onStartDm={handleStartDm}
                showMessageButton
              />
            ) : (
              <ChannelList
                channels={groupChannels}
                selectedId={selectedChannelId}
                onSelect={id => {
                  const ch = groupChannels.find(c => c.id === id);
                  if (ch) selectChannel(ch);
                }}
              />
            )}
          </div>
        </div>

        {/* ── Right Panel ────────────────────────────────────────────────────── */}
        {selectedChannelId && profile && user ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Offline banner */}
            {!online && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-500 shrink-0">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                <p className="text-[11px] font-semibold">Offline Mode — messages are queued and will sync automatically when you reconnect.</p>
              </div>
            )}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
              {selectedChannelMeta?.type === "dm" ? (
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
              ) : (
                <Hash className="h-4 w-4 text-muted-foreground" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">{selectedChannelName}</p>
                {selectedChannelMeta?.description && (
                  <p className="text-[10px] text-muted-foreground truncate">{selectedChannelMeta.description}</p>
                )}
                {!selectedChannelMeta?.description && (
                  <p className="text-[10px] text-muted-foreground">{messages.length} messages loaded</p>
                )}
              </div>
              {/* Channel manage button */}
              {canManageChannel && (
                <button
                  onClick={() => setShowManageChannel(true)}
                  className="p-1.5 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
                  title="Manage channel"
                >
                  <Settings className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Messages */}
            <MessageThread
              messages={messages}
              loading={loading}
              hasMore={hasMore}
              myId={user.id}
              onLoadMore={loadMore}
            />

            {/* Input */}
            <MessageInput
              channelId={selectedChannelId}
              channelName={selectedChannelName}
              myId={user.id}
              myName={profile.name}
              myRole={profile.role}
              canBroadcast={canBroadcast}
              staff={staff}
              onSend={sendMessage}
              prefill={prefillMsg}
              prefillType={escalateType ? "escalation" : undefined}
              prefillMeta={prefillMeta}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {!online && (
              <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-500 shrink-0">
                <WifiOff className="h-3.5 w-3.5 shrink-0" />
                <p className="text-[11px] font-semibold">Offline Mode — messages will sync automatically when you reconnect.</p>
              </div>
            )}
            <div className="flex-1 flex flex-col items-center justify-center text-center p-12">
              <div className="p-4 rounded-2xl bg-secondary mb-4">
                <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
              </div>
              <p className="text-base font-bold text-foreground mb-1">Select a channel or staff member</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Choose a group channel from Channels tab, or click any staff member in the DMs or Directory tab to start a conversation.
              </p>
              {canAdmin && (
                <button
                  onClick={() => { setLeftTab("channels"); setShowCreateChannel(true); }}
                  className="mt-4 flex items-center gap-2 text-xs text-primary font-semibold hover:underline"
                >
                  <Plus className="h-3.5 w-3.5" /> Create your first channel
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {showCreateChannel && currentEventId && user && (
        <CreateChannelModal
          eventId={currentEventId}
          creatorId={user.id}
          onClose={() => setShowCreateChannel(false)}
          onCreated={async () => {
            setShowCreateChannel(false);
            await loadChannels();
          }}
        />
      )}

      {showManageChannel && selectedChannelMeta && user && (
        <ManageChannelModal
          channelId={selectedChannelMeta.id}
          channelName={selectedChannelMeta.name}
          channelDescription={selectedChannelMeta.description}
          createdBy={selectedChannelMeta.createdBy}
          myId={user.id}
          isAdmin={canAdmin}
          onClose={() => setShowManageChannel(false)}
          onUpdated={async () => {
            setShowManageChannel(false);
            await loadChannels();
          }}
          onDeleted={() => {
            setShowManageChannel(false);
            setSelectedChannelId(null);
            setSelectedChannelMeta(null);
            loadChannels();
          }}
        />
      )}
    </AppLayout>
  );
}
