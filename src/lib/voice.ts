/**
 * voice.ts — Singleton Web Speech API wrapper for Solution™ Voice Assistant
 * Works offline (browser-native), no API calls needed.
 */

const STORAGE_KEY = "sc_voice";

// ─── Settings ────────────────────────────────────────────────────────────────
export interface VoiceSettings {
  enabled: boolean;
  volume: number;   // 0.0 – 1.0
  rate: number;     // 0.5 – 1.5 (1.0 = normal speed)
}

const DEFAULTS: VoiceSettings = { enabled: true, volume: 1.0, rate: 0.95 };

export function getVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveVoiceSettings(patch: Partial<VoiceSettings>): void {
  const current = getVoiceSettings();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
}

// ─── Voice selection ─────────────────────────────────────────────────────────
// Voices load asynchronously in some browsers — cache after first pick.
let _cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (_cachedVoice) return _cachedVoice;
  if (!("speechSynthesis" in window)) return null;
  const all = window.speechSynthesis.getVoices();
  if (!all.length) return null;

  // Priority list — prefer natural-sounding English voices
  const PREFERRED = [
    "Google UK English Female",
    "Microsoft Sonia Online (Natural) - English (United Kingdom)",
    "Microsoft Libby Online (Natural) - English (United Kingdom)",
    "Microsoft Aria Online (Natural) - English (United States)",
    "Karen",
    "Samantha",
    "Google US English",
    "Microsoft Zira Desktop - English (United States)",
  ];
  for (const name of PREFERRED) {
    const v = all.find(v => v.name === name);
    if (v) { _cachedVoice = v; return v; }
  }
  // Fallback: first English voice
  const eng = all.find(v => v.lang.startsWith("en"));
  _cachedVoice = eng ?? all[0];
  return _cachedVoice;
}

// Re-pick when voices list loads (Chrome fires voiceschanged)
if ("speechSynthesis" in window) {
  window.speechSynthesis.onvoiceschanged = () => { _cachedVoice = null; };
}

// ─── Core speak function ──────────────────────────────────────────────────────
export function speak(text: string): void {
  if (!("speechSynthesis" in window)) return;
  const s = getVoiceSettings();
  if (!s.enabled || !text) return;

  window.speechSynthesis.cancel();             // stop any current speech
  const utt = new SpeechSynthesisUtterance(text);
  utt.volume = s.volume;
  utt.rate   = s.rate;
  utt.pitch  = 1.0;
  const voice = pickVoice();
  if (voice) utt.voice = voice;
  window.speechSynthesis.speak(utt);
}

export function cancelSpeech(): void {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}

// ─── Voice Messages Catalog ───────────────────────────────────────────────────
export const VM = {
  // Welcome
  welcome: "Hello. I am Solution. I am here to assist you.",

  // Check-In — Participant
  checkin_success:      "Participant found. Check-in completed successfully.",
  checkin_already:      "This participant has already been checked in.",
  checkin_not_found:    "Participant not found. If the attendee has already registered, click Add Participant and enter their details.",
  checkin_qr_not_found: "This QR code is not available in the current database. Click Add Participant to register and check in the attendee.",
  walkin_complete:      "Walk-in participant registered successfully and checked in.",
  qr_registered:        "QR registration completed. Participant is now checked in.",

  // Check-In — Service Provider
  sp_success:      "Service provider found. Check-in completed successfully.",
  sp_already:      "This service provider has already been checked in.",
  sp_not_found:    "Service provider not found. Please verify the code and try again.",

  // Check-In — Crew
  crew_success:    "Crew member found. Check-in completed successfully.",
  crew_already:    "This crew member has already been checked in.",
  crew_not_found:  "Crew member not found. Please verify the code and try again.",

  // Activity Recorder
  activity_success:       "Participant verified. Access granted. Activity participation recorded.",
  activity_already:       "Participant already recorded for this activity.",
  activity_not_found:     "Participant cannot be verified. Please send them to the Check-In Station for registration.",
  activity_not_checked_in:"This participant has not completed event check-in. Please direct them to the Check-In Station.",

  // Connectivity
  offline_mode:    "Offline mode activated. You may continue operations. All records will synchronize automatically when connectivity is restored.",
  online_restored: "Connection restored. Synchronization in progress.",
  sync_complete:   "Synchronization completed successfully.",

  // Login
  login_success:   "Welcome. Login successful.",
  offline_login:   "Offline login successful. You may continue working.",
  unauthorized:    "You do not have permission to access this section.",

  // Errors — plain language
  permission_error:"Unable to complete this action due to a permission issue. Please contact an administrator.",
} as const;

export type VMKey = keyof typeof VM;
