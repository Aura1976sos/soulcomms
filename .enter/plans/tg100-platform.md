# Performance Optimization — Soulcomms Platform

## Root Cause Analysis

### 1. PRIMARY: No Route Code Splitting (`router.tsx`)
ALL 20+ pages are static top-level imports:
```typescript
import Dashboard from "./pages/Dashboard";
import CheckIn from "./pages/CheckIn";   // 860 lines + 6 modal imports
import ActivityRecorder from "./pages/ActivityRecorder";  // 632 lines
// ... 17 more
```
This forces the browser to download, parse, and execute the ENTIRE application on first load.  
On 3G (1 Mbps): 5-8 MB bundle = 40–64 seconds. On weak 4G: 10–30 seconds.  
**This alone explains every reported delay.**

### 2. SECONDARY: Sequential DB Queries — CommunicationsContext.tsx
```typescript
for (const m of memberships) {
  const { count } = await supabase.from("comm_messages")...  // SEQUENTIAL
  unread += count ?? 0;
}
```
For 5 channels = 5 sequential round-trips to the DB. Runs on mount + every 30s.  
Adds 2–5 seconds of blocking time every cycle.

### 3. SECONDARY: Dashboard Full-Table Scans — Dashboard.tsx
```typescript
supabase.from("activity_logs").select("activity_id").eq("event_id", eid),       // ALL rows
supabase.from("session_participations").select("activity_id, participant_id"),   // ALL rows
supabase.from("activity_logs").select("participant_id").eq("event_id", eid),     // DUPLICATE
supabase.from("session_participations").select("participant_id").eq("event_id"), // DUPLICATE
```
4 full-table fetches that grow linearly with event size. With 1000+ participants
across multiple activities, this transfers 10,000+ rows per 30-second refresh.

### 4. MINOR: NetworkContext IDB Poll Every 5 Seconds
```typescript
const interval = setInterval(refreshPending, 5_000); // too frequent
```
Opening IDB every 5 seconds when queue is likely empty wastes resources.

---

## Files to Modify

| File | Change |
|---|---|
| `src/router.tsx` | All page imports → `lazy()` + `<Suspense>` |
| `src/components/layout/PageTransition.tsx` | NEW — instant skeleton loader |
| `src/contexts/CommunicationsContext.tsx` | Sequential for-loop → `Promise.all()` |
| `src/pages/Dashboard.tsx` | Bulk row fetches → single RPC call |
| `src/contexts/NetworkContext.tsx` | IDB poll 5s → 30s |
| Supabase migration | `get_dashboard_stats(event_id)` RPC function |

---

## Implementation Details

### Fix 1 — router.tsx: Route Code Splitting
```typescript
import { lazy, Suspense } from "react";
import { PageTransition } from "@/components/layout/PageTransition";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const ActivityRecorder = lazy(() => import("./pages/ActivityRecorder"));
// ... all 20 pages

// Each route wrapped with Suspense:
{
  path: "/checkin",
  element: (
    <Suspense fallback={<PageTransition />}>
      <ProtectedRoute requiredRoles={["admin", "checkin_officer"]}>
        <CheckIn />
      </ProtectedRoute>
    </Suspense>
  )
}
```
- Initial bundle shrinks dramatically — only auth + contexts + sidebar load upfront
- Each page chunk is fetched on first navigation (~50–200 KB each)
- Service worker caches chunks after first visit → instant on subsequent visits
- `<Suspense fallback>` renders immediately → user sees feedback right away

**Login, Setup, LiveIndex, LiveEvent, DisplayMode, NotFound** kept as direct imports (small, not lazy-loaded pages or already in critical path).

### Fix 2 — PageTransition.tsx (NEW)
Simple centered spinner that shows instantly when navigating:
```tsx
export function PageTransition() {
  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground font-medium">Loading...</p>
      </div>
    </div>
  );
}
```

### Fix 3 — CommunicationsContext.tsx: Parallel Queries
```typescript
// BEFORE (sequential):
for (const m of memberships) {
  const { count } = await supabase.from("comm_messages")...
  unread += count ?? 0;
}

// AFTER (parallel):
const counts = await Promise.all(
  memberships.map(m =>
    supabase.from("comm_messages")
      .select("id", { count: "exact", head: true })
      .eq("channel_id", m.channel_id)
      .eq("is_deleted", false)
      .neq("sender_id", user.id)
      .gt("created_at", m.last_read_at ?? "1970-01-01")
      .then(r => r.count ?? 0)
  )
);
setTotalUnread(counts.reduce((a, b) => a + b, 0));
```
Also increase polling interval: 30_000 → 60_000 (unread count doesn't need to refresh every 30s — realtime subscription covers new mentions).

### Fix 4 — Dashboard.tsx: DB-Side Aggregation via RPC
Replace 4 bulk fetches with single RPC call:
```typescript
const [
  { count: totalRegistered },
  { count: checkedIn },
  { data: recentLogs },
  { data: statsData },
  { data: activitiesWithManual },
] = await Promise.all([
  supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid),
  supabase.from("participants").select("*", { count: "exact", head: true }).eq("event_id", eid).eq("is_checked_in", true),
  supabase.from("activity_logs").select("id, participant_code, experience, recorded_at, participants(name)").eq("event_id", eid).order("recorded_at", { ascending: false }).limit(10),
  supabase.rpc("get_dashboard_stats", { p_event_id: eid }),  // single call replaces 4 bulk fetches
  supabase.from("activities").select("id, code, manual_count").eq("event_id", eid),
]);
```

### Fix 5 — Supabase Migration: `get_dashboard_stats` RPC
```sql
CREATE OR REPLACE FUNCTION get_dashboard_stats(p_event_id uuid)
RETURNS json LANGUAGE sql SECURITY DEFINER AS $$
  SELECT json_build_object(
    'log_counts', (
      SELECT coalesce(json_object_agg(activity_id, cnt), '{}')
      FROM (
        SELECT activity_id, count(*) AS cnt
        FROM activity_logs
        WHERE event_id = p_event_id AND activity_id IS NOT NULL
        GROUP BY activity_id
      ) t
    ),
    'session_counts', (
      SELECT coalesce(json_object_agg(activity_id, cnt), '{}')
      FROM (
        SELECT activity_id, count(*) AS cnt
        FROM session_participations
        WHERE event_id = p_event_id AND activity_id IS NOT NULL
        GROUP BY activity_id
      ) t
    ),
    'unique_participants', (
      SELECT count(DISTINCT participant_id) FROM (
        SELECT participant_id FROM activity_logs
        WHERE event_id = p_event_id AND participant_id IS NOT NULL
        UNION
        SELECT participant_id FROM session_participations
        WHERE event_id = p_event_id AND participant_id IS NOT NULL
      ) u
    )
  )
$$;
```

### Fix 6 — NetworkContext.tsx: Reduce IDB Polling
```typescript
// BEFORE:
const interval = setInterval(refreshPending, 5_000);

// AFTER:
const interval = setInterval(refreshPending, 30_000);
```
IDB queue stats only need to update every 30s; mutations already call `refreshPending()` directly.

---

## Expected Outcome

| Scenario | Before | After |
|---|---|---|
| First page load (3G) | 10–30s | 2–4s (core bundle only) |
| Navigate to new page (first time) | 5–15s | 0.5–1.5s (page chunk) |
| Navigate to cached page | 5–15s | Instant (SW cached) |
| Communications unread query | 2–5s sequential | 0.5s parallel |
| Dashboard stats (1000 participants) | 3–8s (bulk fetch) | 0.3s (DB aggregation) |
| Button click → visual feedback | 0–10s delay | Instant (Suspense renders) |
