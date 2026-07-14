import { useState, useRef, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { useNavigate } from "react-router-dom";
import { useGuest } from "@/contexts/GuestContext";
import { useNetwork } from "@/contexts/NetworkContext";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { QrScannerModal } from "@/components/checkin/QrScannerModal";
import { WalkInModal } from "@/components/checkin/WalkInModal";
import { WalkInCrewModal } from "@/components/checkin/WalkInCrewModal";
import { WalkInSPModal } from "@/components/checkin/WalkInSPModal";
import { QrRegisterModal } from "@/components/checkin/QrRegisterModal";
import { BulkCheckInModal } from "@/components/checkin/BulkCheckInModal";
import {
  CheckCircle, XCircle, ScanLine, RotateCcw, AlertTriangle,
  Users, Briefcase, HardHat, QrCode, Keyboard, UserPlus,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  offlineLookupParticipant, offlineLookupSP, offlineLookupCrew,
  localCheckIn, queueMutation,
} from "@/lib/offlineStore";
import { speak, VM } from "@/lib/voice";
import { trackEvent } from "@enter-pro/analytics-sdk";

// ─── Types ───────────────────────────────────────────────────────────
export type AttendeeType = "participant" | "service_provider" | "crew";
type CheckInStatus = "idle" | "success" | "already" | "not_found" | "error";
type InputMethod = "manual" | "qr";

interface ResultData {
  code: string;
  primaryLabel: string;
  secondaryLabel?: string;
  type: AttendeeType;
  method: InputMethod;
}

// ─── Config ──────────────────────────────────────────────────────────
const TYPE_CONFIG: Record<
  AttendeeType,
  {
    label: string;
    badge: string;
    icon: typeof Users;
    color: string;
    primaryField: string;
    secondaryField: string | null;
  }
> = {
  participant: {
    label: "Participant",
    badge: "Participant",
    icon: Users,
    color: "hsl(0 85% 52%)",
    primaryField: "name",
    secondaryField: "phone",
  },
  service_provider: {
    label: "Service Provider",
    badge: "Service Provider",
    icon: Briefcase,
    color: "hsl(200 85% 55%)",
    primaryField: "brand_name",
    secondaryField: "contact_person",
  },
  crew: {
    label: "Crew Member",
    badge: "Crew",
    icon: HardHat,
    color: "hsl(142 72% 45%)",
    primaryField: "name",
    secondaryField: "department",
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("Request timed out")), ms)
    ),
  ]);
}

async function findParticipantOnlineByQrOrCode(raw: string, eventId: string, method: InputMethod) {
  const trimmed = raw.trim();
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, "0") : trimmed;

  if (method === "qr") {
    const { data: qrData, error: qrError } = await withTimeout(
      supabase.from("participants")
        .select("id, code, name, phone, is_checked_in")
        .eq("event_id", eventId)
        .eq("qr_link", trimmed)
        .limit(1)
        .maybeSingle()
    );
    if (qrError) throw new Error(qrError.message);
    if (qrData) return qrData;
  }

  const { data, error } = await withTimeout(
    supabase.from("participants")
      .select("id, code, name, phone, is_checked_in")
      .eq("event_id", eventId)
      .or(`code.eq.${trimmed},code.eq.${padded}`)
      .limit(1)
      .maybeSingle()
  );
  if (error) throw new Error(error.message);
  return data;
}

async function findServiceProviderOnlineByQrOrCode(raw: string, eventId: string, method: InputMethod) {
  const trimmed = raw.trim();
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, "0") : trimmed;

  if (method === "qr") {
    const { data: qrData, error: qrError } = await withTimeout(
      supabase.from("service_providers")
        .select("id, code, brand_name, contact_person, is_checked_in")
        .eq("event_id", eventId)
        .eq("qr_link", trimmed)
        .limit(1)
        .maybeSingle()
    );
    if (qrError) throw new Error(qrError.message);
    if (qrData) return qrData;
  }

  const { data, error } = await withTimeout(
    supabase.from("service_providers")
      .select("id, code, brand_name, contact_person, is_checked_in")
      .eq("event_id", eventId)
      .or(`code.eq.${trimmed},code.eq.${padded}`)
      .limit(1)
      .maybeSingle()
  );
  if (error) throw new Error(error.message);
  return data;
}

async function findCrewOnlineByQrOrCode(raw: string, eventId: string, method: InputMethod) {
  const trimmed = raw.trim();
  const padded = /^\d+$/.test(trimmed) ? trimmed.padStart(4, "0") : trimmed;

  if (method === "qr") {
    const { data: qrData, error: qrError } = await withTimeout(
      supabase.from("crew_members")
        .select("id, code, name, department, is_checked_in")
        .eq("event_id", eventId)
        .eq("qr_link", trimmed)
        .limit(1)
        .maybeSingle()
    );
    if (qrError) throw new Error(qrError.message);
    if (qrData) return qrData;
  }

  const { data, error } = await withTimeout(
    supabase.from("crew_members")
      .select("id, code, name, department, is_checked_in")
      .eq("event_id", eventId)
      .or(`code.eq.${trimmed},code.eq.${padded}`)
      .limit(1)
      .maybeSingle()
  );
  if (error) throw new Error(error.message);
  return data;
}

// ─── Component ───────────────────────────────────────────────────────
export default function CheckIn() {
  const [attendeeType, setAttendeeType] = useState<AttendeeType>("participant");
  const [inputMethod, setInputMethod] = useState<InputMethod>("manual");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<CheckInStatus>("idle");
  const [result, setResult] = useState<ResultData | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [showScanner, setShowScanner] = useState(false);
  const [showWalkIn, setShowWalkIn] = useState(false);
  const [showWalkInCrew, setShowWalkInCrew] = useState(false);
  const [showWalkInSP, setShowWalkInSP] = useState(false);
  const [showQrRegister, setShowQrRegister] = useState(false);
  const [showBulkCheckIn, setShowBulkCheckIn] = useState(false);
  const [lastQrUrl, setLastQrUrl] = useState<string | null>(null);
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);

  const [counts, setCounts] = useState({ participant: 0, service_provider: 0, crew: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  // Tracks last scan context for voice announcements
  const lastScanCtx = useRef<{ isQr: boolean; type: AttendeeType }>({ isQr: false, type: "participant" });
  const { activeEvent } = useEvent();
  const { guestSession, isGuestMode } = useGuest();
  const { online, refreshPending } = useNetwork();
  const { profile } = useAuth();
  const navigate = useNavigate();

  const cfg = TYPE_CONFIG[attendeeType];
  const totalCheckedIn = counts.participant + counts.service_provider + counts.crew;
  const eventId = isGuestMode ? guestSession?.eventId ?? "" : activeEvent?.id ?? "";

  // ── Voice announcements ───────────────────────────────────────────────────
  useEffect(() => {
    if (status === "idle") return;
    const { isQr, type } = lastScanCtx.current;
    if (status === "success") {
      speak(type === "participant" ? VM.checkin_success : type === "service_provider" ? VM.sp_success : VM.crew_success);
    } else if (status === "already") {
      speak(type === "participant" ? VM.checkin_already : type === "service_provider" ? VM.sp_already : VM.crew_already);
    } else if (status === "not_found") {
      speak(isQr && type === "participant" ? VM.checkin_qr_not_found : type === "participant" ? VM.checkin_not_found : type === "service_provider" ? VM.sp_not_found : VM.crew_not_found);
    }
  }, [status]);

  // ── Core lookup + check-in logic ──────────────────────────────────
  const performCheckIn = async (raw: string, method: InputMethod) => {
    if (!raw.trim()) return;
    const trimmed = raw.trim();
    const isQrLookup = method === "qr";
    lastScanCtx.current = { isQr: isQrLookup, type: attendeeType };

    setLoading(true);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setIsOfflineQueued(false);

    // Track QR scan attempts
    if (method === "qr") {
      trackEvent("qr_scan_attempted", {
        eventType: "custom",
        properties: { attendee_type: attendeeType },
      });
    }

    try {
      // ── OFFLINE path ─────────────────────────────────────────────
      if (!online) {
        let record: { id: string; code: string; is_checked_in: boolean;[key: string]: unknown } | null = null;

        if (attendeeType === "participant") {
          record = await offlineLookupParticipant(trimmed, eventId);
        } else if (attendeeType === "service_provider") {
          record = await offlineLookupSP(trimmed, eventId);
        } else {
          record = await offlineLookupCrew(trimmed, eventId);
        }

        if (!record) {
          setStatus("not_found");
          // Only offer QR registration when the QR camera scanner was used
          if (isQrLookup && attendeeType === "participant") setLastQrUrl(trimmed);
          return;
        }

        if (record.is_checked_in) {
          setStatus("already");
          setResult({
            code: record.code,
            primaryLabel: String(record[cfg.primaryField] ?? ""),
            secondaryLabel: cfg.secondaryField ? String(record[cfg.secondaryField] ?? "") || undefined : undefined,
            type: attendeeType,
            method,
          });
          return;
        }

        const updatePayload = {
          id: record.id,
          is_checked_in: true,
          checked_in_at: new Date().toISOString(),
          check_in_method: method === "qr" ? "QR Scan" : "Manual Code",
          event_id: eventId,
        };

        const mutationType = attendeeType === "participant"
          ? "checkin_participant" as const
          : attendeeType === "service_provider"
            ? "checkin_sp" as const
            : "checkin_crew" as const;

        await queueMutation(mutationType, updatePayload);
        await localCheckIn(
          attendeeType === "participant" ? "participants"
            : attendeeType === "service_provider" ? "service_providers"
              : "crew_members",
          record.id
        );

        setStatus("success");
        setIsOfflineQueued(true);
        setResult({
          code: record.code,
          primaryLabel: String(record[cfg.primaryField] ?? ""),
          secondaryLabel: cfg.secondaryField ? String(record[cfg.secondaryField] ?? "") || undefined : undefined,
          type: attendeeType,
          method,
        });
        setCounts(c => ({ ...c, [attendeeType]: c[attendeeType] + 1 }));
        trackEvent("participant_checked_in", {
          eventType: "conversion",
          properties: { attendee_type: attendeeType, method, mode: "offline" },
        });
        await refreshPending();
        return;
      }

      // ── ONLINE path ──────────────────────────────────────────────
      let record: { id: string; code: string; is_checked_in: boolean;[key: string]: unknown } | null = null;

      if (attendeeType === "participant") {
        record = await findParticipantOnlineByQrOrCode(trimmed, eventId, method);

      } else if (attendeeType === "service_provider") {
        record = await findServiceProviderOnlineByQrOrCode(trimmed, eventId, method);

      } else {
        record = await findCrewOnlineByQrOrCode(trimmed, eventId, method);
      }

      if (!record) {
        setStatus("not_found");
        // Only offer QR registration when the QR camera scanner was used
        if (isQrLookup && attendeeType === "participant") setLastQrUrl(trimmed);
        return;
      }

      if (record.is_checked_in) {
        setStatus("already");
        setResult({
          code: record.code,
          primaryLabel: String(record[cfg.primaryField] ?? ""),
          secondaryLabel: cfg.secondaryField ? String(record[cfg.secondaryField] ?? "") || undefined : undefined,
          type: attendeeType,
          method,
        });
        return;
      }

      // Perform check-in + store method
      const updatePayload = {
        is_checked_in: true,
        checked_in_at: new Date().toISOString(),
        check_in_method: method === "qr" ? "QR Scan" : "Manual Code",
      };

      if (attendeeType === "participant") {
        const { error } = await withTimeout(
          supabase.from("participants").update(updatePayload).eq("id", record.id).select("id")
        );
        if (error) throw new Error(error.message);
      } else if (attendeeType === "service_provider") {
        const { error } = await withTimeout(
          supabase.from("service_providers").update(updatePayload).eq("id", record.id).select("id")
        );
        if (error) throw new Error(error.message);
      } else {
        const { error } = await withTimeout(
          supabase.from("crew_members").update(updatePayload).eq("id", record.id).select("id")
        );
        if (error) throw new Error(error.message);
      }

      setStatus("success");
      setResult({
        code: record.code,
        primaryLabel: String(record[cfg.primaryField] ?? ""),
        secondaryLabel: cfg.secondaryField ? String(record[cfg.secondaryField] ?? "") || undefined : undefined,
        type: attendeeType,
        method,
      });
      setCounts(c => ({ ...c, [attendeeType]: c[attendeeType] + 1 }));
      trackEvent("participant_checked_in", {
        eventType: "conversion",
        properties: { attendee_type: attendeeType, method, mode: "online" },
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setStatus("error");
      setErrorMsg(msg.includes("timed out") ? "Request timed out. Check your connection." : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleManualSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    performCheckIn(code, "manual");
  };

  const handleQrScan = (value: string) => {
    setCode(value);
    performCheckIn(value, "qr");
  };

  const handleReset = () => {
    setCode("");
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setLastQrUrl(null);
    setTimeout(() => { if (inputMethod === "manual") inputRef.current?.focus(); }, 50);
  };

  const typeBorderClass: Record<CheckInStatus, string> = {
    idle: "border-border",
    success: "border-success",
    already: "border-primary",
    not_found: "border-destructive",
    error: "border-destructive",
  };

  return (
    <AppLayout title="Check-In Station" subtitle="Select category and check-in method">
      <div className="max-w-lg mx-auto space-y-5">

        {/* Step 1 — Category */}
        <div className="glass-card rounded-2xl p-5">
          <p className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-3">
            Step 1 — Select Category
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.entries(TYPE_CONFIG) as [AttendeeType, typeof TYPE_CONFIG[AttendeeType]][]).map(([key, c]) => {
              const Icon = c.icon;
              const isActive = attendeeType === key;
              return (
                <button
                  key={key}
                  onClick={() => { setAttendeeType(key); handleReset(); }}
                  className={cn(
                    "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all duration-150 text-center",
                    isActive
                      ? "border-primary bg-primary/10 shadow-glow-primary"
                      : "border-border bg-secondary hover:border-primary/40"
                  )}
                >
                  <div className="w-8 h-8 rounded-full flex items-center justify-center"
                    style={{ backgroundColor: `${c.color}22` }}>
                    <Icon className="h-4 w-4" style={{ color: isActive ? c.color : undefined }} />
                  </div>
                  <span className={cn("text-xs font-bold leading-tight",
                    isActive ? "text-foreground" : "text-muted-foreground")}>
                    {c.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 — Method tabs */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-border">
            <button
              onClick={() => { setInputMethod("manual"); handleReset(); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3.5 text-sm font-bold transition-all",
                inputMethod === "manual"
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <Keyboard className="h-4 w-4" />
              Manual Code
            </button>
            <button
              onClick={() => { setInputMethod("qr"); handleReset(); }}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3.5 text-sm font-bold transition-all",
                inputMethod === "qr"
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
              )}
            >
              <QrCode className="h-4 w-4" />
              Scan QR
            </button>
          </div>

          {/* Manual entry */}
          {inputMethod === "manual" && (
            <div className="p-7">
              <div className="text-center mb-5">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 mb-3">
                  <ScanLine className="h-5 w-5 text-primary" />
                </div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground">
                  Enter {cfg.label} Code
                </p>
              </div>
              <form onSubmit={handleManualSubmit} className="space-y-4">
                <Input
                  ref={inputRef}
                  value={code}
                  onChange={e => {
                    const val = e.target.value;
                    if (attendeeType === "participant") {
                      setCode(val.slice(0, 200));
                    } else {
                      setCode(val.replace(/\D/g, "").slice(0, 6));
                    }
                  }}
                  placeholder={attendeeType === "participant" ? "Code or paste QR link" : "0000"}
                  className={cn(
                    "h-20 bg-secondary border-2 focus:border-primary scan-pulse",
                    code.startsWith("http")
                      ? "text-center text-sm font-medium tracking-normal"
                      : "text-center text-4xl font-black tracking-[12px]",
                    typeBorderClass[status]
                  )}
                  maxLength={attendeeType === "participant" ? 200 : 6}
                  autoFocus
                  disabled={loading}
                />
                <Button
                  type="submit"
                  disabled={loading || code.length === 0}
                  className="w-full h-14 text-base font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90"
                >
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                      Checking...
                    </span>
                  ) : `Check In ${cfg.label}`}
                </Button>
              </form>
            </div>
          )}

          {/* QR scan */}
          {inputMethod === "qr" && (
            <div className="p-7 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/20 mb-3">
                <QrCode className="h-5 w-5 text-primary" />
              </div>
              <p className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground mb-1">
                QR Code Scanner
              </p>
              <p className="text-xs text-muted-foreground mb-5">
                Point the camera at the attendee's QR code
              </p>

              {/* Last scanned + QR-not-found inline action */}
              {code && !loading && status === "not_found" && lastQrUrl && attendeeType === "participant" ? (
                <div className="mb-5 space-y-3">
                  <div className="px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-xl text-left">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-destructive mb-1">QR Not in Database</p>
                    <p className="text-xs font-mono text-foreground truncate">{code}</p>
                  </div>
                  <Button
                    onClick={() => setShowQrRegister(true)}
                    className="w-full h-12 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
                  >
                    <UserPlus className="h-4 w-4" />
                    Add Participant &amp; Check In
                  </Button>
                </div>
              ) : code && !loading ? (
                <div className="mb-5 px-4 py-3 bg-secondary rounded-xl text-left">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Last Scanned</p>
                  <p className="text-xs font-mono text-foreground truncate">{code}</p>
                </div>
              ) : null}

              <Button
                onClick={() => setShowScanner(true)}
                disabled={loading}
                className="w-full h-14 text-base font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 gap-3"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-5 h-5 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Processing QR...
                  </span>
                ) : (
                  <>
                    <QrCode className="h-5 w-5" />
                    {status === "not_found" && lastQrUrl ? "Scan Again" : "Open Camera Scanner"}
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-3">
                Works on webcam · laptop · iPhone · Android
              </p>
            </div>
          )}
        </div>

        {/* ── Result Cards ── */}
        {status === "success" && result && (
          <div className="glass-card rounded-2xl p-6 slide-up border-2 border-success/50">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-full bg-success/20 shrink-0">
                <CheckCircle className="h-7 w-7 text-success" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[2px] text-success mb-1">
                  Check-In Successful{isOfflineQueued ? " (Queued)" : ""}
                </p>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-xs font-bold text-primary">
                    {TYPE_CONFIG[result.type].badge}
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary border border-border text-[10px] font-semibold text-muted-foreground">
                    {result.method === "qr" ? <><QrCode className="h-3 w-3" />QR Scan</> : <><Keyboard className="h-3 w-3" />Manual</>}
                  </span>
                  {isOfflineQueued && (
                    <span className="px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-[10px] font-semibold text-amber-400">
                      Offline · Queued
                    </span>
                  )}
                </div>
                <h3 className="text-2xl font-black text-foreground">{result.primaryLabel}</h3>
                <p className="text-sm font-mono text-muted-foreground mt-0.5">#{result.code}</p>
                {result.secondaryLabel && (
                  <p className="text-xs text-muted-foreground mt-0.5">{result.secondaryLabel}</p>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full mt-4 gap-2 border-border">
              <RotateCcw className="h-4 w-4" /> Next Scan
            </Button>
          </div>
        )}

        {status === "already" && result && (
          <div className="glass-card rounded-2xl p-6 slide-up border-2 border-primary/50">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-full bg-primary/20 shrink-0">
                <AlertTriangle className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[2px] text-primary mb-1">Already Checked In</p>
                <h3 className="text-2xl font-black text-foreground">{result.primaryLabel}</h3>
                <p className="text-sm font-mono text-muted-foreground mt-0.5">#{result.code}</p>
                {result.secondaryLabel && (
                  <p className="text-xs text-muted-foreground mt-0.5">{result.secondaryLabel}</p>
                )}
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full mt-4 gap-2 border-border">
              <RotateCcw className="h-4 w-4" /> Next Scan
            </Button>
          </div>
        )}

        {status === "not_found" && (
          <div className="glass-card rounded-2xl p-6 slide-up border-2 border-destructive/50">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-full bg-destructive/20 shrink-0">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[2px] text-destructive mb-1">Not Found</p>
                <h3 className="text-xl font-black text-foreground">No {cfg.label.toLowerCase()} found</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {lastQrUrl
                    ? "QR not in database — use the button above to register."
                    : attendeeType === "participant"
                      ? "Code not found. Register this person as a new participant below."
                      : "Check the code and try again."}
                </p>
              </div>
            </div>

            {/* Manual mode — show Add Participant shortcut */}
            {attendeeType === "participant" && inputMethod === "manual" && (
              <Button
                onClick={() => setShowWalkIn(true)}
                className="w-full mt-4 gap-2 bg-primary text-primary-foreground hover:bg-primary/90 font-bold h-12"
              >
                <UserPlus className="h-4 w-4" />
                Add Participant &amp; Check In
              </Button>
            )}

            <Button variant="outline" onClick={handleReset}
              className={cn("w-full gap-2 border-border", attendeeType === "participant" ? "mt-2" : "mt-4")}>
              <RotateCcw className="h-4 w-4" /> Try Again
            </Button>
          </div>
        )}

        {status === "error" && (
          <div className="glass-card rounded-2xl p-6 slide-up border-2 border-destructive/50">
            <div className="flex items-start gap-4">
              <div className="p-3 rounded-full bg-destructive/20 shrink-0">
                <XCircle className="h-7 w-7 text-destructive" />
              </div>
              <div className="flex-1">
                <p className="text-xs font-bold uppercase tracking-[2px] text-destructive mb-1">Error</p>
                <p className="text-sm text-muted-foreground">{errorMsg || "Please try again."}</p>
              </div>
            </div>
            <Button variant="outline" onClick={handleReset} className="w-full mt-4 gap-2 border-border">
              <RotateCcw className="h-4 w-4" /> Try Again
            </Button>
          </div>
        )}

        {/* Session counters */}
        <div className="glass-card rounded-xl px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-[2px] text-muted-foreground">Session Total</span>
            <span className="text-xl font-black text-primary">{totalCheckedIn} checked in</span>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(Object.entries(counts) as [AttendeeType, number][]).map(([type, count]) => {
              const c = TYPE_CONFIG[type];
              const Icon = c.icon;
              return (
                <div key={type} className="flex flex-col items-center gap-1 bg-secondary rounded-xl py-2 px-3">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-lg font-black text-foreground">{count}</span>
                  <span className="text-[10px] font-semibold text-muted-foreground text-center leading-tight">{c.badge}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Bulk Check-In */}
        <div className="glass-card rounded-xl px-5 py-4 border border-dashed border-primary/30">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-foreground">Bulk Check-In</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Check in multiple {cfg.label.toLowerCase()}s at once via codes, QR scan, or CSV upload.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowBulkCheckIn(true)}
              className="shrink-0 gap-1.5 border-primary/40 text-primary hover:bg-primary/10 font-bold"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Bulk
            </Button>
          </div>
        </div>
        <div className="glass-card rounded-xl px-5 py-4 border border-dashed border-border">
          {attendeeType === "participant" && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-foreground">Walk-In Registration</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Participant not pre-registered? Register and check in instantly.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowWalkIn(true)}
                className="shrink-0 gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 font-bold"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Walk-In
              </Button>
            </div>
          )}
          {attendeeType === "crew" && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-foreground">Walk-In Crew Registration</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  Crew member not on list? Register and check in instantly.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowWalkInCrew(true)}
                className="shrink-0 gap-1.5 bg-success text-white hover:bg-success/90 font-bold"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Register Crew
              </Button>
            </div>
          )}
          {attendeeType === "service_provider" && (
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-foreground">Walk-In Service Provider</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  New vendor or sponsor? Register and check in instantly.
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => setShowWalkInSP(true)}
                className="shrink-0 gap-1.5 bg-blue-600 text-white hover:bg-blue-700 font-bold"
              >
                <UserPlus className="h-3.5 w-3.5" />
                Register SP
              </Button>
            </div>
          )}
        </div>

      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <QrScannerModal
          onScan={handleQrScan}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Bulk Check-In Modal */}
      {showBulkCheckIn && activeEvent && (
        <BulkCheckInModal
          eventId={activeEvent.id}
          attendeeType={attendeeType}
          online={online}
          onClose={() => setShowBulkCheckIn(false)}
          onDone={n => {
            setCounts(c => ({ ...c, [attendeeType]: c[attendeeType] + n }));
            refreshPending();
          }}
        />
      )}

      {/* Walk-In Modal */}
      {showWalkIn && activeEvent && (
        <WalkInModal
          eventId={activeEvent.id}
          onClose={() => setShowWalkIn(false)}
          onRegistered={(_, checkedIn) => {
            setShowWalkIn(false);
            if (checkedIn) {
              speak(VM.walkin_complete);
              setCounts(c => ({ ...c, participant: c.participant + 1 }));
              refreshPending();
            }
          }}
        />
      )}

      {/* QR Register Modal */}
      {showQrRegister && lastQrUrl && activeEvent && (
        <QrRegisterModal
          qrUrl={lastQrUrl}
          eventId={activeEvent.id}
          onClose={() => setShowQrRegister(false)}
          onRegistered={(_, checkedIn) => {
            setShowQrRegister(false);
            if (checkedIn) {
              speak(VM.qr_registered);
              setCounts(c => ({ ...c, participant: c.participant + 1 }));
              refreshPending();
            }
            handleReset();
          }}
        />
      )}

      {/* Walk-In Crew Modal */}
      {showWalkInCrew && activeEvent && (
        <WalkInCrewModal
          eventId={activeEvent.id}
          onClose={() => setShowWalkInCrew(false)}
          onRegistered={() => {
            setShowWalkInCrew(false);
            speak(VM.crew_success);
            setCounts(c => ({ ...c, crew: c.crew + 1 }));
            refreshPending();
          }}
        />
      )}

      {/* Walk-In SP Modal */}
      {showWalkInSP && activeEvent && (
        <WalkInSPModal
          eventId={activeEvent.id}
          onClose={() => setShowWalkInSP(false)}
          onRegistered={() => {
            setShowWalkInSP(false);
            speak(VM.sp_success);
            setCounts(c => ({ ...c, service_provider: c.service_provider + 1 }));
            refreshPending();
          }}
        />
      )}
    </AppLayout>
  );
}
