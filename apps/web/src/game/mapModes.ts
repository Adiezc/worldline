// Map modes recolour countries by index; the renderer only ever sees a palette.
import { TIER_LABELS, type Country, type GameView } from "@worldline/shared";
import { rankingOf, TIER_COLORS } from "./ranking.ts";
import { relationBetween } from "./selectors.ts";

export type MapMode = "political" | "relations" | "orgs" | "wars" | "disputes" | "gdp" | "stability" | "rank";

/**
 * Disputes on the map (dashed claim lines, the Disputes map mode, tooltip and country panel lines)
 * are switched off for now; flip this to show them. Claims stay in the game state and the AI still sees them.
 */
export const SHOW_DISPUTES = false;

const ALL_MODES: { id: MapMode; label: string }[] = [
  { id: "political", label: "Political" },
  { id: "relations", label: "Relations" },
  { id: "orgs", label: "Organisations" },
  { id: "wars", label: "Wars" },
  { id: "disputes", label: "Disputes" },
  { id: "gdp", label: "GDP" },
  { id: "stability", label: "Stability" },
  { id: "rank", label: "Power rank" },
];
export const MAP_MODES = ALL_MODES.filter((m) => SHOW_DISPUTES || m.id !== "disputes");

export const MODE_COLORS = {
  neutral: "#8f8a7e",
  focus: "#c9a45c",
  good: "#3f9a52",
  bad: "#b23a32",
  ally: "#4a73b5",
  member: "#4f9a52",
  candidate: "#d6b440",
  observer: "#a9d08f",
  suspended: "#d9822b",
};

type RGB = [number, number, number];
const toRgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB) => "#" + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");

export function mix(a: string, b: string, t: number) {
  const x = toRgb(a), y = toRgb(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Piecewise-linear ramp over evenly spaced stops, t in [0, 1]. */
export function ramp(stops: string[], t: number) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

export const GDP_RAMP = ["#efe3c2", "#a9c48a", "#4f8f7a", "#24506e"];
export const STABILITY_RAMP = ["#b23a32", "#d9a441", "#4f9a52"];

/** Relation −100…100 → red ↔ grey ↔ green. */
export const relationColor = (r: number) =>
  r >= 0 ? mix(MODE_COLORS.neutral, MODE_COLORS.good, Math.min(1, r / 80)) : mix(MODE_COLORS.neutral, MODE_COLORS.bad, Math.min(1, -r / 80));

export interface ModeContext {
  /** Country the mode is relative to (selected, else your own). */
  focus: string | null;
  orgId: string | null;
}

export function computePalette(
  mode: MapMode,
  view: Pick<GameView, "countries" | "relations" | "wars" | "organizations"> & Partial<Pick<GameView, "claims" | "owners" | "treaties">>,
  ctx: ModeContext,
): string[] {
  const countries = view.countries as Country[];
  const each = (fn: (c: Country) => string) => countries.map((c) => (c.alive === false ? MODE_COLORS.neutral : fn(c)));

  switch (mode) {
    case "political":
      return countries.map((c) => c.color);

    case "relations": {
      const f = ctx.focus;
      if (!f) return each(() => MODE_COLORS.neutral);
      return each((c) => (c.tag === f ? MODE_COLORS.focus : relationColor(relationBetween(view.relations, f, c.tag))));
    }

    case "orgs": {
      const org = view.organizations.find((o) => o.id === ctx.orgId);
      if (!org) return each(() => MODE_COLORS.neutral);
      const cand = new Set(org.candidates.map((c) => c.tag));
      return each((c) => {
        if (org.suspended.includes(c.tag)) return MODE_COLORS.suspended;
        if (org.members.includes(c.tag)) return MODE_COLORS.member;
        if (cand.has(c.tag)) return MODE_COLORS.candidate;
        if (org.observers.includes(c.tag)) return MODE_COLORS.observer;
        return MODE_COLORS.neutral;
      });
    }

    case "wars": {
      const f = ctx.focus;
      const enemies = new Set<string>(), friends = new Set<string>();
      for (const w of view.wars) {
        const side = w.attackers.includes(f ?? "") ? w.attackers : w.defenders.includes(f ?? "") ? w.defenders : null;
        if (!side) continue;
        const other = side === w.attackers ? w.defenders : w.attackers;
        side.forEach((t) => friends.add(t));
        other.forEach((t) => enemies.add(t));
      }
      return each((c) =>
        c.tag === f ? (friends.size ? "#2f5a96" : MODE_COLORS.focus) : enemies.has(c.tag) ? MODE_COLORS.bad : friends.has(c.tag) ? MODE_COLORS.ally : MODE_COLORS.neutral,
      );
    }

    case "disputes": {
      // Parties to a dispute keep their colours (claimed land gets the claimant's stripes);
      // everyone else fades back.
      const involved = new Set<string>();
      for (const c of view.claims ?? []) {
        involved.add(c.claimant);
        for (const id of c.provinces) {
          const holder = view.owners ? countries[view.owners[id]]?.tag : undefined;
          if (holder) involved.add(holder);
        }
      }
      return each((c) => (involved.has(c.tag) ? mix(c.color, MODE_COLORS.neutral, 0.12) : mix(c.color, MODE_COLORS.neutral, 0.78)));
    }

    case "gdp": {
      const vals = countries.filter((c) => c.alive !== false && c.gdp > 0).map((c) => Math.log(c.gdp));
      const lo = Math.min(...vals), hi = Math.max(...vals);
      return each((c) => (c.gdp > 0 ? ramp(GDP_RAMP, (Math.log(c.gdp) - lo) / Math.max(1e-6, hi - lo)) : MODE_COLORS.neutral));
    }

    case "stability":
      return each((c) => ramp(STABILITY_RAMP, c.stability / 100));

    case "rank": {
      if (!view.owners) return each(() => MODE_COLORS.neutral);
      const { byTag } = rankingOf({ countries, owners: view.owners, treaties: view.treaties ?? [], organizations: view.organizations });
      return each((c) => {
        const r = byTag.get(c.tag);
        return r ? TIER_COLORS[r.tier] : MODE_COLORS.neutral;
      });
    }
  }
}

/** Legend entries for the current mode. */
export function legendFor(mode: MapMode): { color: string; label: string }[] | { ramp: string[]; lo: string; hi: string } | null {
  switch (mode) {
    case "relations":
      return { ramp: [MODE_COLORS.bad, MODE_COLORS.neutral, MODE_COLORS.good], lo: "Hostile", hi: "Friendly" };
    case "orgs":
      return [
        { color: MODE_COLORS.member, label: "Member" },
        { color: MODE_COLORS.candidate, label: "Candidate" },
        { color: MODE_COLORS.observer, label: "Observer" },
        { color: MODE_COLORS.suspended, label: "Suspended" },
      ];
    case "wars":
      return [
        { color: MODE_COLORS.bad, label: "Enemy" },
        { color: MODE_COLORS.ally, label: "Co-belligerent" },
      ];
    case "disputes":
      return [
        { color: "#8a7450", label: "Stripes: claimed by that colour's country" },
        { color: "#33302b", label: "Dashed: disputed line" },
      ];
    case "gdp":
      return { ramp: GDP_RAMP, lo: "Small", hi: "Large (log)" };
    case "stability":
      return { ramp: STABILITY_RAMP, lo: "Unstable", hi: "Stable" };
    case "rank":
      return (Object.keys(TIER_COLORS) as (keyof typeof TIER_COLORS)[]).map((t) => ({ color: TIER_COLORS[t], label: TIER_LABELS[t].replace(" Power", "") }));
    default:
      return null;
  }
}
