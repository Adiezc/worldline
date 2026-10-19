// Front lines and derived troop counters. Military is abstract in Worldline, so everything here
// is a display estimate computed from the map and country stats; nothing feeds back into the
// simulation. Pure functions, cheap enough (~2,300 provinces) to recompute on every map change.
import type { MapIndex } from "./mapIndex.ts";

export interface FrontCountry {
  tag: string;
  name?: string;
  military: number;
  population: number;
  gdp: number;
  warExhaustion: number;
  alive?: boolean;
}

export interface FrontWar {
  id: string;
  attackers: string[];
  defenders: string[];
}

export interface FrontsInput {
  /** Province id → country index (-1 = none). */
  owners: ArrayLike<number>;
  controllers: ArrayLike<number>;
  countries: FrontCountry[];
  wars: FrontWar[];
  map: MapIndex;
}

/** One contiguous line of contact between the two sides of a war. */
export interface Front {
  /** `${warId}:${lowest province id}`; stable while the line keeps its western/northern end. */
  id: string;
  warId: string;
  /** Main controller on the attackers' side (A) and the defenders' side (B). */
  sideA: string;
  sideB: string;
  /** Adjacent province pairs across the line: [side A province, side B province]. */
  pairs: [number, number][];
  /** Estimated length in km. */
  length: number;
  /** Counter positions in map px, just inside each side's territory. */
  anchorA: [number, number];
  anchorB: [number, number];
  /** Frontline km held by each controller on either side (co-belligerents included). */
  holdersA: Record<string, number>;
  holdersB: Record<string, number>;
}

/** Province pair length in km: a shared border is roughly the smaller province's width. */
const pairLength = (map: MapIndex, a: number, b: number) =>
  0.75 * Math.sqrt(Math.max(1, Math.min(map.area[a] || 1, map.area[b] || 1)));

/** Side of each country index per war: 0 attackers, 1 defenders, -1 not involved. */
function warSides(input: FrontsInput) {
  const index = new Map(input.countries.map((c, i) => [c.tag, i]));
  return input.wars.map((w) => {
    const side = new Int8Array(input.countries.length).fill(-1);
    for (const t of w.attackers) if (index.has(t)) side[index.get(t)!] = 0;
    for (const t of w.defenders) if (index.has(t)) side[index.get(t)!] = 1;
    return side;
  });
}

export function computeFronts(input: FrontsInput): Front[] {
  const { controllers, countries, wars, map } = input;
  const n = countries.length;
  if (!wars.length || !n) return [];
  const sides = warSides(input);
  // First war in which two controllers are enemies (n×n, -1 = none).
  const enemyWar = new Int16Array(n * n).fill(-1);
  sides.forEach((side, w) => {
    for (let a = 0; a < n; a++) {
      if (side[a] < 0) continue;
      for (let b = 0; b < n; b++) if (side[b] >= 0 && side[b] !== side[a] && enemyWar[a * n + b] < 0) enemyWar[a * n + b] = w;
    }
  });

  // Contact pairs, oriented attackers' side first, bucketed by war.
  const pairsByWar: [number, number][][] = wars.map(() => []);
  for (let id = 1; id <= map.count; id++) {
    const ca = controllers[id];
    if (ca < 0 || ca >= n) continue;
    for (const nb of map.neighbors[id] ?? []) {
      if (nb <= id) continue;
      const cb = controllers[nb];
      if (cb < 0 || cb >= n || cb === ca) continue;
      const w = enemyWar[ca * n + cb];
      if (w < 0) continue;
      pairsByWar[w].push(sides[w][ca] === 0 ? [id, nb] : [nb, id]);
    }
  }

  const fronts: Front[] = [];
  pairsByWar.forEach((pairs, w) => {
    if (!pairs.length) return;
    const side = sides[w];
    // Union-find over frontline provinces: a pair joins its two provinces, and frontline
    // provinces of the same side that touch join too, so a continuous line is one front.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r)! !== r) r = parent.get(r)!;
      while (parent.get(x)! !== r) {
        const next = parent.get(x)!;
        parent.set(x, r);
        x = next;
      }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(Math.max(ra, rb), Math.min(ra, rb));
    };
    for (const [a, b] of pairs) {
      if (!parent.has(a)) parent.set(a, a);
      if (!parent.has(b)) parent.set(b, b);
      union(a, b);
    }
    for (const id of parent.keys()) {
      for (const nb of map.neighbors[id] ?? []) {
        if (parent.has(nb) && side[controllers[nb]] === side[controllers[id]]) union(id, nb);
      }
    }
    const groups = new Map<number, [number, number][]>();
    for (const p of pairs) {
      const r = find(p[0]);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r)!.push(p);
    }
    for (const [root, group] of groups) fronts.push(buildFront(input, wars[w].id, root, group));
  });
  return fronts;
}

function buildFront(input: FrontsInput, warId: string, root: number, pairs: [number, number][]): Front {
  const { controllers, countries, map } = input;
  const W = map.width;
  const holdersA: Record<string, number> = {}, holdersB: Record<string, number> = {};
  const provA = new Set<number>(), provB = new Set<number>();
  let length = 0, gap = 0;
  // Unwrap x around the first province so fronts across the date line average correctly.
  const ref = map.cx[pairs[0][0]];
  const ux = (x: number) => ref + ((((x - ref + W / 2) % W) + W) % W) - W / 2;
  for (const [a, b] of pairs) {
    const len = pairLength(map, a, b);
    length += len;
    const ta = countries[controllers[a]].tag, tb = countries[controllers[b]].tag;
    holdersA[ta] = (holdersA[ta] ?? 0) + len;
    holdersB[tb] = (holdersB[tb] ?? 0) + len;
    provA.add(a);
    provB.add(b);
    gap += Math.hypot(ux(map.cx[a]) - ux(map.cx[b]), map.cy[a] - map.cy[b]);
  }
  const centroid = (set: Set<number>): [number, number] => {
    let x = 0, y = 0;
    for (const id of set) {
      x += ux(map.cx[id]);
      y += map.cy[id];
    }
    return [x / set.size, y / set.size];
  };
  const ca = centroid(provA), cb = centroid(provB);
  // Nudge each anchor a quarter of a province step away from the other side.
  let dx = ca[0] - cb[0], dy = ca[1] - cb[1];
  const d = Math.hypot(dx, dy);
  if (d < 1e-3) [dx, dy] = [-1, 0];
  else [dx, dy] = [dx / d, dy / d];
  const nudge = Math.min(40, Math.max(4, (gap / pairs.length) * 0.25));
  const wrap = (x: number) => ((x % W) + W) % W;
  const main = (h: Record<string, number>) => Object.entries(h).sort((x, y) => y[1] - x[1])[0][0];
  return {
    id: `${warId}:${root}`,
    warId,
    sideA: main(holdersA),
    sideB: main(holdersB),
    pairs,
    length: Math.round(length),
    anchorA: [wrap(ca[0] + dx * nudge), ca[1] + dy * nudge],
    anchorB: [wrap(cb[0] - dx * nudge), cb[1] - dy * nudge],
    holdersA,
    holdersB,
  };
}

// --- Forces ----------------------------------------------------------------------------------
//
// Deployable strength in divisions (~10–15k troops each), an estimate for display only:
//
//   base  = 90 · 14^(military/100 − 1) · manpower · economy
//     manpower = pop/(pop + 5) · clamp(1 + 0.12·log10(pop/30), 0.85, 1.3)   (pop in millions;
//                the first term crushes micro-states, the second rewards very large populations)
//     economy  = clamp((GDP per capita / $15k)^0.15, 0.75, 1.3)
//   total = base · mobilisation · (1 − 0.4 · warExhaustion/100), at least 1 for a living country
//     mobilisation = 1 at peace, 1.25 at war without a land front, 1.9 with one,
//                    2.4 when existentially threatened (own land occupied by an enemy, or the
//                    enemies on its fronts are ≥ 1.5× its own peacetime strength)
//
// Modern start: USA ≈ 130, Russia ≈ 121 (at war, exhaustion 35), Ukraine ≈ 77 (existential,
// exhaustion 55), China ≈ 91, Germany ≈ 54, Venezuela ≈ 12, Luxembourg ≈ 2, Vatican 1.
//
// Allocation: a country keeps a reserve at home (30%, or 10% when existentially threatened) and
// spreads the rest over its own fronts in proportion to the frontline length it holds. A country
// at war with no front of its own sends an expeditionary 25% to its side's fronts in those wars.

export const FORCE_RESERVE = 0.3;
export const FORCE_RESERVE_EXISTENTIAL = 0.1;
export const FORCE_EXPEDITION = 0.25;

export interface CountryForces {
  tag: string;
  /** Total estimated divisions. */
  total: number;
  /** Divisions held back home (total − Σ fronts). */
  reserve: number;
  atWar: boolean;
  existential: boolean;
  /** Divisions on each front (own or expeditionary). */
  fronts: { frontId: string; divisions: number }[];
}

export interface FrontSideForces {
  /** Lead country (the front's main controller on this side). */
  tag: string;
  divisions: number;
  /** Contributors, largest first. */
  by: { tag: string; divisions: number }[];
}

export interface FrontForces {
  frontId: string;
  a: FrontSideForces;
  b: FrontSideForces;
}

export interface ForceEstimate {
  countries: Record<string, CountryForces>;
  fronts: Record<string, FrontForces>;
}

/** Peacetime strength in divisions (unrounded); see the formula above. */
export function baseStrength(c: FrontCountry) {
  if (c.alive === false) return 0;
  const m = Math.max(0, Math.min(100, c.military || 0)) / 100;
  const pop = Math.max(0, c.population || 0);
  const gdppc = pop > 0 ? Math.max(0, c.gdp || 0) / pop : 0;
  const economy = Math.max(0.75, Math.min(1.3, (gdppc / 15) ** 0.15));
  const manpower = (pop / (pop + 5)) * Math.max(0.85, Math.min(1.3, 1 + 0.12 * Math.log10(Math.max(pop, 1) / 30)));
  return 90 * 14 ** (m - 1) * manpower * economy;
}

/** Integer split of `total` proportional to `weights` (largest remainder). */
function apportion(total: number, weights: number[]) {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (w / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k][1]]++;
  return out;
}

export function estimateForces(input: FrontsInput, fronts: Front[] = computeFronts(input)): ForceEstimate {
  const { countries, wars, owners, controllers, map } = input;
  const index = new Map(countries.map((c, i) => [c.tag, i]));
  const base = countries.map(baseStrength);
  const enemies = new Map<string, Set<string>>();
  const allies = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, vs: string[]) => {
    if (!m.has(k)) m.set(k, new Set());
    for (const v of vs) if (v !== k) m.get(k)!.add(v);
  };
  for (const w of wars) {
    for (const t of w.attackers) add(enemies, t, w.defenders), add(allies, t, w.attackers);
    for (const t of w.defenders) add(enemies, t, w.attackers), add(allies, t, w.defenders);
  }

  // Frontline km per country per front.
  const own = new Map<string, { frontId: string; km: number }[]>();
  for (const f of fronts) {
    for (const h of [f.holdersA, f.holdersB]) {
      for (const [tag, km] of Object.entries(h)) {
        if (!own.has(tag)) own.set(tag, []);
        own.get(tag)!.push({ frontId: f.id, km });
      }
    }
  }

  // Existential threat: own land occupied by an enemy, or outmatched by the enemies it faces.
  const occupied = new Set<string>();
  for (let id = 1; id <= map.count; id++) {
    const o = owners[id], c = controllers[id];
    if (o < 0 || c < 0 || o === c || !countries[o] || !countries[c]) continue;
    if (enemies.get(countries[o].tag)?.has(countries[c].tag)) occupied.add(countries[o].tag);
  }
  const facing = new Map<string, Set<string>>();
  for (const f of fronts) {
    for (const [mine, theirs] of [[f.holdersA, f.holdersB], [f.holdersB, f.holdersA]]) {
      for (const t of Object.keys(mine)) {
        if (!facing.has(t)) facing.set(t, new Set());
        for (const e of Object.keys(theirs)) facing.get(t)!.add(e);
      }
    }
  }

  const result: ForceEstimate = { countries: {}, fronts: {} };
  countries.forEach((c, i) => {
    if (c.alive === false) return;
    const atWar = (enemies.get(c.tag)?.size ?? 0) > 0;
    const hasFront = own.has(c.tag);
    const outmatched = [...(facing.get(c.tag) ?? [])].reduce((s, t) => s + (base[index.get(t)!] ?? 0), 0) >= 1.5 * base[i];
    const existential = atWar && (occupied.has(c.tag) || (hasFront && outmatched));
    const mobilisation = !atWar ? 1 : existential ? 2.4 : hasFront ? 1.9 : 1.25;
    const ex = 1 - (0.4 * Math.max(0, Math.min(100, c.warExhaustion || 0))) / 100;
    const total = Math.max(1, Math.round(base[i] * mobilisation * ex));
    result.countries[c.tag] = { tag: c.tag, total, reserve: total, atWar, existential, fronts: [] };
  });

  // Own fronts first.
  for (const [tag, list] of own) {
    const cf = result.countries[tag];
    if (!cf) continue;
    const deploy = Math.round(cf.total * (1 - (cf.existential ? FORCE_RESERVE_EXISTENTIAL : FORCE_RESERVE)));
    const split = apportion(deploy, list.map((x) => x.km));
    list.forEach((x, k) => split[k] > 0 && cf.fronts.push({ frontId: x.frontId, divisions: split[k] }));
  }
  // Expeditions: at war, no front of its own → help its side on that war's fronts.
  for (const cf of Object.values(result.countries)) {
    if (!cf.atWar || own.has(cf.tag)) continue;
    const targets: { frontId: string; km: number }[] = [];
    for (const f of fronts) {
      const w = wars.find((x) => x.id === f.warId);
      if (w && (w.attackers.includes(cf.tag) || w.defenders.includes(cf.tag))) targets.push({ frontId: f.id, km: f.length });
    }
    if (!targets.length) continue;
    const split = apportion(Math.round(cf.total * FORCE_EXPEDITION), targets.map((x) => x.km));
    targets.forEach((x, k) => split[k] > 0 && cf.fronts.push({ frontId: x.frontId, divisions: split[k] }));
  }

  // Per-front side totals.
  const side = (lead: string): FrontSideForces => ({ tag: lead, divisions: 0, by: [] });
  for (const f of fronts) result.fronts[f.id] = { frontId: f.id, a: side(f.sideA), b: side(f.sideB) };
  const warOf = new Map(fronts.map((f) => [f.id, wars.find((w) => w.id === f.warId)]));
  for (const cf of Object.values(result.countries)) {
    cf.reserve = cf.total - cf.fronts.reduce((s, x) => s + x.divisions, 0);
    for (const x of cf.fronts) {
      const ff = result.fronts[x.frontId], w = warOf.get(x.frontId);
      if (!ff || !w) continue;
      const s = w.attackers.includes(cf.tag) ? ff.a : ff.b;
      s.divisions += x.divisions;
      s.by.push({ tag: cf.tag, divisions: x.divisions });
    }
  }
  for (const ff of Object.values(result.fronts)) for (const s of [ff.a, ff.b]) s.by.sort((p, q) => q.divisions - p.divisions);
  return result;
}

// --- Naming ----------------------------------------------------------------------------------

const DEMONYMS: Record<string, string> = {
  UKR: "Ukrainian", RUS: "Russian", USA: "American", CHN: "Chinese", IND: "Indian", PAK: "Pakistani",
  GBR: "British", FRA: "French", DEU: "German", ITA: "Italian", ESP: "Spanish", POL: "Polish",
  TUR: "Turkish", IRN: "Iranian", IRQ: "Iraqi", SYR: "Syrian", ISR: "Israeli", PSE: "Palestinian",
  LBN: "Lebanese", JOR: "Jordanian", SAU: "Saudi", YEM: "Yemeni", EGY: "Egyptian", LBY: "Libyan",
  SDN: "Sudanese", SSD: "South Sudanese", ETH: "Ethiopian", ERI: "Eritrean", SOM: "Somali", KEN: "Kenyan",
  COD: "Congolese", COG: "Congolese", NGA: "Nigerian", MLI: "Malian", NER: "Nigerien", TCD: "Chadian",
  DZA: "Algerian", MAR: "Moroccan", TUN: "Tunisian", ZAF: "South African", AFG: "Afghan", BLR: "Belarusian",
  MDA: "Moldovan", ROU: "Romanian", HUN: "Hungarian", SRB: "Serbian", HRV: "Croatian", BIH: "Bosnian",
  GRC: "Greek", BGR: "Bulgarian", GEO: "Georgian", ARM: "Armenian", AZE: "Azerbaijani", KAZ: "Kazakh",
  PRK: "North Korean", KOR: "South Korean", JPN: "Japanese", TWN: "Taiwanese", VNM: "Vietnamese",
  THA: "Thai", MMR: "Burmese", BGD: "Bangladeshi", NPL: "Nepalese", MNG: "Mongolian", FIN: "Finnish",
  SWE: "Swedish", NOR: "Norwegian", EST: "Estonian", LVA: "Latvian", LTU: "Lithuanian", VEN: "Venezuelan",
  COL: "Colombian", BRA: "Brazilian", ARG: "Argentine", CHL: "Chilean", PER: "Peruvian", BOL: "Bolivian",
  GUY: "Guyanese", MEX: "Mexican", CAN: "Canadian", CUB: "Cuban", AUT: "Austrian", CZE: "Czech",
  SVK: "Slovak", NLD: "Dutch", BEL: "Belgian", CHE: "Swiss", PRT: "Portuguese", IRL: "Irish",
};

/** "the Ukrainian front" from the enemy's point of view; falls back to "the Ukraine front". */
export function frontName(enemyTag: string, enemyName?: string) {
  return `the ${DEMONYMS[enemyTag] ?? enemyName ?? enemyTag} front`;
}
