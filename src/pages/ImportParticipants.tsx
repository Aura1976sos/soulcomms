import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload, CheckCircle, AlertCircle, X, Plus,
  Download, FileSpreadsheet, Users, AlertTriangle, Link2, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

// ─── Types ───────────────────────────────────────────────────────────
interface ParticipantRow {
  code: string;
  name: string;
  phone: string;
  qr_link: string;
}

interface RowError {
  row: number;
  code: string;
  name: string;
  errors: string[];
}

interface ImportSummary {
  inserted: ParticipantRow[];
  duplicates: string[];
  invalid: RowError[];
}

type ImportMode = "standard" | "registration";

// ─── Format Detection ─────────────────────────────────────────────────
/**
 * Detect whether the first row looks like a registration export:
 * First Name | Last Name | Event | QR Link
 */
function detectMode(firstRow: string[]): ImportMode {
  const lower = firstRow.map(c => c.toLowerCase().trim());
  const hasFirstName = lower.some(c => c.includes("first") || c.includes("first name"));
  const hasQR = lower.some(c => c.includes("qr") || c.includes("link"));
  return hasFirstName && hasQR ? "registration" : "standard";
}

// ─── Parsers ──────────────────────────────────────────────────────────
function splitCsvLine(line: string): string[] {
  // Handle both comma and tab delimiters; strip surrounding quotes
  const delim = line.includes("\t") ? "\t" : ",";
  return line.split(delim).map(c => c.trim().replace(/^"|"$/g, ""));
}

/**
 * Parse a registration-export CSV (First Name / Last Name / Event / QR Link)
 * into rows with { name, qr_link }. Code will be auto-generated later.
 */
function parseRegistrationRows(lines: string[]): { name: string; qr_link: string }[] {
  const header = splitCsvLine(lines[0]).map(c => c.toLowerCase().trim());
  const firstNameIdx = header.findIndex(c => c.includes("first"));
  const lastNameIdx = header.findIndex(c => c.includes("last"));
  const qrIdx = header.findIndex(c => c.includes("qr") || c.includes("link"));

  return lines.slice(1)
    .map(line => {
      const cols = splitCsvLine(line);
      const first = firstNameIdx >= 0 ? (cols[firstNameIdx] ?? "").trim() : "";
      const last = lastNameIdx >= 0 ? (cols[lastNameIdx] ?? "").trim() : "";
      const qr = qrIdx >= 0 ? (cols[qrIdx] ?? "").trim() : "";
      const name = [first, last].filter(Boolean).join(" ").trim();
      return { name, qr_link: qr };
    })
    .filter(r => r.name);
}

/**
 * Parse standard format: Code / Name / Phone
 */
function parseStandardRows(lines: string[]): ParticipantRow[] {
  const firstRow = splitCsvLine(lines[0]).map(c => c.toLowerCase());
  const hasHeader = firstRow.some(c => /code|name|phone/.test(c));
  return (hasHeader ? lines.slice(1) : lines)
    .map(line => {
      const cols = splitCsvLine(line);
      return { code: cols[0] ?? "", name: cols[1] ?? "", phone: cols[2] ?? "", qr_link: "" };
    })
    .filter(r => r.code || r.name);
}

// ─── Validation ───────────────────────────────────────────────────────
function validateRow(r: ParticipantRow, idx: number): RowError | null {
  const errors: string[] = [];
  if (!r.code) errors.push("Code required");
  else if (!/^\d+$/.test(r.code)) errors.push("Code must be numeric");
  if (!r.name) errors.push("Name required");
  if (errors.length === 0) return null;
  return { row: idx + 1, code: r.code, name: r.name, errors };
}

// ─── Component ────────────────────────────────────────────────────────
export default function ImportParticipants() {
  const [queue, setQueue] = useState<ParticipantRow[]>([]);
  const [mode, setMode] = useState<ImportMode>("standard");
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { activeEvent } = useEvent();

  // Manual entry
  const [manualCode, setManualCode] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  // ── Get next available code from DB ────────────────────────────────
  const getNextCode = useCallback(async (count: number): Promise<string[]> => {
    const { data } = await supabase
      .from("participants")
      .select("code")
      .order("created_at", { ascending: false })
      .limit(1000);

    const existingNums = (data ?? [])
      .map((r: { code: string }) => parseInt(r.code, 10))
      .filter(n => !isNaN(n));

    let nextNum = existingNums.length > 0 ? Math.max(...existingNums) + 1 : 1;

    // Also reserve codes currently in queue
    const queueNums = queue
      .map(r => parseInt(r.code, 10))
      .filter(n => !isNaN(n));
    if (queueNums.length > 0) {
      nextNum = Math.max(nextNum, Math.max(...queueNums) + 1);
    }

    return Array.from({ length: count }, (_, i) =>
      String(nextNum + i).padStart(4, "0")
    );
  }, [queue]);

  // ── File parser ────────────────────────────────────────────────────
  const parseFile = async (file: File) => {
    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";

    reader.onload = async (e) => {
      let firstRow: string[] = [];
      let detectedMode: ImportMode = "standard";
      let rows: ParticipantRow[] = [];

      if (isCsv) {
        const text = e.target?.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return;

        firstRow = splitCsvLine(lines[0]);
        detectedMode = detectMode(firstRow);

        if (detectedMode === "registration") {
          const regRows = parseRegistrationRows(lines);
          // Auto-generate codes
          const codes = await getNextCode(regRows.length);
          rows = regRows.map((r, i) => ({
            code: codes[i],
            name: r.name,
            phone: "",
            qr_link: r.qr_link,
          }));
        } else {
          rows = parseStandardRows(lines);
        }
      } else {
        // Excel
        const workbook = XLSX.read(e.target?.result as ArrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
        firstRow = (jsonRows[0] ?? []).map(c => String(c));
        detectedMode = detectMode(firstRow);

        if (detectedMode === "registration") {
          const lines = jsonRows.map(r => r.map(c => String(c ?? "")).join("\t"));
          const regRows = parseRegistrationRows(lines);
          const codes = await getNextCode(regRows.length);
          rows = regRows.map((r, i) => ({
            code: codes[i],
            name: r.name,
            phone: "",
            qr_link: r.qr_link,
          }));
        } else {
          const hasHeader = firstRow.map(c => c.toLowerCase()).some(c => /code|name|phone/.test(c));
          const dataRows = hasHeader ? jsonRows.slice(1) : jsonRows;
          rows = dataRows
            .map(cols => ({
              code: String(cols[0] ?? "").trim(),
              name: String(cols[1] ?? "").trim(),
              phone: String(cols[2] ?? "").trim(),
              qr_link: String(cols[3] ?? "").trim(),
            }))
            .filter(r => r.code || r.name);
        }
      }

      setMode(detectedMode);
      setQueue(prev => {
        const existingCodes = new Set(prev.map(r => r.code));
        const fresh = rows.filter(r => !existingCodes.has(r.code));
        return [...prev, ...fresh];
      });

      toast({
        title: `${rows.length} rows loaded`,
        description: detectedMode === "registration"
          ? "Registration export detected · codes auto-generated"
          : "Review the list below, then click Import.",
      });
    };

    if (isCsv) {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) parseFile(file);
  };

  // ── Import ────────────────────────────────────────────────────────
  const handleImport = async () => {
    if (queue.length === 0) return;
    setImporting(true);

    const invalid: RowError[] = [];
    const valid: ParticipantRow[] = [];
    queue.forEach((row, idx) => {
      const err = validateRow(row, idx);
      if (err) invalid.push(err);
      else valid.push(row);
    });

    if (valid.length === 0) {
      setImporting(false);
      toast({ title: "No valid rows to import", variant: "destructive" });
      return;
    }

    // Check for duplicate codes already in DB in manageable batches
    const codesToCheck = valid.map(r => r.code);
    const existingCodes = new Set<string>();
    const duplicateBatchSize = 200;
    for (let i = 0; i < codesToCheck.length; i += duplicateBatchSize) {
      const batch = codesToCheck.slice(i, i + duplicateBatchSize);
      const { data: existingRows, error } = await supabase
        .from("participants")
        .select("code")
        .in("code", batch);
      if (error) {
        toast({ title: "Unable to check duplicate codes", description: error.message, variant: "destructive" });
        console.error("Duplicate code check error", error);
        setImporting(false);
        return;
      }
      (existingRows ?? []).forEach((r: { code: string }) => existingCodes.add(r.code));
    }

    const duplicates = valid.filter(r => existingCodes.has(r.code)).map(r => r.code);
    const toInsert = valid.filter(r => !existingCodes.has(r.code));

    // Bulk insert in chunks of 100
    const inserted: ParticipantRow[] = [];
    const chunkSize = 100;
    for (let i = 0; i < toInsert.length; i += chunkSize) {
      const chunk = toInsert.slice(i, i + chunkSize);
      const { data, error } = await supabase
        .from("participants")
        .insert(chunk.map(r => ({
          code: r.code,
          name: r.name,
          phone: r.phone || null,
          qr_link: r.qr_link || null,
          event_id: activeEvent?.id ?? null,
        })))
        .select("code, name, phone, qr_link");
      if (error) {
        toast({ title: `Failed to insert batch ${Math.floor(i / chunkSize) + 1}`, description: error.message, variant: "destructive" });
        console.error("Participant insert batch error", error);
      }
      if (!error && data) inserted.push(...(data as ParticipantRow[]));
    }

    setSummary({ inserted, duplicates, invalid });
    setQueue([]);
    setImporting(false);
  };

  const handleManualAdd = () => {
    if (!manualCode.trim() || !manualName.trim()) return;
    const code = manualCode.trim();
    if (queue.some(r => r.code === code)) {
      toast({ title: `Code ${code} already in queue`, variant: "destructive" });
      return;
    }
    setQueue(prev => [...prev, { code, name: manualName.trim(), phone: manualPhone.trim(), qr_link: "" }]);
    setManualCode(""); setManualName(""); setManualPhone("");
  };

  const downloadTemplate = () => {
    const csv = "Code,Name,Phone\n0021,Adewale Okafor,08031234567\n0022,Blessing Nwosu,08051234567";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tg100_import_template.csv";
    a.click();
  };

  const downloadCodeSheet = () => {
    if (!summary) return;
    const rows = [
      ["Code", "Name", "Phone", "QR Link"],
      ...summary.inserted.map(r => [r.code, r.name, r.phone ?? "", r.qr_link ?? ""]),
    ];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tg100_imported_participants.csv";
    a.click();
  };

  const handleReset = () => { setSummary(null); setQueue([]); };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <AppLayout title="Import Participants" subtitle="Supports registration export (First Name / Last Name / QR Link) or standard format">
      <div className="max-w-3xl mx-auto space-y-6">

        {/* ── POST-IMPORT SUMMARY ── */}
        {summary ? (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-6 border border-success/30 slide-up">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-success/20 rounded-full shrink-0">
                  <CheckCircle className="h-6 w-6 text-success" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-black text-foreground">Import Complete</h3>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm">
                    <span className="text-success font-bold">{summary.inserted.length} imported</span>
                    {summary.duplicates.length > 0 && (
                      <span className="text-primary font-bold">{summary.duplicates.length} skipped (duplicate code)</span>
                    )}
                    {summary.invalid.length > 0 && (
                      <span className="text-destructive font-bold">{summary.invalid.length} invalid rows</span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-4">
                    {summary.inserted.length > 0 && (
                      <Button onClick={downloadCodeSheet} className="gap-2 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 font-bold">
                        <Download className="h-4 w-4" /> Download Code Sheet
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => navigate("/participants")} className="gap-2 border-border">
                      <Users className="h-4 w-4" /> View Participants
                    </Button>
                    <Button variant="ghost" onClick={handleReset} className="text-muted-foreground">Import More</Button>
                  </div>
                </div>
              </div>
            </div>

            {/* Inserted list */}
            {summary.inserted.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-6 py-3 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-bold text-foreground">Imported Successfully</span>
                  <span className="text-xs text-muted-foreground">{summary.inserted.length}</span>
                </div>
                <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "280px" }}>
                  {summary.inserted.map((r, i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-3">
                      <div className="px-3 py-1 bg-primary/15 border border-primary/30 rounded-lg shrink-0">
                        <span className="text-sm font-black font-mono text-primary">#{r.code}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{r.name}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {r.phone && <span className="text-xs text-muted-foreground">{r.phone}</span>}
                          {r.qr_link && (
                            <span className="flex items-center gap-1 text-xs text-primary">
                              <Link2 className="h-3 w-3" /> QR saved
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {summary.duplicates.length > 0 && (
              <div className="glass-card rounded-xl px-5 py-4 border border-primary/20">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-foreground mb-1">Skipped — duplicate codes</p>
                    <div className="flex flex-wrap gap-2">
                      {summary.duplicates.map(c => (
                        <span key={c} className="text-xs font-mono px-2 py-0.5 bg-primary/10 border border-primary/20 rounded text-primary">#{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {summary.invalid.length > 0 && (
              <div className="glass-card rounded-xl px-5 py-4 border border-destructive/20">
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div className="w-full">
                    <p className="text-sm font-bold text-foreground mb-2">Invalid rows (not imported)</p>
                    <div className="space-y-1.5">
                      {summary.invalid.map((e, i) => (
                        <div key={i} className="text-xs flex items-center gap-3">
                          <span className="text-muted-foreground w-10 shrink-0">Row {e.row}</span>
                          <span className="text-foreground truncate flex-1">{e.name || "—"}</span>
                          <span className="text-destructive">{e.errors.join(" · ")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

        ) : (
          <>
            {/* ── FORMAT INFO BANNER ── */}
            <div className="glass-card rounded-xl px-5 py-4 border border-primary/20">
              <div className="flex items-start gap-3">
                <Info className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p>
                    <span className="text-primary font-bold">Registration Export</span> — auto-detected when columns include
                    <span className="font-mono text-foreground"> First Name · Last Name · QR Link</span>.
                    Codes are generated automatically (0001, 0002 …). Phone left blank.
                  </p>
                  <p>
                    <span className="text-foreground font-bold">Standard Format</span> — columns:
                    <span className="font-mono text-foreground"> Code · Name · Phone</span> (CSV or Excel)
                  </p>
                </div>
              </div>
            </div>

            {/* ── UPLOAD ZONE ── */}
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Upload File</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Accepts: registration export CSV or standard format (CSV / Excel)
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={downloadTemplate} className="gap-2 border-border text-muted-foreground text-xs">
                  <Download className="h-3.5 w-3.5" /> Template
                </Button>
              </div>

              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all duration-200",
                  dragOver ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-secondary/50"
                )}
              >
                <FileSpreadsheet className={cn("h-10 w-10 mx-auto mb-3", dragOver ? "text-primary" : "text-muted-foreground opacity-60")} />
                <p className="text-sm font-semibold text-foreground">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1.5">CSV (comma or tab-separated) · Excel (.xlsx)</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.xlsx,.xls,.txt"
                className="hidden"
                onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])}
              />

              {/* Mode badge after detection */}
              {queue.length > 0 && (
                <div className="mt-3 flex items-center gap-2">
                  <span className={cn(
                    "text-xs font-bold px-3 py-1 rounded-full border",
                    mode === "registration"
                      ? "bg-primary/10 border-primary/30 text-primary"
                      : "bg-secondary border-border text-muted-foreground"
                  )}>
                    {mode === "registration" ? "Registration Export Mode" : "Standard Mode"}
                  </span>
                </div>
              )}
            </div>

            {/* ── MANUAL ENTRY ── */}
            <div className="glass-card rounded-2xl p-6">
              <div className="mb-4">
                <h3 className="text-sm font-bold text-foreground">Add Manually</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Code and Name are required · Phone is optional</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Input
                  value={manualCode}
                  onChange={e => setManualCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="Code *"
                  className="bg-secondary border-border focus:border-primary h-11"
                  onKeyDown={e => e.key === "Enter" && handleManualAdd()}
                />
                <Input
                  value={manualName}
                  onChange={e => setManualName(e.target.value)}
                  placeholder="Full Name *"
                  className="bg-secondary border-border focus:border-primary h-11 sm:col-span-2"
                  onKeyDown={e => e.key === "Enter" && handleManualAdd()}
                />
                <Input
                  value={manualPhone}
                  onChange={e => setManualPhone(e.target.value.replace(/\D/g, ""))}
                  placeholder="Phone (optional)"
                  className="bg-secondary border-border focus:border-primary h-11"
                  onKeyDown={e => e.key === "Enter" && handleManualAdd()}
                />
              </div>
              <Button
                onClick={handleManualAdd}
                disabled={!manualCode.trim() || !manualName.trim()}
                variant="outline"
                className="mt-3 gap-2 border-border"
              >
                <Plus className="h-4 w-4" /> Add to Queue
              </Button>
            </div>

            {/* ── QUEUE ── */}
            {queue.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{queue.length} participants queued</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Review, then click Import</p>
                  </div>
                  <Button
                    onClick={handleImport}
                    disabled={importing}
                    className="gap-2 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 font-bold"
                  >
                    {importing ? (
                      <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> Importing...</>
                    ) : (
                      <><Upload className="h-4 w-4" /> Import {queue.length}</>
                    )}
                  </Button>
                </div>

                <div className="grid grid-cols-[70px_1fr_100px_30px] gap-3 px-6 py-2 bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>Code</span><span>Name</span><span>QR / Phone</span><span></span>
                </div>

                <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "320px" }}>
                  {queue.map((row, i) => {
                    const err = validateRow(row, i);
                    return (
                      <div key={i} className={cn("grid grid-cols-[70px_1fr_100px_30px] gap-3 items-center px-6 py-3", err && "bg-destructive/5")}>
                        <span className="text-xs font-mono font-bold text-primary truncate">#{row.code}</span>
                        <span className="text-sm text-foreground truncate">{row.name || <span className="text-destructive">—</span>}</span>
                        <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                          {row.qr_link ? (
                            <><Link2 className="h-3 w-3 text-primary shrink-0" />QR</>
                          ) : row.phone || <span className="opacity-40">—</span>}
                        </span>
                        <button onClick={() => setQueue(q => q.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive transition-colors">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <div className="px-6 py-3 border-t border-border bg-secondary/30 flex justify-between items-center">
                  <button onClick={() => setQueue([])} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                    Clear all
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {queue.filter((r, i) => !validateRow(r, i)).length} valid · {queue.filter((r, i) => !!validateRow(r, i)).length} with errors
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}
