import { useState, useCallback, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { useGuest } from "@/contexts/GuestContext";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ParticipantCard, type UncheckHistoryRecord } from "@/components/participants/ParticipantCard";
import { UncheckModal } from "@/components/checkin/UncheckModal";
import { Search, Hash, UserCheck, Clock, Download, X, ChevronRight, Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface Participant {
  id: string;
  code: string;
  name: string;
  phone?: string;
  is_checked_in: boolean;
  checked_in_at?: string;
}

interface ActivityLog {
  id: string;
  experience: string;
  recorded_at: string;
}

const PAGE_SIZE = 50;

export default function Participants() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Participant[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [selected, setSelected] = useState<Participant | null>(null);
  const [activities, setActivities] = useState<ActivityLog[]>([]);
  const [uncheckHistory, setUncheckHistory] = useState<UncheckHistoryRecord[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [filterStatus, setFilterStatus] = useState<"all" | "checked_in" | "not_checked_in">("all");
  const [hasSearched, setHasSearched] = useState(false);
  const [showUncheck, setShowUncheck] = useState(false);
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { role } = useAuth();
  const canUncheck = role === "admin" || role === "event_admin";
  const currentEventId = isGuestMode ? guestSession?.eventId : activeEvent?.id;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string, status: typeof filterStatus) => {
    setLoadingList(true);
    setHasSearched(true);

    let queryBuilder = supabase
      .from("participants")
      .select("id, code, name, phone, is_checked_in, checked_in_at", { count: "exact" })
      .order("code", { ascending: true })
      .limit(PAGE_SIZE);

    if (currentEventId) queryBuilder = queryBuilder.eq("event_id", currentEventId);

    // Status filter
    if (status === "checked_in") queryBuilder = queryBuilder.eq("is_checked_in", true);
    if (status === "not_checked_in") queryBuilder = queryBuilder.eq("is_checked_in", false);

    // Text search — code, name, phone, or QR link
    if (q.trim()) {
      const trimmed = q.trim();
      const isCode = /^\d+$/.test(trimmed);
      const isQrLink = trimmed.startsWith("http");
      if (isQrLink) {
        queryBuilder = queryBuilder.eq("qr_link", trimmed);
      } else if (isCode) {
        queryBuilder = queryBuilder.or(
          `code.eq.${trimmed},code.eq.${trimmed.padStart(4, "0")},code.ilike.%${trimmed}%`
        );
      } else {
        queryBuilder = queryBuilder.or(
          `name.ilike.%${trimmed}%,phone.ilike.%${trimmed}%`
        );
      }
    }

    const { data, count } = await queryBuilder;
    setResults((data ?? []) as Participant[]);
    setTotal(count ?? null);
    setLoadingList(false);
  }, [currentEventId]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value, filterStatus), 300);
  };

  const handleStatusChange = (status: typeof filterStatus) => {
    setFilterStatus(status);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    search(query, status);
  };

  const handleSelectParticipant = async (p: Participant) => {
    setSelected(p);
    setLoadingProfile(true);
    const [{ data: logs }, { data: history }] = await Promise.all([
      supabase
        .from("activity_logs")
        .select("id, experience, recorded_at")
        .eq("participant_id", p.id)
        .order("recorded_at", { ascending: false }),
      supabase
        .from("checkin_history")
        .select("id, unchecked_by_name, unchecked_at, reason, original_checked_in_at")
        .eq("record_id", p.id)
        .order("unchecked_at", { ascending: false }),
    ]);
    setActivities((logs ?? []) as ActivityLog[]);
    setUncheckHistory((history ?? []) as UncheckHistoryRecord[]);
    setLoadingProfile(false);
  };

  const handleExport = async () => {
    let q = supabase
      .from("participants")
      .select("code, name, phone, is_checked_in")
      .order("code", { ascending: true });
    if (currentEventId) q = q.eq("event_id", currentEventId);
    const { data } = await q;

    if (!data) return;
    const rows = [
      ["Code", "Name", "Phone", "Status"],
      ...data.map((p: { code: string; name: string; phone?: string; is_checked_in: boolean }) => [
        `TG100 #${p.code}`, p.name, p.phone ?? "",
        p.is_checked_in ? "Checked In" : "Not Checked In",
      ]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tg100_participants.csv";
    a.click();
  };

  return (
    <AppLayout title="Participants" subtitle="Search by wristband code or name">
      <div className="flex gap-6" style={{ minHeight: "calc(100vh - 120px)" }}>

        {/* Left: search + list */}
        <div className={cn("flex flex-col gap-4 flex-1 min-w-0", selected && "hidden lg:flex")}>
          {/* Search bar */}
          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={e => handleQueryChange(e.target.value)}
                placeholder="Search by code (0142) or name..."
                className="pl-10 h-11 bg-secondary border-border focus:border-primary"
                autoFocus
              />
              {query && (
                <button onClick={() => handleQueryChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {(["all", "checked_in", "not_checked_in"] as const).map(s => (
                <button
                  key={s}
                  onClick={() => handleStatusChange(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border",
                    filterStatus === s
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-secondary border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {s === "all" ? "All" : s === "checked_in" ? "Checked In" : "Not Checked In"}
                </button>
              ))}
              {total !== null && (
                <span className="ml-auto text-xs text-muted-foreground">
                  {total > PAGE_SIZE ? `${PAGE_SIZE}+ of ${total.toLocaleString()}` : `${total} result${total !== 1 ? "s" : ""}`}
                </span>
              )}
              <Button variant="outline" size="sm" onClick={handleExport} className="gap-1.5 border-border text-muted-foreground text-xs h-8">
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
            </div>
          </div>

          {/* Results */}
          <div className="glass-card rounded-2xl overflow-hidden flex-1">
            {loadingList ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 bg-secondary rounded-xl animate-pulse" style={{ animationDelay: `${i * 50}ms` }} />
                ))}
              </div>
            ) : !hasSearched ? (
              <div className="px-6 py-16 text-center flex flex-col items-center gap-3">
                <div className="p-4 rounded-full bg-secondary">
                  <Hash className="h-8 w-8 text-muted-foreground opacity-50" />
                </div>
                <p className="text-sm font-semibold text-foreground">Start typing to search</p>
                <p className="text-xs text-muted-foreground max-w-xs">
                  Enter a 4-digit wristband code or a participant name. Results appear instantly.
                </p>
                <Button variant="outline" size="sm" className="mt-2 gap-2 border-border" onClick={() => search("", filterStatus)}>
                  <Users className="h-3.5 w-3.5" />
                  Browse All
                </Button>
              </div>
            ) : results.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <Search className="h-8 w-8 text-muted-foreground mx-auto mb-3 opacity-40" />
                <p className="text-sm text-muted-foreground">No results for <span className="text-foreground font-semibold">"{query}"</span></p>
              </div>
            ) : (
              <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "calc(100vh - 300px)" }}>
                {results.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handleSelectParticipant(p)}
                    className={cn(
                      "w-full flex items-center gap-4 px-5 py-3.5 text-left hover:bg-secondary/50 transition-colors",
                      selected?.id === p.id && "bg-primary/10 border-l-2 border-primary"
                    )}
                  >
                    <div className="w-9 h-9 rounded-full bg-secondary border border-border flex items-center justify-center text-sm font-bold text-foreground shrink-0">
                      {p.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground truncate">{p.name}</span>
                        {p.is_checked_in && <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-success" />}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs font-mono font-bold text-primary">#{p.code}</span>
                        {p.phone && <span className="text-xs text-muted-foreground truncate">{p.phone}</span>}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2">
                      {p.is_checked_in
                        ? <UserCheck className="h-4 w-4 text-success" />
                        : <Clock className="h-4 w-4 text-muted-foreground" />}
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
                {total !== null && total > PAGE_SIZE && (
                  <div className="px-5 py-3 text-center text-xs text-muted-foreground">
                    Showing first {PAGE_SIZE} results. Refine your search to narrow down.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: profile panel */}
        <div className={cn("w-full lg:w-[420px] shrink-0", !selected && "hidden lg:block")}>
          {selected ? (
            <div className="space-y-4">
              <button
                onClick={() => setSelected(null)}
                className="lg:hidden flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
                Back to list
              </button>

              {loadingProfile ? (
                <div className="glass-card rounded-2xl p-10 text-center">
                  <div className="w-6 h-6 border-2 border-border border-t-primary rounded-full animate-spin mx-auto" />
                </div>
              ) : (
                <ParticipantCard
                  code={selected.code}
                  name={selected.name}
                  phone={selected.phone}
                  isCheckedIn={selected.is_checked_in}
                  checkedInAt={selected.checked_in_at}
                  activities={activities}
                  canUncheck={canUncheck}
                  uncheckHistory={uncheckHistory}
                  onUncheck={() => setShowUncheck(true)}
                />
              )}

              {showUncheck && selected && currentEventId && (
                <UncheckModal
                  type="participant"
                  id={selected.id}
                  name={selected.name}
                  code={selected.code}
                  checkedInAt={selected.checked_in_at}
                  eventId={currentEventId}
                  onClose={() => setShowUncheck(false)}
                  onSuccess={() => {
                    setShowUncheck(false);
                    setSelected(prev => prev ? { ...prev, is_checked_in: false, checked_in_at: undefined } : null);
                    search(query, filterStatus);
                    if (selected) handleSelectParticipant({ ...selected, is_checked_in: false });
                  }}
                />
              )}
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-10 text-center h-64 flex flex-col items-center justify-center">
              <Hash className="h-10 w-10 text-muted-foreground mb-4 opacity-30" />
              <p className="text-sm font-semibold text-foreground">Select a participant</p>
              <p className="text-xs text-muted-foreground mt-1">Click any name from the list to view their profile.</p>
            </div>
          )}
        </div>

      </div>
    </AppLayout>
  );
}
