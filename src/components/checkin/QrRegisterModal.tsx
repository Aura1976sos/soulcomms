import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useNetwork } from "@/contexts/NetworkContext";
import { createQrParticipant } from "@/lib/offlineStore";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  X, QrCode, CheckCircle, AlertTriangle, UserPlus, Loader2,
} from "lucide-react";

interface QrRegisterModalProps {
  qrUrl: string;
  eventId: string;
  onClose: () => void;
  onRegistered: (participant: { id: string; code: string; name: string }, checkedIn: boolean) => void;
}

type Step = "form" | "duplicate" | "success";

export function QrRegisterModal({ qrUrl, eventId, onClose, onRegistered }: QrRegisterModalProps) {
  const { online, refreshPending } = useNetwork();

  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ id: string; code: string; name: string } | null>(null);
  const [isOfflineQueued, setIsOfflineQueued] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) return;
    setLoading(true);
    setError("");

    try {
      if (online) {
        // ── ONLINE: check duplicates server-side ──────────────────────────
        const normalizedCode = code.replace(/^#/, "").trim().padStart(4, "0");

        // Check by QR link
        const { data: byQr } = await supabase
          .from("participants")
          .select("id, name, code")
          .eq("event_id", eventId)
          .eq("qr_link", qrUrl)
          .maybeSingle();

        if (byQr) {
          setStep("duplicate");
          setCreated({ id: byQr.id, code: byQr.code, name: byQr.name });
          return;
        }

        // Check by registration code
        const { data: byCode } = await supabase
          .from("participants")
          .select("id, name, code")
          .eq("event_id", eventId)
          .eq("code", normalizedCode)
          .maybeSingle();

        if (byCode) {
          setStep("duplicate");
          setCreated({ id: byCode.id, code: byCode.code, name: byCode.name });
          return;
        }

        // Create participant
        const { data: newP, error: insertErr } = await supabase
          .from("participants")
          .insert({
            code: normalizedCode,
            name: name.trim(),
            phone: phone.trim() || null,
            qr_link: qrUrl,
            event_id: eventId,
            source: "QR Registration",
            is_checked_in: true,
            checked_in_at: new Date().toISOString(),
            check_in_method: "QR Scan",
          })
          .select("id, code, name")
          .single();

        if (insertErr) throw new Error(insertErr.message);
        setCreated(newP);
        setStep("success");
        onRegistered(newP, true);

      } else {
        // ── OFFLINE: use IndexedDB ────────────────────────────────────────
        const record = await createQrParticipant(
          name, code, qrUrl, phone.trim() || null, eventId
        );
        const p = { id: record.id, code: record.temp_code, name: record.name };
        setCreated(p);
        setIsOfflineQueued(true);
        setStep("success");
        await refreshPending();
        onRegistered(p, true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("already exists") || msg.toLowerCase().includes("unique")) {
        setError("A participant with this QR code or registration code already exists.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-md bg-card border border-primary/20 rounded-2xl shadow-2xl overflow-hidden slide-up">

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="p-2 rounded-lg bg-primary/20">
            <UserPlus className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-foreground">
              {step === "duplicate" ? "Participant Already Exists" : "Register from QR Code"}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {step === "success" ? "Created & checked in successfully" : "QR not in database — register and check in"}
            </p>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* QR URL pill */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-secondary border border-border">
            <QrCode className="h-3.5 w-3.5 text-primary shrink-0" />
            <p className="text-[11px] font-mono text-muted-foreground truncate">{qrUrl}</p>
            {!online && (
              <span className="ml-auto shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                Offline
              </span>
            )}
          </div>
        </div>

        {/* ── Form step ────────────────────────────────────────────────────── */}
        {step === "form" && (
          <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
            <div>
              <label className="field-label">Full Name *</label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Daniel Abolaji"
                required
                autoFocus
                className="bg-secondary border-border focus:border-primary h-12"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="field-label">Registration Code *</label>
                <Input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="#0245"
                  required
                  className="bg-secondary border-border focus:border-primary h-12"
                />
                <p className="text-[10px] text-muted-foreground mt-1">From attendee's confirmation</p>
              </div>
              <div>
                <label className="field-label">Phone (optional)</label>
                <Input
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="08XXXXXXXXX"
                  type="tel"
                  className="bg-secondary border-border focus:border-primary h-12"
                />
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-xs">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />{error}
              </div>
            )}

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1 border-border">
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading || !name.trim() || !code.trim()}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 gap-2 font-bold"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" />Saving…</>
                ) : (
                  <><UserPlus className="h-4 w-4" />Register &amp; Check In</>
                )}
              </Button>
            </div>
          </form>
        )}

        {/* ── Duplicate step ────────────────────────────────────────────────── */}
        {step === "duplicate" && created && (
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
              <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-foreground">Participant already exists</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This QR or code matches an existing record.
                </p>
              </div>
            </div>
            <div className="px-4 py-3 rounded-xl bg-secondary border border-border">
              <p className="text-lg font-black text-foreground">{created.name}</p>
              <p className="text-sm font-mono text-muted-foreground mt-0.5">#{created.code}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center">
              Please use the main check-in form to check this participant in.
            </p>
            <Button onClick={onClose} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Close & Try Check-In
            </Button>
          </div>
        )}

        {/* ── Success step ──────────────────────────────────────────────────── */}
        {step === "success" && created && (
          <div className="px-5 py-6 space-y-4">
            <div className="flex flex-col items-center text-center gap-3 py-2">
              <div className="p-3 rounded-full bg-success/20">
                <CheckCircle className="h-8 w-8 text-success" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-success mb-1">
                  Registered &amp; Checked In{isOfflineQueued ? " (Queued)" : ""}
                </p>
                <h3 className="text-2xl font-black text-foreground">{created.name}</h3>
                <p className="text-sm font-mono text-muted-foreground mt-1">#{created.code}</p>
                <p className="text-xs text-muted-foreground mt-1 font-mono break-all opacity-60">{qrUrl}</p>
              </div>
              {isOfflineQueued && (
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-400">
                  Will sync automatically when online
                </span>
              )}
            </div>
            <Button onClick={onClose} className="w-full bg-primary text-primary-foreground hover:bg-primary/90">
              Done
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
