import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWalkIn, WalkInRecord } from "@/lib/offlineStore";
import { useToast } from "@/hooks/use-toast";
import { UserPlus, CheckCircle, X, RotateCcw, Copy, ScanLine } from "lucide-react";
import { trackEvent } from "@enter-pro/analytics-sdk";

interface WalkInModalProps {
  eventId: string;
  onClose: () => void;
  onRegistered?: (record: WalkInRecord, checkedIn: boolean) => void;
}

type Step = "form" | "success";

export function WalkInModal({ eventId, onClose, onRegistered }: WalkInModalProps) {
  const [step, setStep] = useState<Step>("form");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [walkin, setWalkin] = useState<WalkInRecord | null>(null);
  const { toast } = useToast();

  // Single-step: register AND check-in atomically
  const handleRegister = async () => {
    if (!name.trim()) return;
    setLoading(true);
    try {
      const record = await createWalkIn(name, phone || null, eventId, true);
      setWalkin(record);
      setStep("success");
      trackEvent("walkin_registered", {
        eventType: "conversion",
        properties: { has_phone: !!phone },
      });
      onRegistered?.(record, true);
    } catch {
      toast({ title: "Registration failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!walkin) return;
    navigator.clipboard.writeText(walkin.temp_code).then(() => {
      toast({ title: "Code copied" });
    });
  };

  const handleDone = () => onClose();

  const handleReset = () => {
    setStep("form");
    setName("");
    setPhone("");
    setWalkin(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-card border border-primary/20 rounded-2xl shadow-2xl overflow-hidden slide-up">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <UserPlus className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Walk-In Registration</p>
              <p className="text-[10px] text-muted-foreground">Offline · Syncs when online</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form step */}
        {step === "form" && (
          <div className="p-5 space-y-4">
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Full Name <span className="text-primary">*</span>
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Enter full name"
                className="h-12 bg-secondary border-border focus:border-primary"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && name.trim()) handleRegister(); }}
                disabled={loading}
              />
            </div>
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Phone Number
              </label>
              <Input
                value={phone}
                onChange={e => setPhone(e.target.value)}
                placeholder="08XXXXXXXXX"
                className="h-12 bg-secondary border-border focus:border-primary"
                type="tel"
                disabled={loading}
              />
            </div>
            <Button
              onClick={handleRegister}
              disabled={loading || !name.trim()}
              className="w-full h-12 font-bold bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-primary"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Registering & Checking In…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />Add Participant &amp; Check-In
                </span>
              )}
            </Button>
          </div>
        )}

        {/* Success step — participant is already registered + checked in */}
        {step === "success" && walkin && (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-success/15 shrink-0">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-success">Registered &amp; Checked In</p>
                <p className="text-xl font-black text-foreground">{walkin.name}</p>
                {walkin.phone && (
                  <p className="text-xs text-muted-foreground">{walkin.phone}</p>
                )}
              </div>
            </div>

            {/* Temp code display */}
            <div className="rounded-xl bg-secondary border border-border p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground mb-2">
                Temporary Code
              </p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-black font-mono tracking-[6px] text-primary glow-pulse">
                  {walkin.temp_code}
                </span>
                <button
                  onClick={handleCopy}
                  className="p-2 rounded-lg bg-secondary hover:bg-border transition-colors text-muted-foreground hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Use this code to record activities offline
              </p>
            </div>

            {/* Checked-in confirmation pill */}
            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-success/10 border border-success/30">
              <ScanLine className="h-4 w-4 text-success" />
              <span className="text-sm font-bold text-success">Checked In — Ready for Activities</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={handleReset} className="flex-1 gap-2 border-border">
                <RotateCcw className="h-4 w-4" />New Walk-In
              </Button>
              <Button variant="outline" onClick={handleDone} className="flex-1 border-border">
                Done
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
