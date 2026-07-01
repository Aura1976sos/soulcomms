import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import { CalendarDays, MapPin, ExternalLink, Radio } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventRow {
  id: string;
  name: string;
  code: string;
  slug: string | null;
  date: string | null;
  venue: string | null;
  status: string;
}

export default function LiveIndex() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    supabase
      .from("events")
      .select("id, name, code, slug, date, venue, status")
      .in("status", ["active", "completed"])
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setEvents((data ?? []) as EventRow[]);
        setLoading(false);
      });
  }, []);

  const goToEvent = (event: EventRow) => {
    const slug = event.slug ?? event.code.toLowerCase();
    navigate(`/live/${slug}`);
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="border-b border-border px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <SoulcommsLogo size="sm" />
          <div>
            <p className="text-xs font-bold uppercase tracking-[3px] text-muted-foreground">
              Live Tracker
            </p>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-10 space-y-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-black text-foreground">Select an Event</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Choose an event to view its live attendance and activity statistics.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : events.length === 0 ? (
          <div className="glass-card rounded-2xl px-6 py-12 text-center text-muted-foreground">
            No active events found.
          </div>
        ) : (
          <div className="grid gap-4">
            {events.map(event => {
              const slug = event.slug ?? event.code.toLowerCase();
              const isActive = event.status === "active";
              return (
                <button
                  key={event.id}
                  onClick={() => goToEvent(event)}
                  className={cn(
                    "glass-card rounded-2xl p-6 w-full text-left transition-all duration-200",
                    "hover:border-primary/40 hover:shadow-glow-primary group",
                    isActive && "border-primary/20"
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <h2 className="text-lg font-black text-foreground">{event.name}</h2>
                        {isActive && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 border border-success/30 text-[10px] font-black text-success uppercase tracking-wider">
                            <Radio className="h-2.5 w-2.5" />Live
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
                        <span className="font-mono font-bold">{event.code}</span>
                        {event.date && (
                          <span className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            {new Date(event.date).toLocaleDateString("en-GB", {
                              day: "numeric", month: "short", year: "numeric",
                            })}
                          </span>
                        )}
                        {event.venue && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" />
                            {event.venue}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mt-2 font-mono">
                        /live/{slug}
                      </p>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>

      <footer className="border-t border-border px-6 py-4 text-center">
        <p className="text-xs text-muted-foreground">
          Powered by <span className="text-primary font-bold">SOULCOMMS</span>
        </p>
      </footer>
    </div>
  );
}
