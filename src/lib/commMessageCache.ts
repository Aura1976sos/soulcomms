/**
 * commMessageCache.ts
 * IndexedDB cache for received messages, channel list, and staff directory.
 * Enables offline-first reading in the Communications module.
 */
import { openDB } from "idb";
import type { CommMessage } from "@/hooks/useChannelMessages";
import type { Channel }     from "@/components/communications/ChannelList";
import type { StaffMember } from "@/components/communications/StaffDirectory";

const DB_NAME    = "sc_comm_cache";
const DB_VERSION = 1;

async function getDB() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("messages")) {
        const ms = db.createObjectStore("messages", { keyPath: "id" });
        ms.createIndex("by_channel", "channel_id", { unique: false });
      }
      if (!db.objectStoreNames.contains("channels")) {
        db.createObjectStore("channels", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("staff")) {
        db.createObjectStore("staff", { keyPath: "id" });
      }
    },
  });
}

// ─── Messages ────────────────────────────────────────────────────────────────

export async function cacheMessages(msgs: CommMessage[]): Promise<void> {
  if (!msgs.length) return;
  const db = await getDB();
  const tx = db.transaction("messages", "readwrite");
  for (const m of msgs) await tx.store.put(m);
  await tx.done;
}

export async function getCachedMessages(channelId: string): Promise<CommMessage[]> {
  const db  = await getDB();
  const all = await db.getAllFromIndex("messages", "by_channel", channelId);
  return (all as CommMessage[]).sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

/** Keep only the most recent `keep` messages per channel to prevent IDB bloat */
export async function pruneMessages(channelId: string, keep = 200): Promise<void> {
  const db   = await getDB();
  const all  = await db.getAllFromIndex("messages", "by_channel", channelId) as CommMessage[];
  if (all.length <= keep) return;
  const sorted  = all.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const toDelete = sorted.slice(0, sorted.length - keep);
  const tx = db.transaction("messages", "readwrite");
  for (const m of toDelete) await tx.store.delete(m.id);
  await tx.done;
}

// ─── Channels ────────────────────────────────────────────────────────────────

export async function cacheChannels(channels: Channel[]): Promise<void> {
  if (!channels.length) return;
  const db = await getDB();
  const tx = db.transaction("channels", "readwrite");
  await tx.store.clear();
  for (const c of channels) await tx.store.put(c);
  await tx.done;
}

export async function getCachedChannels(): Promise<Channel[]> {
  const db = await getDB();
  return (await db.getAll("channels")) as Channel[];
}

// ─── Staff ───────────────────────────────────────────────────────────────────

export async function cacheStaff(staff: StaffMember[]): Promise<void> {
  if (!staff.length) return;
  const db = await getDB();
  const tx = db.transaction("staff", "readwrite");
  await tx.store.clear();
  for (const s of staff) await tx.store.put(s);
  await tx.done;
}

export async function getCachedStaff(): Promise<StaffMember[]> {
  const db = await getDB();
  return (await db.getAll("staff")) as StaffMember[];
}
