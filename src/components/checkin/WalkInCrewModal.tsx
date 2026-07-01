import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createWalkInCrew, WalkInCrewRecord } from "@/lib/offlineStore";
import { useToast } from "@/hooks/use-toast";
import { HardHat, CheckCircle, X, RotateCcw, Copy, ScanLine } from "lucide-react";

interface WalkInCrewModalProps {
  eventId: string;
  onClose: () => void;
  onRegistered?: (record: WalkInCrewRecord) => void;
}

type Step = "form" | "success";

const TEAM_SUGGESTIONS = [
  "Media Team", "Registration Team", "Security Team",
  "Logistics Team", "Technical Team", "Volunteer Team", "Management Team",
];

export function WalkInCrewModal({ eventId, onClose, onRegistered }: WalkInCrewModalProps) {
  const [step, setStep]       = useState<Step>("form");
  const [teamName, setTeamName] = useState("");
  const [name, setName]       = useState("");
  const [phone, setPhone]     = useState("");
  const [loading, setLoading] = useState(false);
  const [record, setRecord]   = useState<WalkInCrewRecord | null>(null);
  const { toast } = useToast();

  const handleRegister = async () => {
    if (!teamName.trim() || !name.trim()) return;
    setLoading(true);
    try {
      const r = await createWalkInCrew(name, teamName, phone || null, eventId);
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
    setTeamName("");
    setName("");
    setPhone("");
    setRecord(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm bg-card border border-success/20 rounded-2xl shadow-2xl overflow-hidden slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-success/10">
              <HardHat className="h-4 w-4 text-success" />
            </div>
            <div>
              <p className="text-sm font-black text-foreground">Walk-In Crew Registration</p>
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
            {/* Team Name */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Team Name <span className="text-primary">*</span>
              </label>
              <Input
                value={teamName}
                onChange={e => setTeamName(e.target.value)}
                placeholder="e.g. Media Team"
                className="h-11 bg-secondary border-border focus:border-primary"
                autoFocus
                disabled={loading}
              />
              {/* Suggestions */}
              <div className="flex flex-wrap gap-1.5 mt-2">
                {TEAM_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setTeamName(s)}
                    className="text-[10px] px-2 py-1 rounded-full border border-border bg-secondary hover:border-primary hover:text-primary transition-colors text-muted-foreground font-semibold"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Member Name */}
            <div>
              <label className="text-[10px] font-black uppercase tracking-wider text-muted-foreground block mb-1.5">
                Crew Member Name <span className="text-primary">*</span>
              </label>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Enter full name"
                className="h-11 bg-secondary border-border focus:border-primary"
                disabled={loading}
                onKeyDown={e => { if (e.key === "Enter" && teamName.trim() && name.trim()) handleRegister(); }}
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
              disabled={loading || !teamName.trim() || !name.trim()}
              className="w-full h-12 font-bold bg-success text-white hover:bg-success/90"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Registering…
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <HardHat className="h-4 w-4" />Register &amp; Check In
                </span>
              )}
            </Button>
          </div>
        )}

        {/* Success */}
        {step === "success" && record && (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-full bg-success/15 shrink-0">
                <CheckCircle className="h-6 w-6 text-success" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-[2px] text-success">Registered &amp; Checked In</p>
                <p className="text-xl font-black text-foreground">{record.name}</p>
                <p className="text-xs text-muted-foreground">{record.team_name}</p>
                {record.phone && <p className="text-xs text-muted-foreground">{record.phone}</p>}
              </div>
            </div>

            {/* Code display */}
            <div className="rounded-xl bg-secondary border border-border p-4 text-center">
              <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground mb-2">Crew Code</p>
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-black font-mono tracking-[4px] text-success glow-pulse">
                  {record.temp_code}
                </span>
                <button onClick={handleCopy} className="p-2 rounded-lg bg-secondary hover:bg-border transition-colors text-muted-foreground hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">Syncs to database when online</p>
            </div>

            <div className="flex items-center justify-center gap-2 py-3 rounded-xl bg-success/10 border border-success/30">
              <ScanLine className="h-4 w-4 text-success" />
              <span className="text-sm font-bold text-success">Checked In Successfully</span>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={handleReset} className="flex-1 gap-2 border-border">
                <RotateCcw className="h-4 w-4" />New Crew
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
