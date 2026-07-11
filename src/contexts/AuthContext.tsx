import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  cacheOfflineCredentials, validateOfflineLogin, getOfflineAuthByUserId,
  isNetworkError, OfflineCachedProfile, clearOfflineAuth,
} from "@/lib/offlineAuth";
import { trackEvent } from "@enter-pro/analytics-sdk";

export type StaffRole =
  | "admin"
  | "event_admin"
  | "checkin_officer"
  | "activity_coordinator"
  | "crew_manager"
  | "sp_manager"
  | "viewer";

const normalizeStaffRole = (role: string | null | undefined): StaffRole => {
  const v = (role ?? "").toLowerCase().trim();

  if (v === "admin") return "admin";
  if (v === "event_admin") return "event_admin";
  if (v === "checkin_officer") return "checkin_officer";
  if (v === "activity_coordinator") return "activity_coordinator";
  if (v === "crew_manager") return "crew_manager";
  if (v === "sp_manager") return "sp_manager";
  if (v === "viewer") return "viewer";

  // Backward/alias support for merged role naming variants.
  if (
    v === "staff" ||
    v === "checkin_activity_recorder" ||
    v === "checkin_and_activity_recorder" ||
    v === "check-in & activity recorder" ||
    v === "check-in and activity recorder" ||
    v === "checkin & activity recorder" ||
    v === "checkin and activity recorder"
  ) {
    return "checkin_officer";
  }

  return "viewer";
};

interface StaffProfile {
  id: string;
  name: string;
  role: StaffRole;
  status?: string;
  assigned_event_id?: string | null;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: StaffProfile | null;
  role: StaffRole | null;
  loading: boolean;
  profileReady: boolean;
  isOfflineSession: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null, session: null, profile: null, role: null,
  loading: true, profileReady: false, isOfflineSession: false,
  signIn: async () => ({ error: null }),
  signOut: async () => { },
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StaffProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileReady, setProfileReady] = useState(false);
  const [isOfflineSession, setIsOfflineSession] = useState(false);

  // Fetch profile from server (includes status and assigned_event_id)
  const fetchProfile = async (userId: string): Promise<StaffProfile | null> => {
    try {
      const { data } = await supabase
        .from("staff_profiles")
        .select("id, name, role, status, assigned_event_id")
        .eq("id", userId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id,
        name: data.name,
        role: normalizeStaffRole((data as { role?: string | null }).role),
        status: data.status,
        assigned_event_id: data.assigned_event_id,
      } as StaffProfile;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let mounted = true;

    const syncAutoRefreshWithNetwork = () => {
      try {
        if (navigator.onLine) {
          supabase.auth.startAutoRefresh();
        } else {
          supabase.auth.stopAutoRefresh();
        }
      } catch {
        // Best-effort network-aware auth refresh control
      }
    };

    // Avoid repeated refresh-token network failures while offline
    syncAutoRefreshWithNetwork();
    window.addEventListener("online", syncAutoRefreshWithNetwork);
    window.addEventListener("offline", syncAutoRefreshWithNetwork);

    // Apply a session — shared by the initial getSession() read and later auth changes
    const applySession = (newSession: Session | null) => {
      if (!mounted) return;

      setSession(newSession);
      setUser(newSession?.user ?? null);

      if (!newSession?.user) {
        setProfile(null);
        setIsOfflineSession(false);
        setProfileReady(true);
        setLoading(false);
        return;
      }

      // Auth confirmed — unblock navigation immediately
      setLoading(false);

      const profileTimer = setTimeout(() => {
        if (mounted) setProfileReady(true);
      }, 3000);

      setTimeout(async () => {
        if (!mounted) return;

        // Try fetching from server first
        let profileData = await fetchProfile(newSession.user.id);

        // If fetch failed (likely offline), fall back to local cache
        if (!profileData) {
          const offlineEntry = await getOfflineAuthByUserId(newSession.user.id);
          if (offlineEntry) {
            const cached = offlineEntry.profile as StaffProfile;
            profileData = {
              ...cached,
              role: normalizeStaffRole(cached.role),
            };
            if (mounted) setIsOfflineSession(true);
          }
        } else {
          // Fresh from server — mark as online session
          if (mounted) setIsOfflineSession(false);
        }

        if (mounted) {
          setProfile(profileData);
          setProfileReady(true);
          clearTimeout(profileTimer);
        }
      }, 0);
    };

    // On mount: read the stored session from localStorage (no network) so
    // `loading` resolves in milliseconds instead of waiting for an auth event.
    supabase.auth.getSession()
      .then(({ data: { session: storedSession } }) => applySession(storedSession))
      .catch(() => { if (mounted) setLoading(false); });

    // Keep listening for later changes (sign-in/out, token refresh)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, newSession) => applySession(newSession)
    );

    return () => {
      mounted = false;
      window.removeEventListener("online", syncAutoRefreshWithNetwork);
      window.removeEventListener("offline", syncAutoRefreshWithNetwork);
      subscription.unsubscribe();
    };
  }, []);

  // ── Sign In ─────────────────────────────────────────────────────────────────
  const signIn = async (email: string, password: string): Promise<{ error: Error | null }> => {
    // 1. Try online authentication
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (!error && data?.user) {
      // Online login succeeded — update offline credentials cache
      const profileData = await fetchProfile(data.user.id);
      if (profileData) {
        const offlineProfile: OfflineCachedProfile = {
          id: profileData.id,
          name: profileData.name,
          role: profileData.role,
          status: profileData.status ?? "active",
          assigned_event_id: profileData.assigned_event_id ?? null,
        };
        cacheOfflineCredentials(email, password, data.user.id, offlineProfile).catch(console.warn);
      }
      trackEvent("user_login", {
        eventType: "conversion",
        properties: { role: profileData?.role ?? "unknown", method: "online" },
      });
      return { error: null };
    }

    // 2. If it's a network error, try offline authentication
    if (isNetworkError(error)) {
      const cached = await validateOfflineLogin(email, password);

      if (cached) {
        const syntheticUser = { id: cached.userId, email: cached.email } as User;
        const normalizedCachedProfile = {
          ...(cached.profile as StaffProfile),
          role: normalizeStaffRole(cached.profile.role),
        };
        setUser(syntheticUser);
        setProfile(normalizedCachedProfile);
        setIsOfflineSession(true);
        setProfileReady(true);
        setLoading(false);
        trackEvent("user_login", {
          eventType: "conversion",
          properties: { role: normalizedCachedProfile.role, method: "offline" },
        });
        return { error: null };
      }

      // No cached credentials found
      return {
        error: new Error(
          "No internet connection. Please log in while online first to enable offline access."
        ),
      };
    }

    // 3. Genuine auth error (wrong password, banned, etc.)
    return { error: error as unknown as Error };
  };

  // ── Sign Out ────────────────────────────────────────────────────────────────
  const signOut = async () => {
    const currentEmail = user?.email;
    setProfile(null);
    setIsOfflineSession(false);
    setProfileReady(false);

    // Always clear local Supabase session (no network needed)
    await supabase.auth.signOut({ scope: "local" }).catch(() => { });

    // Also invalidate the server session if online
    if (navigator.onLine) {
      supabase.auth.signOut().catch(() => { });
    }

    // Don't clear the offline credential cache on signOut —
    // staff need it to log back in when offline.
    // (Admins can revoke via manage-staff → force_logout + disable)
    void currentEmail;
  };

  return (
    <AuthContext.Provider value={{
      user, session, profile,
      role: profile?.role ?? null,
      loading, profileReady, isOfflineSession,
      signIn, signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
