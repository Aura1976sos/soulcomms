import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { PageTransition } from "./components/layout/PageTransition";

// ── Non-lazy (tiny files, always needed in critical path) ─────────────────────
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import NotFound from "./pages/NotFound";
import LiveIndex from "./pages/LiveIndex";
import LiveEvent from "./pages/LiveEvent";
import DisplayMode from "./pages/DisplayMode";
import EventJoin from "./pages/EventJoin";
import EventSlugJoin from "./pages/EventSlugJoin";

// ── Lazy pages — each loaded only when first navigated to ─────────────────────
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CheckIn = lazy(() => import("./pages/CheckIn"));
const ActivityRecorder = lazy(() => import("./pages/ActivityRecorder"));
const Activities = lazy(() => import("./pages/Activities"));
const Participants = lazy(() => import("./pages/Participants"));
const ServiceProviders = lazy(() => import("./pages/ServiceProviders"));
const CrewMembers = lazy(() => import("./pages/CrewMembers"));
const Leaderboard = lazy(() => import("./pages/Leaderboard"));
const ImportParticipants = lazy(() => import("./pages/ImportParticipants"));
const ImportServiceProviders = lazy(() => import("./pages/ImportServiceProviders"));
const ImportCrew = lazy(() => import("./pages/ImportCrew"));
const StaffManagement = lazy(() => import("./pages/StaffManagement"));
const Events = lazy(() => import("./pages/Events"));
const Communications = lazy(() => import("./pages/Communications"));
const SystemHealth = lazy(() => import("./pages/SystemHealth"));
const ActivityTimeAnalytics = lazy(() => import("./pages/ActivityTimeAnalytics"));

// ── Suspense wrapper helper ────────────────────────────────────────────────────
function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageTransition />}>{children}</Suspense>;
}

export const routers = [
  { path: "/", name: "home", element: <Navigate to="/dashboard" replace /> },
  { path: "/login", name: "login", element: <Login /> },
  { path: "/setup", name: "setup", element: <Setup /> },

  // ── Public live pages (no auth) ─────────────────────────────────────────────
  { path: "/live", name: "live-index", element: <LiveIndex /> },
  { path: "/live/:slug", name: "live-event", element: <LiveEvent /> },
  { path: "/display", name: "display", element: <DisplayMode /> },
  { path: "/event/:eventId/join/:token", name: "event-join", element: <EventJoin /> },
  { path: "/event/:slug", name: "event-slug-join", element: <EventSlugJoin /> },

  // ── Protected + lazy ──────────────────────────────────────────────────────────
  {
    path: "/dashboard", name: "dashboard",
    element: <Lazy><ProtectedRoute><Dashboard /></ProtectedRoute></Lazy>,
  },
  {
    path: "/checkin", name: "checkin",
    element: <Lazy><ProtectedRoute allowGuests={true}><CheckIn /></ProtectedRoute></Lazy>,
  },
  {
    path: "/activity", name: "activity",
    element: <Lazy><ProtectedRoute allowGuests={true}><ActivityRecorder /></ProtectedRoute></Lazy>,
  },
  {
    path: "/participants", name: "participants",
    element: <Lazy><ProtectedRoute><Participants /></ProtectedRoute></Lazy>,
  },
  {
    path: "/service-providers", name: "service-providers",
    element: <Lazy><ProtectedRoute><ServiceProviders /></ProtectedRoute></Lazy>,
  },
  {
    path: "/crew", name: "crew",
    element: <Lazy><ProtectedRoute><CrewMembers /></ProtectedRoute></Lazy>,
  },
  {
    path: "/leaderboard", name: "leaderboard",
    element: <Lazy><ProtectedRoute><Leaderboard /></ProtectedRoute></Lazy>,
  },
  {
    path: "/communications", name: "communications",
    element: <Lazy><ProtectedRoute><Communications /></ProtectedRoute></Lazy>,
  },

  // ── Admin-only pages (no guest access) ────────────────────────────────────────
  {
    path: "/import", name: "import",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><ImportParticipants /></ProtectedRoute></Lazy>,
  },
  {
    path: "/import-providers", name: "import-providers",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><ImportServiceProviders /></ProtectedRoute></Lazy>,
  },
  {
    path: "/import-crew", name: "import-crew",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><ImportCrew /></ProtectedRoute></Lazy>,
  },
  {
    path: "/staff", name: "staff",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><StaffManagement /></ProtectedRoute></Lazy>,
  },
  {
    path: "/events", name: "events",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><Events /></ProtectedRoute></Lazy>,
  },
  {
    path: "/activities", name: "activities",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><Activities /></ProtectedRoute></Lazy>,
  },
  {
    path: "/analytics", name: "analytics",
    element: <Lazy><ProtectedRoute requiredRoles={["admin"]}><ActivityTimeAnalytics /></ProtectedRoute></Lazy>,
  },
  {
    path: "/system-health", name: "system-health",
    element: <Lazy><ProtectedRoute requiredRoles={["admin", "event_admin"]}><SystemHealth /></ProtectedRoute></Lazy>,
  },

  /* CATCH-ALL */
  { path: "*", name: "404", element: <NotFound /> },
];

declare global {
  interface Window { __routers__: typeof routers; }
}
window.__routers__ = routers;
