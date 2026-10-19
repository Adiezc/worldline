// Flag references (Country.flag). The client renders them; this module parses, validates and
// derives generated flags so the server, scenario tools and client agree on the format:
//   "iso:fr"                          real flag by ISO 3166-1 alpha-2 code
//   "hist:<id>"                       historical flag shipped with the client
//   "gen:<pattern>:<c1>,<c2>[,<c3>]"  generated flag

import { colorDistance } from "./colors.ts";

export const FLAG_PATTERNS = ["vertical", "horizontal", "bicolor-v", "bicolor-h", "nordic", "canton", "diagonal", "triband-star"] as const;
export type FlagPattern = (typeof FLAG_PATTERNS)[number];

export type ParsedFlag =
  | { kind: "iso"; code: string }
  | { kind: "hist"; id: string }
  | { kind: "gen"; pattern: FlagPattern; colors: string[] };

const HEX = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i;

function normHex(c: string): string | null {
  const m = HEX.exec(c.trim());
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return "#" + (h.length === 3 ? [...h].map((x) => x + x).join("") : h);
}

/** Parse a flag reference; null when missing or malformed. */
export function parseFlag(flag: string | undefined | null): ParsedFlag | null {
  if (!flag || typeof flag !== "string") return null;
  const [kind, a, b] = flag.trim().split(":");
  if (kind === "iso" && a && /^[a-z]{2}(-[a-z]{2,3})?$/i.test(a)) return { kind: "iso", code: a.toLowerCase() };
  if (kind === "hist" && a && /^[a-z0-9-]{1,32}$/i.test(a)) return { kind: "hist", id: a.toLowerCase() };
  if (kind === "gen" && a && b) {
    const pattern = a.toLowerCase() as FlagPattern;
    if (!FLAG_PATTERNS.includes(pattern)) return null;
    const colors = b.split(",").map(normHex);
    if (colors.length < 2 || colors.length > 3 || colors.some((c) => !c)) return null;
    return { kind: "gen", pattern, colors: colors as string[] };
  }
  return null;
}

/** Build a "gen:" reference (colours normalised to lowercase #rrggbb). */
export function genFlag(pattern: FlagPattern, colors: string[]): string {
  const cs = colors.map(normHex).filter((c): c is string => !!c).slice(0, 3);
  while (cs.length < 2) cs.push(cs.length ? "#f4f1e8" : "#8a8a8a");
  return `gen:${pattern}:${cs.join(",")}`;
}

/** A normalised "gen:" reference, or undefined when the value is not a valid generated flag. */
export function cleanGenFlag(flag: string | undefined | null): string | undefined {
  const p = parseFlag(flag);
  return p?.kind === "gen" ? genFlag(p.pattern, p.colors) : undefined;
}

// ---------- Deriving flags from country colours ----------

/** FNV-1a; stable across runtimes. */
export function flagHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toHsl(hex: string): [number, number, number] {
  const n = normHex(hex) ?? "#8a8a8a";
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(n.slice(i, i + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** Map colours are muted; flags want deeper, more saturated versions of the same hue. */
export function flagTone(hex: string): string {
  const [h, s, l] = toHsl(hex);
  if (s < 0.08) return fromHsl(h, 0, Math.min(0.3, l)); // greys become near-black
  return fromHsl(h, Math.max(0.55, Math.min(0.85, s * 1.6)), Math.max(0.3, Math.min(0.48, l * 0.85)));
}

const WHITE = "#f4f1e8", GOLD = "#e9b72c", BLACK = "#1c1c1e";

/**
 * Deterministic generated flag for a country: the pattern comes from a hash of `seed` (usually the
 * tag), the main colour from `color`, the second from `parentColor` when given (a breakaway keeps a
 * trace of its parent's flag), the rest from a small heraldic palette, keeping neighbours distinct.
 */
export function deriveFlag(color: string, seed: string, parentColor?: string): string {
  const h = flagHash(seed);
  const pattern = FLAG_PATTERNS[h % FLAG_PATTERNS.length]!;
  const main = flagTone(color);
  const [hue] = toHsl(main);
  const accents = [WHITE, GOLD, BLACK, fromHsl(hue + 180, 0.6, 0.4), fromHsl(hue + 120, 0.55, 0.38), WHITE];
  const pick = (avoid: string[], start: number) => {
    for (let i = 0; i < accents.length; i++) {
      const c = accents[(start + i) % accents.length]!;
      if (avoid.every((x) => colorDistance(c, x) >= 150)) return c;
    }
    return WHITE;
  };
  let second = parentColor ? flagTone(parentColor) : pick([main], (h >>> 4) % accents.length);
  if (colorDistance(second, main) < 150) second = pick([main], (h >>> 4) % accents.length);
  const colors = [main, second];
  if ((h >>> 8) % 3 !== 0 || pattern === "triband-star" || pattern === "canton") colors.push(pick([main, second], (h >>> 12) % accents.length));
  return genFlag(pattern, colors);
}
