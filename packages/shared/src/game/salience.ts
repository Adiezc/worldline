// Attention tiers keep LLM context small: engaged countries get full detail in the resolver,
// movers act through the Director, and the background rotates in a few at a time.

import { countryAdjacency, type MapIndex } from "./mapIndex.ts";
import { countryIndex, humanTags, warsOf, type GameState } from "./state.ts";

export const GREAT_POWERS = [
  "USA", "CHN", "RUS", "IND", "GBR", "FRA", "DEU", "JPN", "BRA", "TUR", "SAU", "IRN", "ISR", "PAK", "KOR",
  "IDN", "UKR", "EGY", "NGA", "ZAF", "AUS", "CAN", "ITA", "MEX", "PRK",
];

export interface Tiers {
  engaged: string[];
  movers: string[];
  background: string[];
}

export function computeTiers(state: GameState, map: MapIndex, opts: { maxMovers?: number; background?: number } = {}): Tiers {
  const maxMovers = opts.maxMovers ?? 20;
  const bgCount = opts.background ?? 10;
  const alive = state.countries.filter((c) => c.alive).map((c) => c.tag);
  const humans = humanTags(state);
  const adj = countryAdjacency(state.owners, map);

  const engaged = new Set<string>(humans);
  for (const h of humans) {
    const idx = countryIndex(state, h);
    for (const n of adj.get(idx) ?? []) engaged.add(state.countries[n].tag);
    for (const w of warsOf(state, h)) for (const t of [...w.attackers, ...w.defenders]) engaged.add(t);
    for (const t of state.treaties) if (t.members.includes(h)) for (const m of t.members) engaged.add(m);
  }
  for (const c of state.chats) if (c.lastTurn >= state.turn - 1 && c.members.some((m) => humans.has(m))) for (const m of c.members) engaged.add(m);

  const movers: string[] = [];
  const addMover = (t: string) => {
    if (!engaged.has(t) && !movers.includes(t) && alive.includes(t) && movers.length < maxMovers) movers.push(t);
  };
  // Countries in the latest news first, then the great powers, then anyone at war.
  const recent = state.events.filter((e) => e.turn >= state.turn - 1);
  for (const e of recent) for (const t of e.countries) addMover(t);
  for (const t of GREAT_POWERS) addMover(t);
  for (const w of state.wars) for (const t of [...w.attackers, ...w.defenders]) addMover(t);

  const rest = alive.filter((t) => !engaged.has(t) && !movers.includes(t)).sort();
  const background: string[] = [];
  for (let i = 0; i < Math.min(bgCount, rest.length); i++) background.push(rest[(state.rotation + i) % rest.length]);

  return { engaged: [...engaged].filter((t) => alive.includes(t)), movers, background };
}
