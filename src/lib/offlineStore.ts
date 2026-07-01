import { openDB, IDBPDatabase } from "idb";
import { supabase } from "@/integrations/supabase/client";

const DB_NAME = "soulcomms_offline";
const DB_VERSION = 4; // v4: added activities + activity_sessions stores

// ─── Types ───────────────────────────────────────────────────────────────────
export interface CachedParticipant {
  id: string; code: string; name: string; phone: string | null;
  qr_link: string | null; is_checked_in: boolean; event_id: string;
}
export interface CachedServiceProvider {
  id: string; code: string; brand_name: string; contact_person: string | null;
  phone: string | null; qr_link: string | null; is_checked_in: boolean; event_id: string;
}
export interface CachedCrewMember {
  id: string; code: string; name: string; department: string | null;
  phone: string | null; qr_link: string | null; is_checked_in: boolean; event_id: string;
}
export interface CachedActivity {
  id: string; event_id: string; parent_id: string | null;
  name: string; code: string; description: string | null; category: string | null;
  points_value: number; status: string; icon_name: string | null; color: string | null;
  sort_order: number; is_single_session: boolean | null; manual_count: number | null;
  created_at: string;
}
export interface CachedActivitySession {
  id: string; event_id: string; activity_id: string;
  session_name: string | null; session_code: string | null;
  start_time: string | null; end_time: string | null;
  max_capacity: number | null; status: string; created_at: string;
}

export interface WalkInRecord {
  id: string;
  temp_code: string;
  name: string;
  phone: string | null;
  event_id: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  check_in_method: string | null;
  created_at: string;
  synced: boolean;
  source: "Walk-In" | "QR Registration";
  qr_link?: string | null;
}

export interface WalkInCrewRecord {
  id: string;
  temp_code: string;
  name: string;
  team_name: string;
  phone: string | null;
  event_id: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  check_in_method: string | null;
  created_at: string;
  synced: boolean;
}

export interface WalkInSPRecord {
  id: string;
  temp_code: string;
  brand_name: string;
  contact_person: string | null;
  phone: string | null;
  event_id: string;
  is_checked_in: boolean;
  checked_in_at: string | null;
  check_in_method: string | null;
  created_at: string;
  synced: boolean;
}

export type MutationType =
  | "register_walkin"
  | "register_walkin_crew"
  | "register_walkin_sp"
  | "register_qr"
  | "checkin_participant"
  | "checkin_sp"
  | "checkin_crew"
  | "activity_log"
  | "session_participation";

export interface SyncMutation {
  id: string;
  type: MutationType;
  payload: Record<string, unknown>;
  created_at: string;
  retries: number;
  error_message?: string;
  last_error_at?: string;
}

export interface QueueStats {
  total: number;
  walkIns: number;
  checkIns: number;
  activities: number;
}

// ─── DB Init ─────────────────────────────────────────────────────────────────
let db: IDBPDatabase | null = null;

async function getDb() {
  if (db) return db;
  db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(d, oldVersion) {
      if (!d.objectStoreNames.contains("participants"))
        d.createObjectStore("participants", { keyPath: "id" });
      if (!d.objectStoreNames.contains("service_providers"))
        d.createObjectStore("service_providers", { keyPath: "id" });
      if (!d.objectStoreNames.contains("crew_members"))
        d.createObjectStore("crew_members", { keyPath: "id" });
      if (!d.objectStoreNames.contains("sync_queue"))
        d.createObjectStore("sync_queue", { keyPath: "id" });
      if (!d.objectStoreNames.contains("walk_ins"))
        d.createObjectStore("walk_ins", { keyPath: "id" });
      if (!d.objectStoreNames.contains("walk_ins_crew"))
        d.createObjectStore("walk_ins_crew", { keyPath: "id" });
      if (!d.objectStoreNames.contains("walk_ins_sp"))
        d.createObjectStore("walk_ins_sp", { keyPath: "id" });
      // v4 – activities + sessions
      if (oldVersion < 4) {
        if (!d.objectStoreNames.contains("activities"))
          d.createObjectStore("activities", { keyPath: "id" });
        if (!d.objectStoreNames.contains("activity_sessions"))
          d.createObjectStore("activity_sessions", { keyPath: "id" });
      }
    },
    blocked() {
      // Another tab is holding an older DB version open.
      // Nothing to do — the upgrade will proceed once that tab is closed.
      console.warn("[IDB] Upgrade blocked by another tab. Close other tabs to complete the upgrade.");
    },
    blocking() {
      // A newer version wants to open — release our connection so it can upgrade.
      if (db) { db.close(); db = null; }
    },
    terminated() {
      // Browser killed the IDB connection (e.g., storage pressure).
      db = null;
    },
  });
  return db;
}

// ─── Last-sync helpers ───────────────────────────────────────────────────────
const SYNC_KEY = (eventId: string) => `soulcomms_last_event_sync_${eventId}`;

function saveLastSyncTime(eventId: string) {
  try { localStorage.setItem(SYNC_KEY(eventId), new Date().toISOString()); } catch { /* */ }
}

export function getLastEventSyncTime(eventId: string): Date | null {
  try {
    const raw = localStorage.getItem(SYNC_KEY(eventId));
    return raw ? new Date(raw) : null;
  } catch { return null; }
}

// ─── Cache event data ────────────────────────────────────────────────────────
export async function cacheEventData(
  eventId: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const idb = await getDb();

  // Fetch all data sources in PARALLEL — cuts network wait from 5× to 1× RTT
  onProgress?.("Downloading event data…");
  const [
    { data: participants },
    { data: providers },
    { data: crew },
    { data: activities },
    { data: sessions },
  ] = await Promise.all([
    supabase.from("participants")
      .select("id, code, name, phone, qr_link, is_checked_in, event_id")
      .eq("event_id", eventId),
    supabase.from("service_providers")
      .select("id, code, brand_name, contact_person, phone, qr_link, is_checked_in, event_id")
      .eq("event_id", eventId),
    supabase.from("crew_members")
      .select("id, code, name, department, phone, qr_link, is_checked_in, event_id")
      .eq("event_id", eventId),
    supabase.from("activities").select("*").eq("event_id", eventId),
    supabase.from("activity_sessions").select("*").eq("event_id", eventId),
  ]);

  // Write to IDB in a single transaction — fire all puts WITHOUT awaiting each one.
  // IDB batches the puts internally; awaiting each put in a loop adds unnecessary overhead.
  const stores = [
    "participants", "service_providers", "crew_members",
    "activities", "activity_sessions",
  ] as const;
  const tx = idb.transaction(stores, "readwrite");

  // Clear then batch-put (no await per put)
  tx.objectStore("participants").clear();
  tx.objectStore("service_providers").clear();
  tx.objectStore("crew_members").clear();
  tx.objectStore("activities").clear();
  tx.objectStore("activity_sessions").clear();

  (participants ?? []).forEach(p => tx.objectStore("participants").put(p));
  (providers ?? []).forEach(s => tx.objectStore("service_providers").put(s));
  (crew ?? []).forEach(c => tx.objectStore("crew_members").put(c));
  (activities ?? []).forEach(a => tx.objectStore("activities").put(a));
  (sessions ?? []).forEach(s => tx.objectStore("activity_sessions").put(s));

  // Wait for all puts to complete at once
  await tx.done;

  saveLastSyncTime(eventId);

  onProgress?.(
    `Cached ${(participants ?? []).length} participants · ` +
    `${(providers ?? []).length} providers · ` +
    `${(crew ?? []).length} crew · ` +
    `${(activities ?? []).length} activities`
  );
}

// ─── Cache helpers for individual stores (called by contexts on successful online fetch) ─────
export async function cacheActivities(eventId: string, activities: CachedActivity[]): Promise<void> {
  try {
    const idb = await getDb();
    const tx = idb.transaction("activities", "readwrite");
    tx.objectStore("activities").clear();
    activities.forEach(a => tx.objectStore("activities").put(a));
    await tx.done;
  } catch { /* best-effort */ }
}

export async function cacheActivitySessions(eventId: string, sessions: CachedActivitySession[]): Promise<void> {
  try {
    const idb = await getDb();
    // Load existing sessions, keep those for other events, replace for this event
    const all = await idb.getAll("activity_sessions") as CachedActivitySession[];
    const merged = [
      ...all.filter(s => s.event_id !== eventId),
      ...sessions,
    ];
    // Single transaction, all puts queued without individual awaits
    const tx = idb.transaction("activity_sessions", "readwrite");
    tx.objectStore("activity_sessions").clear();
    merged.forEach(s => tx.objectStore("activity_sessions").put(s));
    await tx.done;
  } catch { /* best-effort */ }
}

// ─── Offline reads for activities ────────────────────────────────────────────
export async function getOfflineActivities(eventId: string): Promise<CachedActivity[]> {
  try {
    const idb = await getDb();
    const all = await idb.getAll("activities") as CachedActivity[];
    return all.filter(a => a.event_id === eventId);
  } catch { return []; }
}

export async function getOfflineActivitySessions(eventId: string): Promise<CachedActivitySession[]> {
  try {
    const idb = await getDb();
    const all = await idb.getAll("activity_sessions") as CachedActivitySession[];
    return all.filter(s => s.event_id === eventId);
  } catch { return []; }
}

// ─── Walk-In Registration ────────────────────────────────────────────────────
export async function createWalkIn(
  name: string,
  phone: string | null,
  eventId: string,
  checkInNow = false  // when true: register + check-in in one atomic step
): Promise<WalkInRecord> {
  const idb = await getDb();
  const id = crypto.randomUUID();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  const temp_code = `W-${suffix}`;
  const now = new Date().toISOString();

  const record: WalkInRecord = {
    id,
    temp_code,
    name: name.trim(),
    phone: phone?.trim() || null,
    event_id: eventId,
    is_checked_in: checkInNow,
    checked_in_at: checkInNow ? now : null,
    check_in_method: checkInNow ? "Walk-In Registration" : null,
    created_at: now,
    synced: false,
    source: "Walk-In",
    qr_link: null,
  };

  await idb.put("walk_ins", record);
  await queueMutation("register_walkin", { ...record });
  return record;
}

export async function checkInWalkIn(walkInId: string): Promise<void> {
  const idb = await getDb();
  const record = await idb.get("walk_ins", walkInId) as WalkInRecord | undefined;
  if (!record || record.is_checked_in) return;
  const updated: WalkInRecord = {
    ...record,
    is_checked_in: true,
    checked_in_at: new Date().toISOString(),
    check_in_method: "Manual Code",
  };
  await idb.put("walk_ins", updated);

  const queue = await idb.getAll("sync_queue") as SyncMutation[];
  const existing = queue.find(
    m => m.type === "register_walkin" &&
    (m.payload as Record<string, unknown>).id === walkInId
  );
  if (existing) {
    await idb.put("sync_queue", {
      ...existing,
      payload: {
        ...existing.payload,
        is_checked_in: true,
        checked_in_at: updated.checked_in_at,
        check_in_method: "Manual Code",
      },
    });
  }
}

export async function getAllWalkIns(): Promise<WalkInRecord[]> {
  const idb = await getDb();
  return (await idb.getAll("walk_ins")) as WalkInRecord[];
}

// ─── Walk-In Crew Registration ───────────────────────────────────────────────
export async function createWalkInCrew(
  name: string,
  teamName: string,
  phone: string | null,
  eventId: string
): Promise<WalkInCrewRecord> {
  const idb = await getDb();
  const id = crypto.randomUUID();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  const temp_code = `WC-${suffix}`;
  const now = new Date().toISOString();

  const record: WalkInCrewRecord = {
    id,
    temp_code,
    name:        name.trim(),
    team_name:   teamName.trim(),
    phone:       phone?.trim() || null,
    event_id:    eventId,
    is_checked_in:  true,
    checked_in_at:  now,
    check_in_method: "Walk-In Registration",
    created_at:  now,
    synced: false,
  };

  await idb.put("walk_ins_crew", record);
  await queueMutation("register_walkin_crew", { ...record });
  return record;
}

export async function getAllWalkInCrew(): Promise<WalkInCrewRecord[]> {
  const idb = await getDb();
  return (await idb.getAll("walk_ins_crew")) as WalkInCrewRecord[];
}

// ─── Walk-In Service Provider Registration ───────────────────────────────────
export async function createWalkInSP(
  brandName: string,
  contactPerson: string | null,
  phone: string | null,
  eventId: string
): Promise<WalkInSPRecord> {
  const idb = await getDb();
  const id = crypto.randomUUID();
  const suffix = Date.now().toString(36).slice(-5).toUpperCase();
  const temp_code = `WS-${suffix}`;
  const now = new Date().toISOString();

  const record: WalkInSPRecord = {
    id,
    temp_code,
    brand_name:     brandName.trim(),
    contact_person: contactPerson?.trim() || null,
    phone:          phone?.trim() || null,
    event_id:       eventId,
    is_checked_in:  true,
    checked_in_at:  now,
    check_in_method: "Walk-In Registration",
    created_at:     now,
    synced: false,
  };

  await idb.put("walk_ins_sp", record);
  await queueMutation("register_walkin_sp", { ...record });
  return record;
}

export async function getAllWalkInSP(): Promise<WalkInSPRecord[]> {
  const idb = await getDb();
  return (await idb.getAll("walk_ins_sp")) as WalkInSPRecord[];
}

// ─── QR Registration ─────────────────────────────────────────────────────────
export async function createQrParticipant(
  name: string,
  code: string,
  qrLink: string,
  phone: string | null,
  eventId: string
): Promise<WalkInRecord> {
  const idb = await getDb();
  const normalizedCode = code.replace(/^#/, "").trim().padStart(4, "0");

  const existing = await idb.getAll("walk_ins") as WalkInRecord[];
  const dup = existing.find(
    w => w.event_id === eventId &&
         (w.qr_link === qrLink || w.temp_code === normalizedCode)
  );
  if (dup) {
    throw new Error("A participant with this QR or code already exists locally.");
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const record: WalkInRecord = {
    id,
    temp_code: normalizedCode,
    name: name.trim(),
    phone: phone?.trim() || null,
    event_id: eventId,
    is_checked_in: true,
    checked_in_at: now,
    check_in_method: "QR Scan",
    created_at: now,
    synced: false,
    source: "QR Registration",
    qr_link: qrLink,
  };

  await idb.put("walk_ins", record);
  await queueMutation("register_qr", {
    id,
    code: normalizedCode,
    name: record.name,
    phone: record.phone,
    qr_link: qrLink,
    event_id: eventId,
    source: "QR Registration",
    is_checked_in: true,
    checked_in_at: now,
    check_in_method: "QR Scan",
  });

  return record;
}

// ─── Offline lookups ─────────────────────────────────────────────────────────
function normalizeCodes(raw: string): Set<string> {
  const trimmed = raw.trim();
  const set = new Set<string>([trimmed]);
  const stripped = trimmed.replace(/^[#\s]+/, "").trim();
  if (stripped) set.add(stripped);
  if (/^\d+$/.test(stripped)) set.add(stripped.padStart(4, "0"));
  const parts = trimmed.split(/[-/]/);
  if (parts.length > 1) {
    const suffix = parts[parts.length - 1].replace(/\D/g, "");
    if (suffix && suffix.length <= 6) { set.add(suffix); set.add(suffix.padStart(4, "0")); }
  }
  return set;
}

export async function offlineLookupParticipant(
  value: string, eventId: string
): Promise<(CachedParticipant & { is_walkin?: boolean }) | null> {
  const idb = await getDb();
  const trimmed = value.trim();
  const isUrl = trimmed.startsWith("http");
  const normalizedPhone = trimmed.replace(/\D/g, "");

  // ── 1. Check walk_ins ─────────────────────────────────────────────────────
  const walkIns = await idb.getAll("walk_ins") as WalkInRecord[];
  const walkinMatch = walkIns.find(w =>
    w.event_id === eventId && (
      w.temp_code.toUpperCase() === trimmed.toUpperCase() ||
      w.name.toLowerCase() === trimmed.toLowerCase() ||
      (normalizedPhone.length >= 8 && w.phone && w.phone.replace(/\D/g, "") === normalizedPhone) ||
      (isUrl && w.qr_link === trimmed)
    )
  );
  if (walkinMatch) {
    return {
      id: walkinMatch.id, code: walkinMatch.temp_code, name: walkinMatch.name,
      phone: walkinMatch.phone, qr_link: walkinMatch.qr_link ?? null,
      is_checked_in: walkinMatch.is_checked_in, event_id: walkinMatch.event_id,
      is_walkin: true,
    };
  }

  // ── 2. Cached server participants ─────────────────────────────────────────
  const all = await idb.getAll("participants") as CachedParticipant[];
  const codes = normalizeCodes(trimmed);

  return all.find(p => {
    if (p.event_id !== eventId) return false;
    if (isUrl) return p.qr_link === trimmed;
    if (codes.has(p.code)) return true;
    if (normalizedPhone.length >= 8 && p.phone && p.phone.replace(/\D/g, "") === normalizedPhone) return true;
    if (/[a-zA-Z]/.test(trimmed) && trimmed.length >= 3 && p.name.toLowerCase().includes(trimmed.toLowerCase())) return true;
    return false;
  }) ?? null;
}

export async function offlineLookupSP(
  value: string, eventId: string
): Promise<CachedServiceProvider | null> {
  const idb = await getDb();

  const walkInSPs = await idb.getAll("walk_ins_sp") as WalkInSPRecord[];
  const wiMatch = walkInSPs.find(w =>
    w.event_id === eventId &&
    (w.temp_code === value || w.temp_code === value.toUpperCase() ||
     w.brand_name.toLowerCase() === value.toLowerCase())
  );
  if (wiMatch) {
    return {
      id: wiMatch.id, code: wiMatch.temp_code, brand_name: wiMatch.brand_name,
      contact_person: wiMatch.contact_person, phone: wiMatch.phone,
      qr_link: null, is_checked_in: wiMatch.is_checked_in, event_id: wiMatch.event_id,
    };
  }

  const all = await idb.getAll("service_providers") as CachedServiceProvider[];
  const padded = value.padStart(4, "0");
  return all.find(p =>
    p.event_id === eventId && (p.code === value || p.code === padded)
  ) ?? null;
}

export async function offlineLookupCrew(
  value: string, eventId: string
): Promise<CachedCrewMember | null> {
  const idb = await getDb();

  const walkInCrew = await idb.getAll("walk_ins_crew") as WalkInCrewRecord[];
  const wiMatch = walkInCrew.find(w =>
    w.event_id === eventId &&
    (w.temp_code === value || w.temp_code === value.toUpperCase() ||
     w.name.toLowerCase() === value.toLowerCase())
  );
  if (wiMatch) {
    return {
      id: wiMatch.id, code: wiMatch.temp_code, name: wiMatch.name,
      department: wiMatch.team_name, phone: wiMatch.phone,
      qr_link: null, is_checked_in: wiMatch.is_checked_in, event_id: wiMatch.event_id,
    };
  }

  const all = await idb.getAll("crew_members") as CachedCrewMember[];
  const padded = value.padStart(4, "0");
  return all.find(p =>
    p.event_id === eventId && (p.code === value || p.code === padded)
  ) ?? null;
}

// ─── Optimistic local updates ─────────────────────────────────────────────────
export async function localCheckIn(
  store: "participants" | "service_providers" | "crew_members",
  id: string
): Promise<void> {
  const idb = await getDb();
  const record = await idb.get(store, id);
  if (record) {
    await idb.put(store, { ...record, is_checked_in: true, checked_in_at: new Date().toISOString() });
  }
}

export async function localActivityCheck(
  participantId: string,
  experience: string
): Promise<boolean> {
  const idb = await getDb();
  const queue = await idb.getAll("sync_queue") as SyncMutation[];
  return queue.some(m =>
    m.type === "activity_log" &&
    (m.payload as Record<string, unknown>).participant_id === participantId &&
    (m.payload as Record<string, unknown>).experience === experience
  );
}

// ─── Sync queue ──────────────────────────────────────────────────────────────
export async function queueMutation(
  type: MutationType,
  payload: Record<string, unknown>
): Promise<void> {
  const idb = await getDb();
  const mutation: SyncMutation = {
    id: crypto.randomUUID(),
    type,
    payload,
    created_at: new Date().toISOString(),
    retries: 0,
  };
  await idb.put("sync_queue", mutation);
}

export async function getPendingCount(): Promise<number> {
  const idb = await getDb();
  return (await idb.getAll("sync_queue")).length;
}

export async function getQueueStats(): Promise<QueueStats> {
  const idb = await getDb();
  const queue = await idb.getAll("sync_queue") as SyncMutation[];
  return {
    total: queue.length,
    walkIns: queue.filter(m =>
      m.type === "register_walkin" || m.type === "register_qr" ||
      m.type === "register_walkin_crew" || m.type === "register_walkin_sp"
    ).length,
    checkIns: queue.filter(m =>
      m.type === "checkin_participant" || m.type === "checkin_sp" || m.type === "checkin_crew"
    ).length,
    activities: queue.filter(m => m.type === "activity_log" || m.type === "session_participation").length,
  };
}

// ─── Sync helper: next sequential code ───────────────────────────────────────
async function getNextCode(eventId: string): Promise<string> {
  const { data } = await supabase
    .from("participants")
    .select("code")
    .eq("event_id", eventId)
    .order("code", { ascending: false })
    .limit(1)
    .maybeSingle();
  const maxNum = data?.code ? parseInt(data.code.replace(/\D/g, ""), 10) : 0;
  return String((isNaN(maxNum) ? 0 : maxNum) + 1).padStart(4, "0");
}

// ─── Admin queue inspection ───────────────────────────────────────────────────
export async function getSyncQueueItems(): Promise<SyncMutation[]> {
  const idb = await getDb();
  const items = await idb.getAll("sync_queue") as SyncMutation[];
  return items.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function dismissSyncMutation(id: string): Promise<void> {
  const idb = await getDb();
  await idb.delete("sync_queue", id);
}

export async function dismissAllFailed(): Promise<void> {
  const idb = await getDb();
  const items = await idb.getAll("sync_queue") as SyncMutation[];
  const failed = items.filter(m => m.retries >= 5);
  for (const m of failed) await idb.delete("sync_queue", m.id);
}

// ─── Flush queue ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 20;
const FLUSH_TIMEOUT_MS = 10_000;
let flushInProgress = false;

function withFlushTimeout<T>(p: Promise<T>, ms = FLUSH_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) =>
      setTimeout(() => rej(new Error("Network timeout")), ms)
    ),
  ]);
}

function hasPendingRegistration(queue: SyncMutation[], participantId: string): boolean {
  return queue.some(m =>
    (m.type === "register_walkin" || m.type === "register_qr") &&
    (m.payload as Record<string, unknown>).id === participantId
  );
}

export async function flushQueue(): Promise<{ synced: number; failed: number }> {
  if (flushInProgress) return { synced: 0, failed: 0 };
  flushInProgress = true;

  try {
    const idb = await getDb();
    const queue = await idb.getAll("sync_queue") as SyncMutation[];
    let synced = 0; let failed = 0;

    const ORDER: Record<MutationType, number> = {
      register_walkin:      0,
      register_walkin_crew: 0,
      register_walkin_sp:   0,
      register_qr:          0,
      checkin_participant:  1,
      checkin_sp:           1,
      checkin_crew:         1,
      activity_log:         2,
      session_participation: 2,
    };
    const sorted = [...queue].sort(
      (a, b) => (ORDER[a.type] ?? 3) - (ORDER[b.type] ?? 3)
    );

    for (const mutation of sorted) {
      try {
        if (mutation.type === "register_walkin") {
          const p = mutation.payload as Record<string, unknown>;
          let realCode = await withFlushTimeout(getNextCode(String(p.event_id ?? "")));
          let inserted = false;
          for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
            const { error } = await withFlushTimeout(
              supabase.from("participants").upsert({
                id: p.id, code: realCode, name: p.name, phone: p.phone ?? null,
                event_id: p.event_id, source: "Walk-In",
                is_checked_in: p.is_checked_in ?? false,
                checked_in_at: p.checked_in_at ?? null,
                check_in_method: p.check_in_method ?? null,
              }, { onConflict: "id" })
            );
            if (!error) {
              inserted = true;
            } else if (error.code === "23505") {
              const num = parseInt(realCode.replace(/\D/g, ""), 10) || 0;
              realCode = String(num + 1).padStart(4, "0");
            } else {
              throw error;
            }
          }
          if (!inserted) throw new Error("Could not assign unique code after 10 attempts");
          const walkin = await idb.get("walk_ins", String(p.id));
          if (walkin) await idb.put("walk_ins", { ...walkin, synced: true });

        } else if (mutation.type === "register_walkin_crew") {
          const p = mutation.payload as Record<string, unknown>;
          const { data: lastCrew } = await withFlushTimeout(
            supabase.from("crew_members").select("code")
              .order("created_at", { ascending: false }).limit(1).maybeSingle()
          );
          let crewNum = lastCrew?.code ? parseInt(lastCrew.code.replace(/\D/g, ""), 10) : 0;
          let inserted = false;
          for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
            crewNum++;
            const crewCode = `C${String(crewNum).padStart(4, "0")}`;
            const { error } = await withFlushTimeout(
              supabase.from("crew_members").upsert({
                id: p.id, code: crewCode, name: p.name,
                department: p.team_name ?? null, phone: p.phone ?? null,
                event_id: p.event_id, is_checked_in: p.is_checked_in ?? true,
                checked_in_at: p.checked_in_at ?? null,
                check_in_method: p.check_in_method ?? "Walk-In Registration",
              }, { onConflict: "id" })
            );
            if (!error) inserted = true;
            else if (error.code !== "23505") throw error;
          }
          if (!inserted) throw new Error("Could not assign unique crew code");
          const wi = await idb.get("walk_ins_crew", String(p.id));
          if (wi) await idb.put("walk_ins_crew", { ...wi, synced: true });

        } else if (mutation.type === "register_walkin_sp") {
          const p = mutation.payload as Record<string, unknown>;
          const { data: lastSP } = await withFlushTimeout(
            supabase.from("service_providers").select("code")
              .order("created_at", { ascending: false }).limit(1).maybeSingle()
          );
          let spNum = lastSP?.code ? parseInt(lastSP.code.replace(/\D/g, ""), 10) : 0;
          let inserted = false;
          for (let attempt = 0; attempt < 10 && !inserted; attempt++) {
            spNum++;
            const spCode = `SP${String(spNum).padStart(3, "0")}`;
            const { error } = await withFlushTimeout(
              supabase.from("service_providers").upsert({
                id: p.id, code: spCode, brand_name: p.brand_name,
                contact_person: p.contact_person ?? null, phone: p.phone ?? null,
                event_id: p.event_id, is_checked_in: p.is_checked_in ?? true,
                checked_in_at: p.checked_in_at ?? null,
                check_in_method: p.check_in_method ?? "Walk-In Registration",
              }, { onConflict: "id" })
            );
            if (!error) inserted = true;
            else if (error.code !== "23505") throw error;
          }
          if (!inserted) throw new Error("Could not assign unique SP code");
          const wi = await idb.get("walk_ins_sp", String(p.id));
          if (wi) await idb.put("walk_ins_sp", { ...wi, synced: true });

        } else if (mutation.type === "register_qr") {
          const p = mutation.payload as Record<string, unknown>;
          const { error } = await withFlushTimeout(
            supabase.from("participants").upsert({
              id: p.id, code: p.code, name: p.name, phone: p.phone ?? null,
              qr_link: p.qr_link ?? null, event_id: p.event_id,
              source: "QR Registration", is_checked_in: p.is_checked_in ?? true,
              checked_in_at: p.checked_in_at ?? null, check_in_method: p.check_in_method ?? "QR Scan",
            }, { onConflict: "id" })
          );
          if (error) throw error;
          const walkin = await idb.get("walk_ins", String(p.id));
          if (walkin) await idb.put("walk_ins", { ...walkin, synced: true });

        } else if (mutation.type === "checkin_participant") {
          const p = mutation.payload as Record<string, unknown>;
          if (hasPendingRegistration(sorted, String(p.id))) { failed++; continue; }
          const { error } = await withFlushTimeout(
            supabase.from("participants").update({
              is_checked_in: p.is_checked_in, checked_in_at: p.checked_in_at,
              check_in_method: p.check_in_method,
            }).eq("id", String(p.id))
          );
          if (error) throw error;

        } else if (mutation.type === "checkin_sp") {
          const p = mutation.payload as Record<string, unknown>;
          const { error } = await withFlushTimeout(
            supabase.from("service_providers").update({
              is_checked_in: p.is_checked_in, checked_in_at: p.checked_in_at,
              check_in_method: p.check_in_method,
            }).eq("id", String(p.id))
          );
          if (error) throw error;

        } else if (mutation.type === "checkin_crew") {
          const p = mutation.payload as Record<string, unknown>;
          const { error } = await withFlushTimeout(
            supabase.from("crew_members").update({
              is_checked_in: p.is_checked_in, checked_in_at: p.checked_in_at,
              check_in_method: p.check_in_method,
            }).eq("id", String(p.id))
          );
          if (error) throw error;

        } else if (mutation.type === "activity_log") {
          const p = mutation.payload as Record<string, unknown>;
          if (p.participant_id && hasPendingRegistration(sorted, String(p.participant_id))) {
            failed++; continue;
          }
          const { error } = await withFlushTimeout(
            supabase.from("activity_logs").insert(p)
          );
          if (error && !error.message.toLowerCase().includes("duplicate") &&
              !error.message.toLowerCase().includes("unique")) throw error;

        } else if (mutation.type === "session_participation") {
          const p = mutation.payload as Record<string, unknown>;
          const { error } = await withFlushTimeout(
            supabase.from("session_participations").insert(p)
          );
          if (error && error.code !== "23505") throw error;
        }

        await idb.delete("sync_queue", mutation.id);
        synced++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        const updated: SyncMutation = {
          ...mutation,
          retries: mutation.retries + 1,
          error_message: msg,
          last_error_at: new Date().toISOString(),
        };
        await idb.put("sync_queue", updated);
      }
    }
    return { synced, failed };
  } finally {
    flushInProgress = false;
  }
}

// Suppress unused variable warning for MAX_RETRIES
void MAX_RETRIES;
