import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { supabase } from "@/integrations/supabase/client";
import { useEvent } from "@/contexts/EventContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Upload, CheckCircle, AlertCircle, X, Plus,
  Download, FileSpreadsheet, Briefcase, AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import * as XLSX from "xlsx";

interface ProviderRow { code: string; brand_name: string; contact_person: string; phone: string; }
interface RowError { row: number; code: string; brand_name: string; errors: string[]; }
interface ImportSummary { inserted: ProviderRow[]; duplicates: string[]; invalid: RowError[]; }

function normaliseRows(raw: string[][]): ProviderRow[] {
  return raw
    .map(cols => ({
      code: String(cols[0] ?? "").trim(),
      brand_name: String(cols[1] ?? "").trim(),
      contact_person: String(cols[2] ?? "").trim(),
      phone: String(cols[3] ?? "").trim(),
    }))
    .filter(r => r.code || r.brand_name);
}

function validateRow(r: ProviderRow, idx: number): RowError | null {
  const errors: string[] = [];
  if (!r.code) errors.push("Code is required");
  if (!r.brand_name) errors.push("Brand Name is required");
  if (r.code && !/^\d+$/.test(r.code)) errors.push("Code must be numeric");
  if (r.phone && !/^\d{7,15}$/.test(r.phone.replace(/\s/g, ""))) errors.push("Phone must be 7–15 digits");
  if (errors.length === 0) return null;
  return { row: idx + 1, code: r.code, brand_name: r.brand_name, errors };
}

export default function ImportServiceProviders() {
  const [queue, setQueue] = useState<ProviderRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();
  const { activeEvent } = useEvent();

  const [mCode, setMCode] = useState("");
  const [mBrand, setMBrand] = useState("");
  const [mContact, setMContact] = useState("");
  const [mPhone, setMPhone] = useState("");

  const parseFile = (file: File) => {
    const reader = new FileReader();
    const isCsv = file.name.toLowerCase().endsWith(".csv") || file.type === "text/csv";
    reader.onload = (e) => {
      const data = e.target?.result;
      let rows: string[][] = [];
      if (isCsv) {
        const text = data as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const hasHeader = /code|brand|contact|phone/.test(lines[0].toLowerCase());
        rows = (hasHeader ? lines.slice(1) : lines).map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      } else {
        const workbook = XLSX.read(data as ArrayBuffer, { type: "array" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 }) as string[][];
        const firstRow = (jsonRows[0] ?? []).map(c => String(c).toLowerCase());
        const hasHeader = firstRow.some(c => /code|brand|contact|phone/.test(c));
        rows = hasHeader ? jsonRows.slice(1) : jsonRows;
      }
      const parsed = normaliseRows(rows);
      setQueue(prev => {
        const existing = new Set(prev.map(r => r.code));
        return [...prev, ...parsed.filter(r => r.code && !existing.has(r.code))];
      });
      toast({ title: `${parsed.length} rows loaded` });
    };
    if (isCsv) { reader.readAsText(file); } else { reader.readAsArrayBuffer(file); }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0]; if (file) parseFile(file);
  };

  const handleImport = async () => {
    if (queue.length === 0) return;
    setImporting(true);
    const invalid: RowError[] = [];
    const valid: ProviderRow[] = [];
    queue.forEach((row, idx) => {
      const err = validateRow(row, idx);
      if (err) invalid.push(err); else valid.push(row);
    });
    if (valid.length === 0) { setImporting(false); toast({ title: "No valid rows", variant: "destructive" }); return; }

    const { data: existingRows } = await supabase.from("service_providers").select("code").in("code", valid.map(r => r.code));
    const existingCodes = new Set((existingRows ?? []).map((r: { code: string }) => r.code));
    const duplicates = valid.filter(r => existingCodes.has(r.code)).map(r => r.code);
    const toInsert = valid.filter(r => !existingCodes.has(r.code));

    const inserted: ProviderRow[] = [];
    for (let i = 0; i < toInsert.length; i += 100) {
      const chunk = toInsert.slice(i, i + 100);
      const { data, error } = await supabase
        .from("service_providers")
        .insert(chunk.map(r => ({ code: r.code, brand_name: r.brand_name, contact_person: r.contact_person || null, phone: r.phone || null, event_id: activeEvent?.id ?? null })))
        .select("code, brand_name, contact_person, phone");
      if (!error && data) inserted.push(...(data as ProviderRow[]));
    }
    setSummary({ inserted, duplicates, invalid });
    setQueue([]); setImporting(false);
  };

  const handleManualAdd = () => {
    if (!mCode.trim() || !mBrand.trim()) return;
    if (queue.some(r => r.code === mCode.trim())) { toast({ title: `Code ${mCode} already in queue`, variant: "destructive" }); return; }
    setQueue(prev => [...prev, { code: mCode.trim(), brand_name: mBrand.trim(), contact_person: mContact.trim(), phone: mPhone.trim() }]);
    setMCode(""); setMBrand(""); setMContact(""); setMPhone("");
  };

  const downloadTemplate = () => {
    const csv = "Code,Brand Name,Contact Person,Phone\n3001,TechVisions Ltd,Amaka Nwosu,08031234567\n3002,MediaPulse,Tunde Adeyemi,08051234567";
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tg100_providers_template.csv"; a.click();
  };

  const downloadSheet = () => {
    if (!summary) return;
    const rows = [["Code", "Brand Name", "Contact Person", "Phone"], ...summary.inserted.map(r => [r.code, r.brand_name, r.contact_person, r.phone])];
    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "tg100_imported_providers.csv"; a.click();
  };

  return (
    <AppLayout title="Import Service Providers" subtitle="Upload CSV / Excel (Code · Brand Name · Contact Person · Phone)">
      <div className="max-w-3xl mx-auto space-y-6">
        {summary ? (
          <div className="space-y-4">
            <div className="glass-card rounded-2xl p-6 border border-success/30 slide-up">
              <div className="flex items-start gap-4">
                <div className="p-3 bg-success/20 rounded-full shrink-0"><CheckCircle className="h-6 w-6 text-success" /></div>
                <div className="flex-1">
                  <h3 className="text-lg font-black text-foreground">Import Complete</h3>
                  <div className="flex flex-wrap gap-4 mt-2 text-sm">
                    <span className="text-success font-bold">{summary.inserted.length} imported</span>
                    {summary.duplicates.length > 0 && <span className="text-primary font-bold">{summary.duplicates.length} skipped (duplicate)</span>}
                    {summary.invalid.length > 0 && <span className="text-destructive font-bold">{summary.invalid.length} invalid</span>}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-4">
                    {summary.inserted.length > 0 && (
                      <Button onClick={downloadSheet} className="gap-2 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 font-bold">
                        <Download className="h-4 w-4" /> Download Sheet
                      </Button>
                    )}
                    <Button variant="outline" onClick={() => navigate("/service-providers")} className="gap-2 border-border">
                      <Briefcase className="h-4 w-4" /> View Providers
                    </Button>
                    <Button variant="ghost" onClick={() => { setSummary(null); setQueue([]); }} className="text-muted-foreground">Import More</Button>
                  </div>
                </div>
              </div>
            </div>
            {summary.inserted.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="px-6 py-3 border-b border-border flex justify-between items-center">
                  <span className="text-sm font-bold text-foreground">Imported</span>
                  <span className="text-xs text-muted-foreground">{summary.inserted.length}</span>
                </div>
                <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "280px" }}>
                  {summary.inserted.map((r, i) => (
                    <div key={i} className="flex items-center gap-4 px-6 py-3">
                      <div className="px-3 py-1 bg-primary/15 border border-primary/30 rounded-lg shrink-0">
                        <span className="text-sm font-black font-mono text-primary">#{r.code}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{r.brand_name}</p>
                        {r.contact_person && <p className="text-xs text-muted-foreground">{r.contact_person}</p>}
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
          </div>
        ) : (
          <>
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-foreground">Upload File</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">Columns: <span className="text-foreground font-semibold">Code · Brand Name · Contact Person · Phone</span></p>
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
                <p className="text-xs text-muted-foreground mt-1.5">Supports CSV and Excel (.xlsx)</p>
              </div>
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden"
                onChange={e => e.target.files?.[0] && parseFile(e.target.files[0])} />
            </div>

            <div className="glass-card rounded-2xl p-6">
              <div className="mb-4">
                <h3 className="text-sm font-bold text-foreground">Add Manually</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Code and Brand Name are required</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <Input value={mCode} onChange={e => setMCode(e.target.value.replace(/\D/g, ""))} placeholder="Code *" className="bg-secondary border-border focus:border-primary h-11" />
                <Input value={mBrand} onChange={e => setMBrand(e.target.value)} placeholder="Brand Name *" className="bg-secondary border-border focus:border-primary h-11 sm:col-span-2" />
                <Input value={mContact} onChange={e => setMContact(e.target.value)} placeholder="Contact Person" className="bg-secondary border-border focus:border-primary h-11" />
              </div>
              <div className="mt-3 flex gap-3">
                <Input value={mPhone} onChange={e => setMPhone(e.target.value.replace(/\D/g, ""))} placeholder="Phone" className="bg-secondary border-border focus:border-primary h-11 max-w-[200px]" />
                <Button onClick={handleManualAdd} disabled={!mCode.trim() || !mBrand.trim()} variant="outline" className="gap-2 border-border">
                  <Plus className="h-4 w-4" /> Add to Queue
                </Button>
              </div>
            </div>

            {queue.length > 0 && (
              <div className="glass-card rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                  <div>
                    <h3 className="text-sm font-bold text-foreground">{queue.length} providers queued</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">Review, then click Import</p>
                  </div>
                  <Button onClick={handleImport} disabled={importing} className="gap-2 bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90 font-bold">
                    {importing ? <><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />Importing...</> : <><Upload className="h-4 w-4" />Import {queue.length}</>}
                  </Button>
                </div>
                <div className="grid grid-cols-[60px_1fr_140px_36px] gap-4 px-6 py-2 bg-secondary/50 text-xs font-bold uppercase tracking-wider text-muted-foreground border-b border-border">
                  <span>Code</span><span>Brand</span><span>Contact</span><span></span>
                </div>
                <div className="divide-y divide-border overflow-y-auto" style={{ maxHeight: "320px" }}>
                  {queue.map((row, i) => {
                    const err = validateRow(row, i);
                    return (
                      <div key={i} className={cn("grid grid-cols-[60px_1fr_140px_36px] gap-4 items-center px-6 py-3", err && "bg-destructive/5")}>
                        <span className="text-xs font-mono font-bold text-primary truncate">#{row.code}</span>
                        <span className="text-sm text-foreground truncate">{row.brand_name || <span className="text-destructive">—</span>}</span>
                        <span className="text-xs text-muted-foreground truncate">{row.contact_person || "—"}</span>
                        <button onClick={() => setQueue(q => q.filter((_, idx) => idx !== i))} className="text-muted-foreground hover:text-destructive">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="px-6 py-3 border-t border-border bg-secondary/30 flex justify-between">
                  <button onClick={() => setQueue([])} className="text-xs text-muted-foreground hover:text-destructive">Clear all</button>
                  <span className="text-xs text-muted-foreground">{queue.filter((r, i) => !validateRow(r, i)).length} valid · {queue.filter((r, i) => !!validateRow(r, i)).length} invalid</span>
                </div>
              </div>
            )}

            <div className="glass-card rounded-xl px-5 py-4">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground space-y-1.5">
                  <p><span className="text-foreground font-semibold">Required:</span> Code (numeric), Brand Name</p>
                  <p><span className="text-foreground font-semibold">Optional:</span> Contact Person, Phone</p>
                  <p><span className="text-foreground font-semibold">Note:</span> Service Providers are tracked for check-in attendance only</p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}
