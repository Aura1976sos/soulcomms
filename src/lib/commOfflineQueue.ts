import { openDB } from "idb";
import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "sc_comm_offline";
const STORE   = "pending_messages";

interface OfflineMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  type: string;
  mentions: string[];
  metadata?: Record<string, string>;
  createdAt: string;
}

async function getDB() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    },
  });
}

export async function queueOfflineMessage(msg: OfflineMessage): Promise<void> {
  const db = await getDB();
  await db.put(STORE, msg);
}

export async function getPendingMessages(): Promise<OfflineMessage[]> {
  const db = await getDB();
  return db.getAll(STORE);
}

export async function deleteOfflineMessage(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

export async function flushOfflineMessages(): Promise<{ sent: number; failed: number }> {
  const pending = await getPendingMessages();
  let sent = 0;
  let failed = 0;

  for (const msg of pending) {
    const { error } = await supabase.from("comm_messages").insert({
      id:          msg.id,
      channel_id:  msg.channelId,
      sender_id:   msg.senderId,
      sender_name: msg.senderName,
      sender_role: msg.senderRole,
      content:     msg.content,
      type:        msg.type,
      mentions:    msg.mentions,
      metadata:    msg.metadata ?? null,
      created_at:  msg.createdAt,
    });

    if (error) {
      failed++;
    } else {
      await deleteOfflineMessage(msg.id);
      sent++;
    }
  }

  return { sent, failed };
}
