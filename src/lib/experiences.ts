import {
  Music, Palette, Mic, Shirt, Hammer, Bike,
  Sparkles, MessageSquareHeart, Joystick, Film, Zap,
  ShoppingBag, Headset, Music2, Gamepad2, Trophy, Star,
  Heart, Flame, Globe, Camera, Coffee, BookOpen, type LucideIcon,
} from "lucide-react";
import {
  FaVrCardboard,
  FaChessKing,
  FaMusic,
  FaCarSide,
  FaTableTennisPaddleBall,
  FaDice,
  FaChessBoard,
  FaBuildingColumns,
  FaCubesStacked,
  FaHandSparkles,
  FaSprayCanSparkles,
  FaPaintbrush,
  FaPerson,
  FaGem,
  FaEye,
  FaScissors,
  type IconType,
} from "react-icons/fa6";

// ─── Legacy hardcoded list (kept for backward-compat lookup of old logs) ──────
export interface Experience {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
  group?: string;
}

export const EXPERIENCES: Experience[] = [
  { id: "club100", name: "Club 100", icon: Music, color: "hsl(320 100% 65%)" },
  { id: "sip_and_paint", name: "Sip & Paint", icon: Palette, color: "hsl(25 100% 55%)" },
  { id: "podcast", name: "Podcast", icon: Mic, color: "hsl(200 100% 55%)" },
  { id: "fashion_runway", name: "Fashion Runway", icon: Shirt, color: "hsl(340 90% 60%)" },
  { id: "craft_to_cash", name: "Craft to Cash", icon: Hammer, color: "hsl(30 95% 55%)" },
  { id: "creators_circle", name: "Creators Circle", icon: Bike, color: "hsl(150 80% 45%)" },
  { id: "beauty_hub", name: "Beauty Hub", icon: Sparkles, color: "hsl(300 90% 65%)" },
  { id: "confession_booth", name: "Confession Booth", icon: MessageSquareHeart, color: "hsl(350 90% 60%)" },
  { id: "game_arcade", name: "Game Arcade", icon: Joystick, color: "hsl(180 100% 45%)" },
  { id: "movie_lounge", name: "Movie Lounge", icon: Film, color: "hsl(210 100% 60%)" },
  { id: "pitchathon", name: "Pitchathon", icon: Zap, color: "hsl(47 100% 50%)" },
  { id: "market_100", name: "Market 100", icon: ShoppingBag, color: "hsl(60 90% 50%)" },
  { id: "esport_vr", name: "Esport – VR", icon: Headset, color: "hsl(280 100% 65%)", group: "esport" },
  { id: "esport_dancing", name: "Esport – Dancing Game", icon: Music2, color: "hsl(265 100% 65%)", group: "esport" },
  { id: "esport_console", name: "Esport – Console Game", icon: Gamepad2, color: "hsl(250 100% 70%)", group: "esport" },
];

export const getExperience = (id: string): Experience | undefined =>
  EXPERIENCES.find(e => e.id === id);

// ─── Icon map for DB-driven activities ────────────────────────────────────────
export type ActivityIcon = LucideIcon | IconType;

export const ICON_MAP: Record<string, ActivityIcon> = {
  Zap, Music, Palette, Mic, Shirt, Hammer, Sparkles, MessageSquareHeart,
  Joystick, Film, ShoppingBag, Headset, Music2, Gamepad2, Trophy, Star,
  Heart, Flame, Globe, Camera, Coffee, BookOpen,
  FaVrCardboard,
  FaChessKing,
  FaMusic,
  FaCarSide,
  FaTableTennisPaddleBall,
  FaDice,
  FaChessBoard,
  FaBuildingColumns,
  FaCubesStacked,
  FaHandSparkles,
  FaSprayCanSparkles,
  FaPaintbrush,
  FaPerson,
  FaGem,
  FaEye,
  FaScissors,
};

export const ICON_NAMES = Object.keys(ICON_MAP) as (keyof typeof ICON_MAP)[];

const normalizeIconLookup = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const ICON_ALIASES: Record<string, keyof typeof ICON_MAP> = {
  kingofconsole: "FaChessKing",
  console: "FaChessKing",
  esportconsole: "FaChessKing",
  vr: "FaVrCardboard",
  virtualreality: "FaVrCardboard",
  esportvr: "FaVrCardboard",
  justdance: "FaMusic",
  dancinggame: "FaMusic",
  racing: "FaCarSide",
  snooker: "FaTableTennisPaddleBall",
  tabletennis: "FaTableTennisPaddleBall",
  pingpong: "FaTableTennisPaddleBall",
  ludo: "FaDice",
  chess: "FaChessKing",
  scrabble: "FaChessBoard",
  whot: "FaDice",
  monopoly: "FaBuildingColumns",
  jenga: "FaCubesStacked",
  henna: "FaHandSparkles",
  tatoo: "FaSprayCanSparkles",
  tattoo: "FaSprayCanSparkles",
  facepainting: "FaPaintbrush",
  braid: "FaPerson",
  braids: "FaPerson",
  nails: "FaGem",
  lashes: "FaEye",
  barbing: "FaScissors",
};

// Resolve icon from DB icon_name string, fallback to Zap
export const resolveIcon = (iconName: string | null | undefined): ActivityIcon => {
  const raw = iconName ?? "";
  if (ICON_MAP[raw]) return ICON_MAP[raw];

  const alias = ICON_ALIASES[normalizeIconLookup(raw)];
  if (alias) return ICON_MAP[alias];

  return Zap;
};

// ─── Preset colors for the color picker ──────────────────────────────────────
export const PRESET_COLORS = [
  "hsl(0 85% 52%)", "hsl(320 100% 65%)", "hsl(350 90% 60%)",
  "hsl(25 100% 55%)", "hsl(47 100% 50%)", "hsl(60 90% 50%)",
  "hsl(150 80% 45%)", "hsl(180 100% 45%)", "hsl(200 100% 55%)",
  "hsl(210 100% 60%)", "hsl(265 100% 65%)", "hsl(280 100% 65%)",
];
