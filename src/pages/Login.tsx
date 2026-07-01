import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { getAllOfflineUsers, OfflineAuthEntry } from "@/lib/offlineAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SoulcommsLogo } from "@/components/brand/SoulcommsLogo";
import { Eye, EyeOff, LogIn, WifiOff, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { speak, VM } from "@/lib/voice";

export default function Login() {
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [isOnline, setIsOnline]         = useState(navigator.onLine);
  const [cachedUsers, setCachedUsers]   = useState<OfflineAuthEntry[]>([]);

  const { signIn } = useAuth();
  const navigate   = useNavigate();
  const { toast }  = useToast();

  // Track online/offline state
  useEffect(() => {
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Load cached offline users
  useEffect(() => {
    getAllOfflineUsers().then(setCachedUsers).catch(() => {});
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      speak(isOnline ? VM.login_success : VM.offline_login);
      navigate("/dashboard");
    }
  };

  const fillCachedUser = (u: OfflineAuthEntry) => {
    setEmail(u.email);
    // Focus password field
    setTimeout(() => document.getElementById("password")?.focus(), 50);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      {/* Background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <SoulcommsLogo size="md" />
          </div>
          <h1 className="text-xl font-black text-foreground tracking-tight">
            Staff Portal
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 uppercase tracking-[2px]">
            Event Management Platform
          </p>
        </div>

        {/* Offline banner */}
        {!isOnline && (
          <div className="mb-4 flex items-start gap-3 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 slide-up">
            <WifiOff className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-amber-400">Offline Mode Active</p>
              <p className="text-[11px] text-amber-400/80 mt-0.5 leading-relaxed">
                Changes will synchronize automatically when connection is restored.
                {cachedUsers.length > 0
                  ? " Previously logged-in accounts shown below."
                  : " Internet required for first-time login."}
              </p>
            </div>
          </div>
        )}

        {/* Cached users quick-select (offline only) */}
        {!isOnline && cachedUsers.length > 0 && (
          <div className="mb-4 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-[2px] text-muted-foreground px-1">
              Previously logged-in accounts
            </p>
            {cachedUsers.map(u => (
              <button key={u.email} onClick={() => fillCachedUser(u)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl glass-card",
                  "text-left hover:border-primary/40 transition-all group border border-transparent"
                )}>
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">{u.profile.name}</p>
                  <p className="text-[11px] text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground capitalize">
                    {u.profile.role.replace(/_/g, " ")}
                  </span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Form */}
        <div className="glass-card rounded-2xl p-8">
          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Staff Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@tg100.com"
                required
                className="bg-secondary border-border focus:border-primary h-12"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-secondary border-border focus:border-primary h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-12 text-sm font-bold uppercase tracking-wider bg-primary text-primary-foreground hover:bg-primary/90 shadow-glow-primary"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  {isOnline ? "Signing In…" : "Verifying Offline…"}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  {isOnline ? <LogIn className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
                  {isOnline ? "Sign In" : "Sign In Offline"}
                </span>
              )}
            </Button>
          </form>

          {/* Status indicator inside form */}
          <div className="mt-4 flex items-center justify-center gap-2">
            <div className={cn(
              "w-1.5 h-1.5 rounded-full",
              isOnline ? "bg-success" : "bg-amber-400"
            )} />
            <span className="text-[10px] text-muted-foreground">
              {isOnline ? "Online" : "Offline Mode"}
            </span>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          Contact admin to get your staff credentials
        </p>
        <p className="text-center text-xs text-muted-foreground mt-2">
          First time?{" "}
          <Link to="/setup" className="text-primary hover:underline">
            Create admin account
          </Link>
        </p>
      </div>
    </div>
  );
}
