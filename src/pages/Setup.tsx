import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ArrowLeft } from "lucide-react";

export default function Setup() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    const { data, error } = await supabase.functions.invoke("setup-admin", {
      body: { name, email, password },
    });

    setLoading(false);

    if (error || data?.error) {
      toast({ title: "Setup failed", description: error?.message || data?.error, variant: "destructive" });
    } else {
      setDone(true);
      toast({ title: "Admin account created!", description: "You can now log in." });
      setTimeout(() => navigate("/login"), 2000);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="px-3 py-1 bg-primary rounded-md">
              <span className="text-xs font-black tracking-[3px] text-primary-foreground">MTN</span>
            </div>
          </div>
          <h1 className="text-2xl font-black text-foreground tracking-tight">
            INITIAL SETUP
          </h1>
          <p className="text-xs text-muted-foreground mt-2">Create your admin account to get started.</p>
        </div>

        <div className="glass-card rounded-2xl p-8">
          {done ? (
            <div className="text-center py-4">
              <ShieldCheck className="h-12 w-12 text-success mx-auto mb-3" />
              <h3 className="text-lg font-bold text-foreground">Admin Created!</h3>
              <p className="text-sm text-muted-foreground mt-1">Redirecting to login...</p>
            </div>
          ) : (
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Full Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your Name" required className="bg-secondary border-border focus:border-primary h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@tg100.com" required className="bg-secondary border-border focus:border-primary h-11" />
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Password</Label>
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" minLength={8} required className="bg-secondary border-border focus:border-primary h-11" />
              </div>
              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 font-bold uppercase tracking-wider bg-primary text-primary-foreground shadow-glow-primary hover:bg-primary/90"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                    Creating...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Create Admin Account
                  </span>
                )}
              </Button>
            </form>
          )}
        </div>

        <div className="text-center mt-6">
          <Link to="/login" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3 w-3" />
            Back to Login
          </Link>
        </div>
      </div>
    </div>
  );
}
