import { useEffect, useRef, useState, useCallback } from "react";
import jsQR from "jsqr";
import {
  X, Keyboard, ScanLine, Upload, CheckCircle2, XCircle, Clock,
  Users, Briefcase, HardHat, RefreshCw, CameraOff, FlipHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  offlineLookupParticipant, offlineLookupSP, offlineLookupCrew,
  localCheckIn, queueMutation,
} from "@/lib/offlineStore";

// ─── Types ────────────────────────────────────────────────────────────────────
export type AttendeeType = "participant" | "service_provider" | "crew";
type Tab = "code" | "qr" | "csv";
type Phase = "input" | "validating" | "preview" | "processing" | "done";

interface ValidatedRecord {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  status: "found" | "already";
}

interface BulkResult {
  found: ValidatedRecord[];
  already: ValidatedRecord[];
  notFound: string[];
}

interface ScannedEntry {
  code: string;
  name: string;
  result: "success" | "already" | "not_found";
  ts: number;
}

interface Props {
  eventId: string;
  attendeeType: AttendeeType;
  online: boolean;
  onClose: () => void;
  onDone?: (checkedInCount: number) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function candidateCodes(raw: string): string[] {
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
  return [...set].filter(Boolean);
}

function parseLines(text: string): string[] {
  return text.split(/[\n,]+/).map(l => l.trim()).filter(Boolean);
}

function parseCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const hasHeader = /^code|^name|^participant/i.test(lines[0] ?? "");
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map(l => l.split(",")[0]?.trim()).filter(Boolean) as string[];
}

// ─── Online bulk lookup ───────────────────────────────────────────────────────
async function onlineBulkLookup(
  rawCodes: string[], eventId: string, type: AttendeeType
): Promise<BulkResult> {
  const found: ValidatedRecord[] = [];
  const already: ValidatedRecord[] = [];
  const notFound: string[] = [];

  const table = type === "participant" ? "participants"
    : type === "service_provider" ? "service_providers"
    : "crew_members";
  const nameField = type === "service_provider" ? "brand_name" : "name";

  // Batch fetch by normalized codes
  const allCandidates = [...new Set(rawCodes.flatMap(candidateCodes))];
  const { data } = await supabase
    .from(table)
    .select(`id, code, ${nameField}, phone, is_checked_in`)
    .eq("event_id", eventId)
    .in("code", allCandidates);

  const byCode = new Map((data ?? []).map(r => [r.code, r]));

  for (const raw of rawCodes) {
    const candidates = candidateCodes(raw);
    const record = candidates.map(c => byCode.get(c)).find(Boolean);
    if (!record) {
      notFound.push(raw);
    } else if (record.is_checked_in) {
      already.push({ id: record.id, code: record.code, name: record[nameField], phone: record.phone, status: "already" });
    } else {
      found.push({ id: record.id, code: record.code, name: record[nameField], phone: record.phone, status: "found" });
    }
  }
  return { found, already, notFound };
}

// ─── Offline bulk lookup ──────────────────────────────────────────────────────
async function offlineBulkLookup(
  rawCodes: string[], eventId: string, type: AttendeeType
): Promise<BulkResult> {
  const found: ValidatedRecord[] = [];
  const already: ValidatedRecord[] = [];
  const notFound: string[] = [];

  for (const raw of rawCodes) {
    const record = type === "participant"
      ? await offlineLookupParticipant(raw, eventId)
      : type === "service_provider"
        ? await offlineLookupSP(raw, eventId)
        : await offlineLookupCrew(raw, eventId);

    if (!record) {
      notFound.push(raw);
    } else if (record.is_checked_in) {
      const name = "brand_name" in record ? record.brand_name : record.name;
      already.push({ id: record.id, code: record.code, name, phone: record.phone ?? null, status: "already" });
    } else {
      const name = "brand_name" in record ? record.brand_name : record.name;
      found.push({ id: record.id, code: record.code, name, phone: record.phone ?? null, status: "found" });
    }
  }
  return { found, already, notFound };
}

// ─── Check in batch ───────────────────────────────────────────────────────────
async function performBulkCheckIn(
  records: ValidatedRecord[], eventId: string, type: AttendeeType, online: boolean
): Promise<number> {
  const now = new Date().toISOString();
  const table = type === "participant" ? "participants"
    : type === "service_provider" ? "service_providers"
    : "crew_members";
  const mutType = type === "participant" ? "checkin_participant" as const
    : type === "service_provider" ? "checkin_sp" as const
    : "checkin_crew" as const;

  let successCount = 0;
  if (online) {
    const { error } = await supabase.from(table)
      .update({ is_checked_in: true, checked_in_at: now, check_in_method: "Bulk Check-In" })
      .in("id", records.map(r => r.id));
    if (!error) successCount = records.length;
  } else {
    for (const r of records) {
      await queueMutation(mutType, {
        id: r.id, is_checked_in: true, checked_in_at: now,
        check_in_method: "Bulk Check-In", event_id: eventId,
      });
      await localCheckIn(table, r.id);
      successCount++;
    }
  }
  return successCount;
}

// ─── Sub-component: Code Entry Tab ───────────────────────────────────────────
function CodeEntryTab({ eventId, attendeeType, online, onDone }: Omit<Props, "onClose">) {
  const [rawInput, setRawInput] = useState("");
  const [phase, setPhase] = useState<Phase>("input");
  const [result, setResult] = useState<BulkResult | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);

  const validate = async () => {
    const codes = parseLines(rawInput);
    if (!codes.length) return;
    setPhase("validating");
    const res = online
      ? await onlineBulkLookup(codes, eventId, attendeeType)
      : await offlineBulkLookup(codes, eventId, attendeeType);
    setResult(res);
    setPhase("preview");
  };

  const process = async () => {
    if (!result?.found.length) return;
    setPhase("processing");
    const n = await performBulkCheckIn(result.found, eventId, attendeeType, online);
    setCheckedIn(n);
    setPhase("done");
    onDone?.(n);
  };

  const reset = () => { setRawInput(""); setPhase("input"); setResult(null); setCheckedIn(0); };

  if (phase === "input" || phase === "validating") {
    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Enter one code per line. You can also separate with commas.
        </p>
        <textarea
          value={rawInput}
          onChange={e => setRawInput(e.target.value)}
          placeholder={"#0245\n#0246\n#0247\n0248"}
          rows={8}
          className="w-full rounded-xl border border-border bg-secondary/50 px-4 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <Button
          onClick={validate}
          disabled={!rawInput.trim() || phase === "validating"}
          className="w-full"
        >
          {phase === "validating"
            ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Validating…</>
            : "Validate Codes"}
        </Button>
      </div>
    );
  }

  if (phase === "preview" && result) {
    return (
      <div className="space-y-4">
        {/* Summary chips */}
        <div className="flex flex-wrap gap-2">
          <Badge variant="default" className="gap-1 bg-success text-white">
            <CheckCircle2 className="h-3 w-3" />{result.found.length} Found
          </Badge>
          <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/40">
            <Clock className="h-3 w-3" />{result.already.length} Already In
          </Badge>
          <Badge variant="outline" className="gap-1 text-destructive border-destructive/40">
            <XCircle className="h-3 w-3" />{result.notFound.length} Not Found
          </Badge>
        </div>

        {/* Found list */}
        {result.found.length > 0 && (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-success">Will be checked in</p>
            {result.found.map(r => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                <span className="text-sm font-medium text-foreground flex-1 truncate">{r.name}</span>
                <span className="text-xs text-muted-foreground font-mono">#{r.code}</span>
              </div>
            ))}
          </div>
        )}

        {/* Not found */}
        {result.notFound.length > 0 && (
          <div className="space-y-1 max-h-24 overflow-y-auto">
            <p className="text-[10px] font-bold uppercase tracking-widest text-destructive">Not found</p>
            {result.notFound.map((c, i) => (
              <div key={i} className="flex items-center gap-2 rounded-lg bg-destructive/5 border border-destructive/20 px-3 py-1.5">
                <XCircle className="h-3 w-3 text-destructive shrink-0" />
                <span className="text-xs font-mono text-muted-foreground">{c}</span>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="flex-1">Back</Button>
          <Button
            onClick={process}
            disabled={!result.found.length}
            className="flex-1"
          >
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Check In {result.found.length}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">Processing…</p>
      </div>
    );
  }

  if (phase === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-success/10 border border-success/20 p-6 text-center space-y-2">
          <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
          <p className="text-2xl font-black text-foreground">{checkedIn}</p>
          <p className="text-sm text-muted-foreground">Participants Checked In</p>
        </div>
        <Button variant="outline" onClick={reset} className="w-full">Check In More</Button>
      </div>
    );
  }
  return null;
}

// ─── Sub-component: CSV Tab ───────────────────────────────────────────────────
function CsvTab({ eventId, attendeeType, online, onDone }: Omit<Props, "onClose">) {
  const [phase, setPhase] = useState<Phase>("input");
  const [codes, setCodes] = useState<string[]>([]);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const parsed = parseCsv(ev.target?.result as string ?? "");
      setCodes(parsed);
    };
    reader.readAsText(file);
  };

  const validate = async () => {
    if (!codes.length) return;
    setPhase("validating");
    const res = online
      ? await onlineBulkLookup(codes, eventId, attendeeType)
      : await offlineBulkLookup(codes, eventId, attendeeType);
    setResult(res);
    setPhase("preview");
  };

  const process = async () => {
    if (!result?.found.length) return;
    setPhase("processing");
    const n = await performBulkCheckIn(result.found, eventId, attendeeType, online);
    setCheckedIn(n);
    setPhase("done");
    onDone?.(n);
  };

  if (phase === "done") {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-success/10 border border-success/20 p-6 text-center space-y-2">
          <CheckCircle2 className="h-10 w-10 text-success mx-auto" />
          <p className="text-2xl font-black text-foreground">{checkedIn}</p>
          <p className="text-sm text-muted-foreground">Participants Checked In</p>
        </div>
        <Button variant="outline" onClick={() => { setPhase("input"); setCodes([]); setResult(null); }} className="w-full">
          Upload Another File
        </Button>
      </div>
    );
  }

  if (phase === "preview" && result) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Badge className="gap-1 bg-success text-white"><CheckCircle2 className="h-3 w-3" />{result.found.length} Found</Badge>
          <Badge variant="outline" className="gap-1 text-amber-500 border-amber-500/40"><Clock className="h-3 w-3" />{result.already.length} Already In</Badge>
          <Badge variant="outline" className="gap-1 text-destructive border-destructive/40"><XCircle className="h-3 w-3" />{result.notFound.length} Not Found</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => { setPhase("input"); setCodes([]); }} className="flex-1">Back</Button>
          <Button onClick={process} disabled={!result.found.length} className="flex-1">
            <CheckCircle2 className="h-4 w-4 mr-2" />Check In {result.found.length}
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "validating" || phase === "processing") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
        <RefreshCw className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm font-medium">{phase === "validating" ? "Validating…" : "Processing…"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Upload a CSV file. The first column should contain participant codes. Include a header row (optional).
      </p>
      <div
        className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
        onClick={() => fileRef.current?.click()}
      >
        <Upload className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm font-medium text-foreground">Click to upload CSV</p>
        <p className="text-xs text-muted-foreground mt-1">or drag and drop</p>
        {codes.length > 0 && (
          <p className="text-sm font-semibold text-primary mt-3">{codes.length} codes loaded</p>
        )}
      </div>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
      {codes.length > 0 && (
        <Button onClick={validate} className="w-full">
          Validate {codes.length} Codes
        </Button>
      )}
    </div>
  );
}

// ─── Sub-component: Bulk QR Tab ───────────────────────────────────────────────
function QrScanTab({ eventId, attendeeType, online, onDone }: Omit<Props, "onClose">) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animRef = useRef<number | null>(null);
  const processingRef = useRef(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanned, setScanned] = useState<ScannedEntry[]>([]);
  const [flashResult, setFlashResult] = useState<"success" | "already" | "not_found" | null>(null);
  const successCount = scanned.filter(s => s.result === "success").length;

  const stopStream = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const startCamera = useCallback(async (facing: "environment" | "user") => {
    stopStream();
    processingRef.current = false;
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        scan();
      }
    } catch { setCameraError("Camera unavailable. Check permissions."); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scan = () => {
    const tick = () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) { animRef.current = requestAnimationFrame(tick); return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) { animRef.current = requestAnimationFrame(tick); return; }
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data && !processingRef.current) {
        processingRef.current = true;
        processQrCode(code.data);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  };

  const processQrCode = async (raw: string) => {
    // Look up the record
    let record: { id: string; code: string; name: string; phone: string | null; is_checked_in: boolean } | null = null;

    if (online) {
      const table = attendeeType === "participant" ? "participants"
        : attendeeType === "service_provider" ? "service_providers"
        : "crew_members";
      const nameField = attendeeType === "service_provider" ? "brand_name" : "name";

      const candidates = candidateCodes(raw);
      const isUrl = raw.startsWith("http");
      if (isUrl) {
        const { data } = await supabase.from(table).select(`id, code, ${nameField}, phone, is_checked_in`)
          .eq("event_id", eventId).eq("qr_link", raw).limit(1).maybeSingle();
        if (data) record = { ...data, name: data[nameField] };
      } else {
        for (const c of candidates) {
          const { data } = await supabase.from(table).select(`id, code, ${nameField}, phone, is_checked_in`)
            .eq("event_id", eventId).eq("code", c).limit(1).maybeSingle();
          if (data) { record = { ...data, name: data[nameField] }; break; }
        }
      }
    } else {
      const r = await (attendeeType === "participant"
        ? offlineLookupParticipant(raw, eventId)
        : attendeeType === "service_provider"
          ? offlineLookupSP(raw, eventId)
          : offlineLookupCrew(raw, eventId));
      if (r) {
        const name = "brand_name" in r ? r.brand_name : r.name;
        record = { id: r.id, code: r.code, name, phone: r.phone ?? null, is_checked_in: r.is_checked_in };
      }
    }

    let result: ScannedEntry["result"] = "not_found";

    if (!record) {
      result = "not_found";
    } else if (record.is_checked_in) {
      result = "already";
    } else {
      // Check in
      if (online) {
        const table = attendeeType === "participant" ? "participants"
          : attendeeType === "service_provider" ? "service_providers" : "crew_members";
        await supabase.from(table)
          .update({ is_checked_in: true, checked_in_at: new Date().toISOString(), check_in_method: "QR Bulk Scan" })
          .eq("id", record.id);
        onDone?.(1);
      } else {
        const mutType = attendeeType === "participant" ? "checkin_participant" as const
          : attendeeType === "service_provider" ? "checkin_sp" as const : "checkin_crew" as const;
        const table = attendeeType === "participant" ? "participants"
          : attendeeType === "service_provider" ? "service_providers" : "crew_members";
        await queueMutation(mutType, { id: record.id, is_checked_in: true, checked_in_at: new Date().toISOString(), check_in_method: "QR Bulk Scan", event_id: eventId });
        await localCheckIn(table, record.id);
        onDone?.(1);
      }
      result = "success";
    }

    const entry: ScannedEntry = {
      code: record?.code ?? raw,
      name: record?.name ?? "Unknown",
      result,
      ts: Date.now(),
    };
    setScanned(prev => [entry, ...prev.slice(0, 49)]);
    setFlashResult(result);
    setTimeout(() => {
      setFlashResult(null);
      processingRef.current = false;
    }, 1_500);
  };

  useEffect(() => { startCamera(facingMode); return stopStream; }, [facingMode, startCamera]);

  return (
    <div className="space-y-3">
      {/* Scoreboard */}
      <div className="flex items-center gap-3">
        <div className="flex-1 rounded-xl bg-success/10 border border-success/20 p-3 text-center">
          <p className="text-xl font-black text-success">{successCount}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Checked In</p>
        </div>
        <div className="flex-1 rounded-xl bg-amber-500/10 border border-amber-500/20 p-3 text-center">
          <p className="text-xl font-black text-amber-500">{scanned.filter(s => s.result === "already").length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Already In</p>
        </div>
        <div className="flex-1 rounded-xl bg-destructive/10 border border-destructive/20 p-3 text-center">
          <p className="text-xl font-black text-destructive">{scanned.filter(s => s.result === "not_found").length}</p>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Not Found</p>
        </div>
      </div>

      {/* Camera */}
      <div className="relative rounded-xl overflow-hidden bg-black aspect-video">
        {cameraError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
            <CameraOff className="h-8 w-8" />
            <p className="text-sm">{cameraError}</p>
          </div>
        ) : (
          <>
            <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
            <canvas ref={canvasRef} className="hidden" />
            {/* Flash overlay */}
            {flashResult && (
              <div className={cn(
                "absolute inset-0 flex items-center justify-center transition-opacity",
                flashResult === "success" ? "bg-success/60" : flashResult === "already" ? "bg-amber-500/60" : "bg-destructive/60"
              )}>
                {flashResult === "success" && <CheckCircle2 className="h-16 w-16 text-white" />}
                {flashResult === "already"  && <Clock className="h-16 w-16 text-white" />}
                {flashResult === "not_found" && <XCircle className="h-16 w-16 text-white" />}
              </div>
            )}
            {/* Scan target */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-48 h-48 border-2 border-white/60 rounded-2xl" />
            </div>
          </>
        )}
        <button
          onClick={() => setFacingMode(f => f === "environment" ? "user" : "environment")}
          className="absolute top-2 right-2 p-2 rounded-lg bg-black/40 text-white hover:bg-black/60"
        >
          <FlipHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Recent scans */}
      {scanned.length > 0 && (
        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {scanned.slice(0, 10).map((s, i) => (
            <div key={i} className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 border",
              s.result === "success" ? "bg-success/10 border-success/20"
                : s.result === "already" ? "bg-amber-500/10 border-amber-500/20"
                : "bg-destructive/10 border-destructive/20"
            )}>
              {s.result === "success"   && <CheckCircle2 className="h-3 w-3 text-success shrink-0" />}
              {s.result === "already"   && <Clock className="h-3 w-3 text-amber-500 shrink-0" />}
              {s.result === "not_found" && <XCircle className="h-3 w-3 text-destructive shrink-0" />}
              <span className="text-xs font-medium text-foreground flex-1 truncate">{s.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">#{s.code}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Modal ───────────────────────────────────────────────────────────────
const TYPE_LABELS: Record<AttendeeType, { label: string; Icon: typeof Users }> = {
  participant:      { label: "Participant",       Icon: Users },
  service_provider: { label: "Service Provider",  Icon: Briefcase },
  crew:             { label: "Crew Member",       Icon: HardHat },
};

const TABS: { id: Tab; label: string; Icon: typeof Keyboard }[] = [
  { id: "code", label: "Multi-Code",  Icon: Keyboard },
  { id: "qr",   label: "Bulk QR",    Icon: ScanLine },
  { id: "csv",  label: "CSV Upload", Icon: Upload },
];

export function BulkCheckInModal({ eventId, attendeeType, online, onClose, onDone }: Props) {
  const [tab, setTab] = useState<Tab>("code");
  const [totalDone, setTotalDone] = useState(0);
  const { label, Icon } = TYPE_LABELS[attendeeType];

  const handleDone = (n: number) => {
    setTotalDone(t => t + n);
    onDone?.(n);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-background rounded-2xl w-full max-w-lg max-h-[90vh] flex flex-col shadow-2xl border border-border">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-primary/10">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Bulk Check-In</h2>
              <p className="text-xs text-muted-foreground">{label}s · {!online ? "Offline" : totalDone > 0 ? `${totalDone} processed` : "Online"}</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border shrink-0">
          {TABS.map(({ id, label: tLabel, Icon: TIcon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors",
                tab === id
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <TIcon className="h-3.5 w-3.5" />{tLabel}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {tab === "code" && <CodeEntryTab eventId={eventId} attendeeType={attendeeType} online={online} onDone={handleDone} />}
          {tab === "qr"   && <QrScanTab   eventId={eventId} attendeeType={attendeeType} online={online} onDone={handleDone} />}
          {tab === "csv"  && <CsvTab      eventId={eventId} attendeeType={attendeeType} online={online} onDone={handleDone} />}
        </div>
      </div>
    </div>
  );
}
