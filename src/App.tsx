import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { routers } from "./router";
import { AuthProvider } from "./contexts/AuthContext";
import { EventProvider } from "./contexts/EventContext";
import { NetworkProvider } from "./contexts/NetworkContext";
import { ActivitiesProvider } from "./contexts/ActivitiesContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { GuestProvider } from "./contexts/GuestContext";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// MUST be outside the component — recreating on every render unmounts all routes
const router = createBrowserRouter(routers);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <GuestProvider>
          <EventProvider>
            <ActivitiesProvider>
              <NetworkProvider>
                <TooltipProvider>
                  <Toaster />
                  <Sonner />
                  <RouterProvider router={router} />
                </TooltipProvider>
              </NetworkProvider>
            </ActivitiesProvider>
          </EventProvider>
        </GuestProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
