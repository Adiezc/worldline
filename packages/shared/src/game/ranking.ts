// Paradox-style power ranking (like Victoria 3's power rankings or EU4's great powers). Derived from
// the state every time it is needed, so client and server always agree; only a short history of
// past orders is stored (GameState.rankHistory), for the change since last turn.
import type { GameState } from "./state.ts";

export type PowerTier = "great" | "major" | "regional" | "minor";

export const TIER_LABELS: Record<PowerTier, string> = {
  great: "Great Power",
  major: "Major Power",
  regional: "Regional Power",
  minor: "Minor Power",
};

/**
 * Tier cut-offs: the rank a nation must reach and the share of the leader's score it must have
 * (so a shattered world doesn't crown minnows great powers just for being in the top 8).
 */
export const TIER_RULES: { tier: PowerTier; maxRank: number; minShare: number }[] = [
  { tier: "great", maxRank: 8, minShare: 0.25 },
  { tier: "major", maxRank: 20, minShare: 0.15 },
  { tier: "regional", maxRank: 50, minShare: 0.06 },
];

/** Points each component is worth for the world leader in it (they sum to 100 before the multiplier). */
export const RANK_WEIGHTS = { economy: 40, military: 25, population: 10, territory: 5, nuclear: 8, diplomacy: 12 };

export type RankComponent = keyof typeof RANK_WEIGHTS;

export interface NationRank {
  tag: string;
  /** 1 = strongest. */
  rank: number;
  tier: PowerTier;
  /** 0–~100 (the leader in every component, fully stable, would score 100). */
  score: number;
  /** Points per component, before the stability multiplier. */
  parts: Record<RankComponent, number>;
  /** Stability and war weariness, around 1 (0.8–1.15). */
  cohesion: number;
  regions: number;
}

type RankInput = Pick<GameState, "countries" | "owners" | "treaties" | "organizations">;

/** Organisations at least this big are near-universal (the UN, the IMF): belonging says little. */
const UNIVERSAL_ORG = 80;

/** Every living nation, strongest first. Deterministic: ties break by tag. */
export function powerRanking(s: RankInput): NationRank[] {
  const living = s.countries.map((c, i) => ({ c, i })).filter(({ c }) => c.alive !== false);
  const regions = new Map<number, number>();
  for (let id = 1; id < s.owners.length; id++) regions.set(s.owners[id], (regions.get(s.owners[id]) ?? 0) + 1);

  const gdpOf = new Map(living.map(({ c }) => [c.tag, Math.max(0, c.gdp)]));
  const maxGdp = Math.max(1e-9, ...gdpOf.values());
  const worldGdp = [...gdpOf.values()].reduce((a, b) => a + b, 0) || 1;

  // Diplomatic weight: a veto, seats in exclusive clubs (worth the club's share of world GDP, spread
  // over its members, so the G7 counts and a bloc of small states barely does) and leading a bloc
  // (allies through alliances, defensive pacts or mutual-defence organisations that are weaker than you).
  const allies = new Map<string, Set<string>>();
  const ally = (a: string, b: string) => {
    if (a === b) return;
    let set = allies.get(a);
    if (!set) allies.set(a, (set = new Set()));
    set.add(b);
  };
  for (const t of s.treaties) {
    if (t.type !== "alliance" && t.type !== "defensive" && t.type !== "vassal") continue;
    for (const a of t.members) for (const b of t.members) ally(a, b);
  }
  const veto = new Set<string>(), clubs = new Map<string, number>();
  for (const o of s.organizations) {
    const members = o.members.filter((m) => !o.suspended.includes(m) && gdpOf.has(m));
    if (o.effects.mutualDefense) for (const a of members) for (const b of members) ally(a, b);
    for (const b of o.bodies) for (const t of b.veto ?? []) if (members.includes(t)) veto.add(t);
    if (!members.length || members.length >= UNIVERSAL_ORG) continue;
    const weight = members.reduce((a, m) => a + gdpOf.get(m)!, 0) / worldGdp / Math.sqrt(members.length);
    for (const m of members) clubs.set(m, (clubs.get(m) ?? 0) + weight);
  }
  const bloc = (tag: string) => {
    const own = gdpOf.get(tag) ?? 0;
    let led = 0;
    for (const a of allies.get(tag) ?? []) {
      const g = gdpOf.get(a);
      if (g !== undefined && g < own) led += Math.sqrt(g / maxGdp);
    }
    return Math.log2(1 + led);
  };
  const diplo = (tag: string) => (veto.has(tag) ? 4 : 0) + 10 * (clubs.get(tag) ?? 0) + bloc(tag);

  const raw = living.map(({ c, i }) => ({
    c,
    regions: regions.get(i) ?? 0,
    economy: gdpOf.get(c.tag)!,
    military: Math.max(0, c.military) ** 2,
    population: Math.max(0, c.population),
    diplomacy: diplo(c.tag),
  }));
  const top = (f: (r: (typeof raw)[number]) => number) => Math.max(1e-9, ...raw.map(f));
  const maxMil = top((r) => r.military), maxPop = top((r) => r.population);
  const maxReg = top((r) => r.regions), maxDip = top((r) => r.diplomacy);

  const scored = raw.map((r) => {
    const parts: Record<RankComponent, number> = {
      // Square roots keep the giants from dwarfing everyone (GDP spans four orders of magnitude).
      economy: RANK_WEIGHTS.economy * Math.sqrt(r.economy / maxGdp),
      military: RANK_WEIGHTS.military * (r.military / maxMil),
      population: RANK_WEIGHTS.population * Math.sqrt(r.population / maxPop),
      territory: RANK_WEIGHTS.territory * Math.sqrt(r.regions / maxReg),
      nuclear: r.c.nuclear ? RANK_WEIGHTS.nuclear : 0,
      diplomacy: RANK_WEIGHTS.diplomacy * (r.diplomacy / maxDip),
    };
    const cohesion = (0.85 + 0.3 * clamp01(r.c.stability / 100)) * (1 - 0.15 * clamp01(r.c.warExhaustion / 100));
    const total = Object.values(parts).reduce((a, b) => a + b, 0) * cohesion;
    return { tag: r.c.tag, score: round1(total), parts: mapValues(parts, round1), cohesion: Math.round(cohesion * 100) / 100, regions: r.regions };
  });
  scored.sort((a, b) => b.score - a.score || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));

  const lead = scored[0]?.score || 1;
  return scored.map((r, i) => ({ ...r, rank: i + 1, tier: tierFor(i + 1, r.score / lead) }));
}

export function tierFor(rank: number, share: number): PowerTier {
  for (const t of TIER_RULES) if (rank <= t.maxRank && share >= t.minShare) return t.tier;
  return "minor";
}

/** Rank by tag. */
export function rankMap(ranking: NationRank[]) {
  return new Map(ranking.map((r) => [r.tag, r]));
}

/** How many past rankings GameState.rankHistory keeps. */
export const RANK_HISTORY = 12;

/** Store the ranking as it stands for the current turn (call before the turn resolves). */
export function recordRanking(state: GameState) {
  const order = powerRanking(state).map((r) => r.tag);
  const past = (state.rankHistory ?? []).filter((h) => h.turn < state.turn);
  state.rankHistory = [...past, { turn: state.turn, order }].slice(-RANK_HISTORY);
}

/**
 * Places gained since last turn (positive = climbed), or null when there is no record of last
 * turn's ranking or the nation wasn't in it.
 */
export function rankChange(s: Pick<GameState, "turn" | "rankHistory">, tag: string, rank: number): number | null {
  const prev = s.rankHistory?.find((h) => h.turn === s.turn - 1);
  const i = prev?.order.indexOf(tag) ?? -1;
  return i < 0 ? null : i + 1 - rank;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const round1 = (x: number) => Math.round(x * 10) / 10;
const mapValues = <K extends string>(o: Record<K, number>, f: (v: number) => number) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v as number)])) as Record<K, number>;
