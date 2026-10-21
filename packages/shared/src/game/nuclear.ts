// Nuclear use. The AI only says that a strike happened (a nuclearStrike effect); what it costs is
// decided here, so a city destroyed is never recorded as a 0.2% dip in population, and the world's
// reaction doesn't depend on how bold the model feels. None of this is softened by difficulty.

import {
  countryByTag, countryIndex, getRelation, humanTags, nextId, relKey,
  type Country, type GameState, type NuclearScale, type NuclearStrike,
} from "./state.ts";

/** Effects of one strike. pop and gdp are percent; the rest are points (0–100 scales). */
export const STRIKE: Record<NuclearScale, {
  pop: number; gdp: number; stability: number; military: number; exhaustion: number;
  /** The striking country: domestic shock and markets. */
  selfStability: number; selfGdp: number;
  /** Every other government's view of the striker, and the target's friends on top. */
  relation: number; friendRelation: number;
  /** Lasting GDP-growth drag on the target while the fallout lasts (percentage points a year). */
  fallout: number;
}> = {
  tactical: { pop: 0.4, gdp: 1.5, stability: 8, military: 6, exhaustion: 8, selfStability: 6, selfGdp: 1.5, relation: 10, friendRelation: 10, fallout: 0.6 },
  strategic: { pop: 3, gdp: 6, stability: 18, military: 10, exhaustion: 15, selfStability: 12, selfGdp: 3, relation: 20, friendRelation: 15, fallout: 2.5 },
};

/** A strike on the capital's region costs the target this much more (population, economy, morale). */
export const CAPITAL_FACTOR = 1.8;
/** Strikes per country per turn; more is refused. */
export const MAX_STRIKES_PER_TURN = 2;
/** Fallout fades over this many days. */
export const FALLOUT_DAYS = 365;
/** Governments that think this badly of the striker afterwards join sanctions against it. */
const SANCTION_THRESHOLD = -40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Allies by treaty or mutual-defence organisation, and close friends. */
function friendsOf(state: GameState, tag: string) {
  const out = new Set<string>();
  for (const t of state.treaties) if ((t.type === "alliance" || t.type === "defensive") && t.members.includes(tag)) t.members.forEach((m) => out.add(m));
  for (const o of state.organizations) if (o.effects.mutualDefense && o.members.includes(tag)) o.members.forEach((m) => out.add(m));
  for (const c of state.countries) if (c.alive && getRelation(state, tag, c.tag) >= 40) out.add(c.tag);
  out.delete(tag);
  return out;
}

/** The region a strike lands on: the one named if the target holds it, else its capital's. */
export function strikeProvince(state: GameState, target: string, province?: number): number | null {
  const idx = countryIndex(state, target);
  if (province && state.owners[province] === idx) return province;
  const cap = countryByTag(state, target)?.capital?.province;
  if (cap && state.owners[cap] === idx) return cap;
  const any = state.owners.findIndex((o, id) => id > 0 && o === idx);
  return any > 0 ? any : null;
}

/**
 * Apply a validated strike: losses for the target, shock for the striker, the world's revulsion
 * (sharper with each strike the same country has made), new sanctions, and lasting fallout.
 * Returns one line per consequence, for the event body.
 */
export function applyNuclearStrike(state: GameState, s: Omit<NuclearStrike, "id">): string[] {
  const by = countryByTag(state, s.by)!, target = countryByTag(state, s.target)!;
  const e = STRIKE[s.scale];
  const onCapital = target.capital?.province === s.province;
  const k = onCapital ? CAPITAL_FACTOR : 1;
  const notes: string[] = [];

  const hit = (c: Country, stat: "gdp" | "population", pct: number) => { c[stat] = Math.max(0.001, r2(c[stat] * (1 - pct / 100))); };
  hit(target, "population", e.pop * k);
  hit(target, "gdp", e.gdp * k);
  target.stability = r2(clamp(target.stability - e.stability * k, 0, 100));
  target.military = r2(clamp(target.military - e.military, 0, 100));
  target.warExhaustion = r2(clamp(target.warExhaustion + e.exhaustion, 0, 100));
  notes.push(`${target.name} loses ${r2(e.pop * k)}% of its population and ${r2(e.gdp * k)}% of its economy${onCapital ? " (the capital was hit)" : ""}.`);

  hit(by, "gdp", e.selfGdp);
  by.stability = r2(clamp(by.stability - e.selfStability, 0, 100));
  by.warExhaustion = r2(clamp(by.warExhaustion + 3, 0, 100));

  // Each repeat use breaks the taboo further: the reaction grows by a quarter per earlier strike.
  const earlier = (state.nuclearStrikes ?? []).filter((x) => x.by === s.by).length;
  const escalation = Math.min(2, 1 + 0.25 * earlier);
  const friends = friendsOf(state, s.target);
  const strikerFriends = friendsOf(state, s.by);
  for (const c of state.countries) {
    if (!c.alive || c.tag === s.by) continue;
    // The striker's own friends recoil too, if half as much.
    const base = c.tag === s.target ? 0 : (strikerFriends.has(c.tag) ? e.relation / 2 : e.relation) + (friends.has(c.tag) ? e.friendRelation : 0);
    if (!base) continue;
    state.relations[relKey(s.by, c.tag)] = r2(clamp(getRelation(state, s.by, c.tag) - base * escalation, -100, 100));
  }
  state.relations[relKey(s.by, s.target)] = -100;

  // Governments now hostile enough join sanctions; players decide their own.
  const humans = humanTags(state);
  const already = new Set(state.sanctions.filter((x) => x.target === s.by).flatMap((x) => x.by));
  const joiners = state.countries
    .filter((c) => c.alive && c.tag !== s.by && !humans.has(c.tag) && !already.has(c.tag) && !strikerFriends.has(c.tag))
    .filter((c) => getRelation(state, s.by, c.tag) <= SANCTION_THRESHOLD)
    .map((c) => c.tag);
  if (joiners.length) {
    state.sanctions.push({ id: nextId(state, "s"), target: s.by, by: joiners, source: `Nuclear use against ${target.name}`, since: s.date });
    notes.push(`${joiners.length} government${joiners.length === 1 ? "" : "s"} impose new sanctions on ${by.name}.`);
  }
  notes.push(`Relations with ${by.name} collapse worldwide${earlier ? ` (repeat use: reactions ${Math.round(escalation * 100)}% as strong)` : ""}.`);

  (state.nuclearStrikes ??= []).push({ id: nextId(state, "nk"), ...s });
  return notes;
}

/** Fallout still weighing on `tag` on `date`: its GDP-growth drag in points a year (for the sim). */
export function falloutDrag(state: GameState, tag: string, date: string) {
  let drag = 0;
  for (const x of state.nuclearStrikes ?? []) {
    if (x.target !== tag) continue;
    const age = (Date.parse(date + "T00:00:00Z") - Date.parse(x.date + "T00:00:00Z")) / 86400000;
    if (age >= 0 && age < FALLOUT_DAYS) drag += STRIKE[x.scale].fallout * (1 - age / FALLOUT_DAYS);
  }
  return Math.min(8, drag);
}
