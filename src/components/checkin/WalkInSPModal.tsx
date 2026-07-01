import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWalkInSP, WalkInSPRecord } from "@/lib/offlineStore";
import { useToast } from "@/hooks/use-toast";
import { Briefcase, CheckCircle, X, RotateCcw, Copy, ScanLine } from "lucide-react";

interface WalkInSPModalProps {
  eventId: string;
  onClose: () => void;
  onRegistered?: (record: WalkInSPRecord) => void;
}

type Step = "form" | "success";

const BRAND_SUGGESTIONS = [
  "MTN", "Market 100 Vendor", "Beauty Hub",
  "ABC Catering", "XYZ Fashion", "Event Sponsor",
];

export function WalkInSPModal({ eventId, onClose, onRegistered }: WalkInSPModalProps) {
  const [step, setStep]               = useState<Step>("form");
  const [brandName, setBrandName]     = useState("");
  const [contactPerson, setContactPerson] = useState("");
  const [phone, setPhone]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [record, setRecord]           = useState<WalkInSPRecord | null>(null);
  const { toast } = useToast();

  const handleRegister = async () => {
    if (!brandName.trim()) return;
    setLoading(true);
    try {
      const r = await createWalkInSP(brandName, contactPerson || null, phone || null, eventId);
      setRecord(r);
      setStep("success");
      onRegistered?.(r);
    } catch {
      toast({ title: "Registration failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!record) return;
    navigator.clipboard.writeText(record.temp_code).then(() => {
      toast({ title: "Code copied" });
    });
  };

  const handleReset = () => {
    setStep("form");
    setBrandName("");
    setContactPerson("");
    setPhone("");
    setRecord(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-card border border-blue-500/20 rounded-2xl shadow-2xl overflow-hidden slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-500/10">
              <Briefcase className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Walk-In Service Provider</p>
              <p className="text-[10px] text-muted-foreground">Auto check-in · Offline supported</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        {step === "form" && (
          <div className="p-5 space-y-4">
            {/* Brand Name */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Brand Name <span className="text-primary">*</span>
              </label>
              <Input
                value={brandName}
                onChange={e => setBrandName(e.target.value)}
                placeholder="e.g. Beauty Hub"
                className="h-11 bg-secondary border-border focus:border-primary"
                autoFocus
                disabled={loading}
              />
              {/* Suggestions */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {BRAND_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setBrandName(s)}
                    className="text-[10px] px-2 py-1 rounded-full border border-border bg-secondary hover:border-primary hover:text-primary transition-colors text-muted-foreground font-semibold"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Contact Person */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Contact Person <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={contactPerson}
                onChange={e => setContactPerson(e.target.value)}
                placeholder="Representative's full name"
                className="h-11 bg-secondary border-border focus:border-primary"
                disabled={loading}
                onKeyDown={e => { if (e.key === "Enter" && brandName.trim()) handleRegister(); }}
              />
            </div>

            {/* Phone */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Phone Number <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <Input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="08XXXXXXXXX"
                type="tel"
                className="h-11 bg-secondary border-border focus:border-primary"
                disabled={loading}
              />
            </div>

            <Button
              onClick={handleRegister}
              disabled={loading || !brandName.trim()}
              className="w-full h-12 font-bold bg-blue-600 text-white hover:bg-blue-700"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Registering…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4" />Register &amp; Check In
                </span>
              )}
            </Button>
          </div>
        )}

        {/* Success */}
        {step === "success" && record && (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-blue-500/15 shrink-0">
                <CheckCircle className="h-6 w-6 text-blue-500" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-blue-500">Registered &amp; Checked In</p>
                <p className="text-xl font-black text-foreground">{record.brand_name}</p>
                {record.contact_person && <p className="text-xs text-muted-foreground">{record.contact_person}</p>}
                {record.phone && <p className="text-xs text-muted-foreground">{record.phone}</p>}
              </div>
            </div>

            {/* Code display */}
            <div className="rounded-xl bg-secondary border border-border p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground mb-2">Service Provider Code</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-black font-mono tracking-[4px] text-blue-500">
                  {record.temp_code}
                </span>
                <button onClick={handleCopy} className="p-2 rounded-lg bg-secondary hover:bg-border transition-colors text-muted-foreground hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Syncs to database when online</p>
            </div>

            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-500/10 border border-blue-500/30">
              <ScanLine className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-bold text-blue-500">Checked In Successfully</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={handleReset} className="flex-1 gap-2 border-border">
                <RotateCcw className="h-4 w-4" />New Provider
              </Button>
              <Button variant="outline" onClick={onClose} className="flex-1 border-border">
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
