import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import {
  CheckCircle2, XCircle, Clock, ScanLine, FlipHorizontal, CameraOff, RefreshCw,
  Keyboard, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────
type ScanResult = {
  status: "valid" | "already_verified" | "invalid";
  participantName?: string;
  participantCode?: string;
  activityName?: string;
  sessionTime?: string;
  participationCode?: string;
};

// ─── QR Validator Tab ─────────────────────────────────────────────────────────
interface Props {
  eventId: string;
}

export function QrValidatorTab({ eventId }: Props) {
  const { user } = useAuth();

  // ── Mode ──────────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<"qr" | "manual">("qr");
  const [manualCode, setManualCode] = useState("");
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualResult, setManualResult] = useState<ScanResult | null>(null);

  // ── Camera / QR state ─────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(true);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [history, setHistory] = useState<Array<ScanResult & { ts: number }>>([]);

  const stopStream = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const scanLoop = useCallback(() => {
    const tick = () => {
      if (!scanning) { animRef.current = requestAnimationFrame(tick); return; }
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { animRef.current = requestAnimationFrame(tick); return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(tick); return; }
      ctx.drawImage(video, 0, 0);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code?.data && !processingRef.current) {
        processingRef.current = true;
        handleQrScan(code.data);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning]);

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    stopStream();
    processingRef.current = false;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scanLoop();
      }
    } catch {
      setCameraError("Camera unavailable. Check permissions.");
    }
  }, [scanLoop]);

  const validateCode = async (rawCode: string): Promise<ScanResult> => {
    // Parse JSON QR or fall back to raw string
    let lookupCode = rawCode.trim();
    try {
      const parsed = JSON.parse(rawCode);
      if (parsed?.code) lookupCode = parsed.code;
    } catch { /* raw string */ }

    const { data } = await supabase
      .from("session_participations")
      .select(`
        id, status, participant_name, participant_code, participation_code, verified_at,
        activity_sessions!inner(start_time, end_time),
        activities!inner(name)
      `)
      .eq("participation_code", lookupCode)
      .eq("event_id", eventId)
      .maybeSingle();

    if (!data) return { status: "invalid", participationCode: lookupCode };

    if (data.status === "verified") {
      return {
        status: "already_verified",
        participantName: data.participant_name,
        participantCode: data.participant_code,
        activityName: (data.activities as { name: string }).name,
        sessionTime: fmt(
          (data.activity_sessions as { start_time: string; end_time: string }).start_time,
          (data.activity_sessions as { start_time: string; end_time: string }).end_time,
        ),
        participationCode: lookupCode,
      };
    }

    await supabase.from("session_participations")
      .update({ status: "verified", verified_at: new Date().toISOString(), verified_by: user?.id })
      .eq("id", data.id);

    return {
      status: "valid",
      participantName: data.participant_name,
      participantCode: data.participant_code,
      activityName: (data.activities as { name: string }).name,
      sessionTime: fmt(
        (data.activity_sessions as { start_time: string; end_time: string }).start_time,
        (data.activity_sessions as { start_time: string; end_time: string }).end_time,
      ),
      participationCode: lookupCode,
    };
  };

  // ── QR scan path ───────────────────────────────────────────────────────────
  const handleQrScan = async (rawCode: string) => {
    setScanning(false);
    const result = await validateCode(rawCode);
    setLastResult(result);
    setHistory(h => [{ ...result, ts: Date.now() }, ...h.slice(0, 19)]);
    processingRef.current = false;
  };

  // ── Manual verify path ─────────────────────────────────────────────────────
  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim() || manualVerifying) return;
    setManualVerifying(true);
    setManualResult(null);
    const result = await validateCode(manualCode);
    setManualResult(result);
    setHistory(h => [{ ...result, ts: Date.now() }, ...h.slice(0, 19)]);
    setManualVerifying(false);
  };

  const resumeScanning = () => { setLastResult(null); setScanning(true); };

  useEffect(() => {
    if (mode === "qr") {
      startCamera(facingMode);
    } else {
      stopStream();
      setLastResult(null);
      setScanning(false);
    }
    return stopStream;
  }, [facingMode, startCamera, mode]);

  // ─── Result card (shared for both modes) ──────────────────────────────────
  const ResultCard = ({ result, onDismiss }: { result: ScanResult; onDismiss: () => void }) => (
    <div className={cn(
      "rounded-2xl border-2 p-5 space-y-3",
      result.status === "valid"            ? "bg-success/10 border-success/30"
        : result.status === "already_verified" ? "bg-amber-500/10 border-amber-500/30"
        : "bg-destructive/10 border-destructive/30"
    )}>
      <div className="flex items-start gap-3">
        {result.status === "valid"            && <CheckCircle2 className="h-7 w-7 text-success shrink-0 mt-0.5" />}
        {result.status === "already_verified" && <Clock className="h-7 w-7 text-amber-500 shrink-0 mt-0.5" />}
        {result.status === "invalid"          && <XCircle className="h-7 w-7 text-destructive shrink-0 mt-0.5" />}
        <div className="flex-1 min-w-0">
          {result.status === "valid" && (
            <>
              <p className="font-black text-success">Admitted</p>
              <p className="text-base font-bold text-foreground">{result.participantName}</p>
              <p className="text-xs text-muted-foreground">#{result.participantCode}</p>
              <p className="text-sm font-semibold text-foreground mt-1">{result.activityName}</p>
              <p className="text-xs text-muted-foreground">{result.sessionTime}</p>
              <p className="text-[10px] font-mono text-muted-foreground mt-1">{result.participationCode}</p>
            </>
          )}
          {result.status === "already_verified" && (
            <>
              <p className="font-black text-amber-500">Already Admitted</p>
              <p className="text-sm font-bold text-foreground">{result.participantName}</p>
              <p className="text-xs text-muted-foreground">{result.sessionTime}</p>
              <p className="text-[10px] font-mono text-muted-foreground">{result.participationCode}</p>
            </>
          )}
          {result.status === "invalid" && (
            <>
              <p className="font-black text-destructive">Invalid Code</p>
              <p className="text-xs text-muted-foreground font-mono">{result.participationCode}</p>
              <p className="text-xs text-muted-foreground">No matching ticket found.</p>
            </>
          )}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={onDismiss}
        className="w-full border-border text-xs gap-1.5">
        <RefreshCw className="h-3 w-3" />Verify Another
      </Button>
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Mode switcher ─────────────────────────────────────────────────── */}
      <div className="flex gap-2">
        {([
          { id: "qr",     label: "QR Scan",      Icon: ScanLine },
          { id: "manual", label: "Manual Input",  Icon: Keyboard },
        ] as const).map(({ id, label, Icon }) => (
          <button
            key={id}
            onClick={() => { setMode(id); setManualResult(null); setManualCode(""); }}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 rounded-xl border-2 text-xs font-bold transition-all",
              mode === id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ── QR camera ─────────────────────────────────────────────────────── */}
      {mode === "qr" && (
        <div className="relative rounded-2xl overflow-hidden bg-black aspect-video">
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
              <CameraOff className="h-8 w-8" />
              <p className="text-sm">{cameraError}</p>
            </div>
          ) : (
            <>
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <canvas ref={canvasRef} className="hidden" />

              {!lastResult && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-48 h-48 border-2 border-white/70 rounded-2xl" />
                </div>
              )}

              {lastResult && (
                <div className={cn(
                  "absolute inset-0 flex flex-col items-center justify-center gap-3 px-6",
                  lastResult.status === "valid" ? "bg-success/75"
                    : lastResult.status === "already_verified" ? "bg-amber-500/75"
                    : "bg-destructive/75"
                )}>
                  {lastResult.status === "valid"            && <CheckCircle2 className="h-16 w-16 text-white" />}
                  {lastResult.status === "already_verified" && <Clock className="h-16 w-16 text-white" />}
                  {lastResult.status === "invalid"          && <XCircle className="h-16 w-16 text-white" />}

                  <div className="text-center text-white">
                    {lastResult.status === "valid" && (
                      <>
                        <p className="text-xl font-black">{lastResult.participantName}</p>
                        <p className="text-sm opacity-90">#{lastResult.participantCode}</p>
                        <p className="text-sm font-semibold mt-1">{lastResult.activityName}</p>
                        <p className="text-sm opacity-80">{lastResult.sessionTime}</p>
                        <p className="text-xs font-mono opacity-70 mt-1">{lastResult.participationCode}</p>
                      </>
                    )}
                    {lastResult.status === "already_verified" && (
                      <>
                        <p className="text-base font-black">Already Admitted</p>
                        <p className="text-sm opacity-90">{lastResult.participantName}</p>
                        <p className="text-sm opacity-80">{lastResult.sessionTime}</p>
                      </>
                    )}
                    {lastResult.status === "invalid" && (
                      <p className="text-base font-black">Invalid Code</p>
                    )}
                  </div>

                  <Button onClick={resumeScanning}
                    className="bg-white/20 text-white border border-white/30 hover:bg-white/30" size="sm">
                    <RefreshCw className="h-3.5 w-3.5 mr-2" />Scan Next
                  </Button>
                </div>
              )}
            </>
          )}

          <button
            onClick={() => setFacingMode(f => f === "environment" ? "user" : "environment")}
            className="absolute top-2 right-2 p-2 rounded-lg bg-black/40 text-white hover:bg-black/60"
          >
            <FlipHorizontal className="h-4 w-4" />
          </button>
          <div className="absolute bottom-2 left-2 flex items-center gap-1.5 bg-black/40 px-2 py-1 rounded-lg">
            <ScanLine className="h-3.5 w-3.5 text-white" />
            <span className="text-[10px] text-white font-semibold">
              {scanning ? "Scanning…" : "Paused"}
            </span>
          </div>
        </div>
      )}

      {/* ── Manual input ──────────────────────────────────────────────────── */}
      {mode === "manual" && (
        <div className="space-y-4">
          <form onSubmit={handleManualVerify} className="space-y-3">
            <Input
              value={manualCode}
              onChange={e => { setManualCode(e.target.value.toUpperCase()); setManualResult(null); }}
              placeholder="e.g. MOV-1300-0245"
              className="h-14 text-center text-xl font-black font-mono tracking-widest bg-secondary border-2 focus:border-primary uppercase"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Button
              type="submit"
              disabled={!manualCode.trim() || manualVerifying}
              className="w-full h-12 font-bold uppercase tracking-wider gap-2 bg-primary text-primary-foreground shadow-glow-primary"
            >
              {manualVerifying
                ? <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Verifying…</>
                : <><Search className="h-4 w-4" />Verify Code</>}
            </Button>
          </form>

          {manualResult && (
            <ResultCard
              result={manualResult}
              onDismiss={() => { setManualResult(null); setManualCode(""); }}
            />
          )}
        </div>
      )}

      {/* ── History ───────────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Recent Verifications</p>
          {history.slice(0, 8).map((h, i) => (
            <div key={i} className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2 border",
              h.status === "valid" ? "bg-success/10 border-success/20"
                : h.status === "already_verified" ? "bg-amber-500/10 border-amber-500/20"
                : "bg-destructive/10 border-destructive/20"
            )}>
              {h.status === "valid"            && <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
              {h.status === "already_verified" && <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
              {h.status === "invalid"          && <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">
                  {h.participantName ?? h.participationCode ?? "Unknown"}
                </p>
                {h.sessionTime && <p className="text-[10px] text-muted-foreground">{h.sessionTime}</p>}
              </div>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {new Date(h.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function fmt(start: string, end: string) {
  const f = (t: string) => {
    const [h, m] = t.split(":");
    const hour = parseInt(h);
    return `${hour > 12 ? hour - 12 : hour || 12}:${m} ${hour >= 12 ? "PM" : "AM"}`;
  };
  return `${f(start)} – ${f(end)}`;
}
