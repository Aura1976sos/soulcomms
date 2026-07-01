/**
 * Offline Authentication Cache
 *
 * When a staff member logs in online, their credentials (PBKDF2-hashed password
 * + profile) are saved to a dedicated IndexedDB. On subsequent logins while
 * offline, the hash is recomputed and compared — if it matches, an offline
 * session is created with the cached profile data.
 *
 * Security:
 *  - Passwords are never stored in plain text.
 *  - PBKDF2 with 100 000 iterations + per-user random salt (16 bytes).
 *  - Access is restricted to previously-authenticated users only.
 */
import { openDB } from "idb";

const AUTH_DB_NAME = "soulcomms_auth";
const AUTH_DB_VERSION = 1;

// ── Types ────────────────────────────────────────────────────────────────────

export interface OfflineCachedProfile {
  id: string;
  name: string;
  role: string;
  status: string;
  assigned_event_id: string | null;
}

export interface OfflineAuthEntry {
  email: string;           // keyPath (lowercased)
  userId: string;
  passwordHash: string;    // PBKDF2 output — base64
  salt: string;            // 16 random bytes — base64
  profile: OfflineCachedProfile;
  cachedAt: string;        // ISO timestamp of last successful online login
}

// ── Internal DB ──────────────────────────────────────────────────────────────

let authDbPromise: ReturnType<typeof openDB> | null = null;

function getAuthDb() {
  if (!authDbPromise) {
    authDbPromise = openDB(AUTH_DB_NAME, AUTH_DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("offline_auth"))
          db.createObjectStore("offline_auth", { keyPath: "email" });
      },
    });
  }
  return authDbPromise;
}

// ── PBKDF2 helpers ───────────────────────────────────────────────────────────

async function derivePBKDF2(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    keyMat, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

const b64Encode = (buf: Uint8Array) => btoa(String.fromCharCode(...buf));
const b64Decode = (s: string)       => new Uint8Array(atob(s).split("").map(c => c.charCodeAt(0)));

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Called after a successful online login.
 * Stores a PBKDF2 hash of the password alongside the staff profile.
 */
export async function cacheOfflineCredentials(
  email: string,
  password: string,
  userId: string,
  profile: OfflineCachedProfile
): Promise<void> {
  try {
    const db = await getAuthDb();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const passwordHash = await derivePBKDF2(password, salt);
    const entry: OfflineAuthEntry = {
      email: email.toLowerCase().trim(),
      userId,
      passwordHash,
      salt: b64Encode(salt),
      profile,
      cachedAt: new Date().toISOString(),
    };
    await db.put("offline_auth", entry);
  } catch (e) {
    console.warn("[OfflineAuth] Failed to cache credentials:", e);
  }
}

/**
 * Called when the user tries to log in while offline.
 * Returns the cached entry if the password matches, null otherwise.
 */
export async function validateOfflineLogin(
  email: string,
  password: string
): Promise<OfflineAuthEntry | null> {
  try {
    const db = await getAuthDb();
    const entry = await db.get(
      "offline_auth", email.toLowerCase().trim()
    ) as OfflineAuthEntry | undefined;

    if (!entry) return null;

    const hash = await derivePBKDF2(password, b64Decode(entry.salt));
    if (hash !== entry.passwordHash) return null;

    return entry;
  } catch {
    return null;
  }
}

/**
 * Returns all cached offline users (for the login page quick-select).
 */
export async function getAllOfflineUsers(): Promise<OfflineAuthEntry[]> {
  try {
    const db = await getAuthDb();
    return (await db.getAll("offline_auth")) as OfflineAuthEntry[];
  } catch {
    return [];
  }
}

/**
 * Look up a cached entry by Supabase user ID (used when Supabase session
 * is valid but the profile fetch fails due to being offline).
 */
export async function getOfflineAuthByUserId(userId: string): Promise<OfflineAuthEntry | null> {
  try {
    const db = await getAuthDb();
    const all = (await db.getAll("offline_auth")) as OfflineAuthEntry[];
    return all.find(e => e.userId === userId) ?? null;
  } catch {
    return null;
  }
}

/** Remove one or all cached entries (called on explicit sign-out). */
export async function clearOfflineAuth(email?: string): Promise<void> {
  try {
    const db = await getAuthDb();
    if (email) {
      await db.delete("offline_auth", email.toLowerCase().trim());
    } else {
      await db.clear("offline_auth");
    }
  } catch (e) {
    console.warn("[OfflineAuth] clearOfflineAuth error:", e);
  }
}

/** Returns true when the error is due to a missing network connection. */
export function isNetworkError(err: unknown): boolean {
  if (!navigator.onLine) return true;
  if (!err) return false;
  const msg = String(err).toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("unable to connect") ||
    msg.includes("etimedout") ||
    msg.includes("timeout")
  );
}
