// Realistic fixtures for the rules-engine tests: the real province map, the modern-2026 start
// ownership, default stats and a few hand-made organisations (UN, EU, NATO).
import { readFileSync } from "node:fs";
import { buildMapIndex, type MapIndex } from "../src/game/mapIndex.ts";
import { newTurnContext, type TurnContext } from "../src/game/engine.ts";
import {
  DEFAULT_SETTINGS, countryIndex,
  type Effect, type GameEvent, type GameState, type Organization, type Player,
} from "../src/game/state.ts";
import type { MapMeta, ScenarioStart } from "../src/map/types.ts";

const root = new URL("../../", import.meta.url);
const read = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, root), "utf8")) as T;

export const META = read<MapMeta>("mapdata/public/map/provinces.json");
export const START = read<ScenarioStart>("scenarios/modern-2026/start.json");
export const MAP: MapIndex = buildMapIndex(META);

/** Province id by exact name (optionally restricted to a default owner). Throws if missing. */
export function prov(name: string, owner?: string) {
  const p = META.provinces.find((x) => x.name === name && (!owner || x.defaultOwner === owner));
  if (!p) throw new Error(`no province ${name}`);
  return p.id;
}

/** All provinces owned by `tag` in the start ownership. */
export function startProvinces(tag: string) {
  const idx = START.countries.findIndex((c) => c.tag === tag);
  return META.provinces.filter((p) => START.owners[p.id] === idx).map((p) => p.id);
}

export const P5 = ["USA", "GBR", "FRA", "RUS", "CHN"];
export const SC_ELECTED = ["BRA", "IND", "JPN", "DEU", "NGA", "ZAF", "MEX", "KOR", "EGY", "AUS"];
export const EU27 = [
  "AUT", "BEL", "BGR", "HRV", "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "DEU", "GRC", "HUN", "IRL",
  "ITA", "LVA", "LTU", "LUX", "MLT", "NLD", "POL", "PRT", "ROU", "SVK", "SVN", "ESP", "SWE",
];
export const NATO32 = [
  "USA", "CAN", "GBR", "FRA", "DEU", "ITA", "ESP", "PRT", "NLD", "BEL", "LUX", "DNK", "NOR", "ISL",
  "TUR", "GRC", "POL", "CZE", "HUN", "SVK", "SVN", "HRV", "ALB", "MNE", "MKD", "ROU", "BGR",
  "EST", "LVA", "LTU", "FIN", "SWE",
];

function orgs(allTags: string[]): Organization[] {
  const base = { observers: [], candidates: [], suspended: [], cohesion: 70 };
  return [
    {
      ...base, id: "un", abbrev: "UN", name: "United Nations", kind: "global", members: [...allTags],
      bodies: [
        { id: "ga", name: "General Assembly", seats: [], rule: "simpleMajority" },
        {
          id: "sc", name: "Security Council", seats: [...P5, ...SC_ELECTED], veto: [...P5], rule: "vetoMajority",
          handles: ["sanction", "authorizeForce", "peacekeeping"],
        },
      ],
      powers: ["sanction", "condemn", "peacekeeping", "admitMember", "suspendMember", "expelMember", "authorizeForce", "custom"],
      effects: { forum: true },
    },
    {
      ...base, id: "eu", abbrev: "EU", name: "European Union", kind: "regional", members: [...EU27],
      bodies: [{ id: "council", name: "Council of the EU", seats: [], rule: "qualifiedMajority" }],
      powers: ["sanction", "condemn", "admitMember", "suspendMember", "tradePolicy", "custom"],
      effects: { tradeBloc: true },
    },
    {
      ...base, id: "nato", abbrev: "NATO", name: "North Atlantic Treaty Organization", kind: "military", members: [...NATO32],
      bodies: [{ id: "nac", name: "North Atlantic Council", seats: [], rule: "consensus" }],
      powers: ["admitMember", "condemn", "custom"],
      effects: { mutualDefense: true },
    },
  ];
}

/** A fresh, independent GameState for each test. */
export function makeState(): GameState {
  const countries = START.countries.map((c) => ({
    tag: c.tag, name: c.name, color: c.color, government: "Republic", leader: `Leader of ${c.name}`,
    gdp: 100, population: 10, stability: 60, military: 30, warExhaustion: 0,
    agenda: { persona: "", goals: [] as string[] }, alive: true,
  }));
  const s: GameState = {
    id: "g1", scenarioId: START.id, name: "Test", date: "2026-01-01", turn: 1, phase: "orders",
    settings: structuredClone(DEFAULT_SETTINGS),
    countries,
    owners: [...START.owners],
    controllers: [...START.controllers],
    relations: {}, treaties: [], wars: [], sanctions: [],
    organizations: orgs(countries.map((c) => c.tag)),
    resolutions: [], events: [], memory: [], chats: [], formations: [], players: [],
    orders: {}, jumpVotes: {}, lastVerdicts: [],
    usage: { requests: 0, promptTokens: 0, completionTokens: 0, failures: 0 },
    rotation: 0, seq: 0,
  };
  return s;
}

/** Make `tag` player-controlled. */
export function addHuman(s: GameState, tag: string, id = `p_${tag}`): Player {
  const p: Player = { id, name: `Player ${tag}`, country: tag, isHost: s.players.length === 0, connected: true, ready: false };
  s.players.push(p);
  return p;
}

let evSeq = 0;
export function ev(effects: Effect[], opts: Partial<GameEvent> = {}): GameEvent {
  return {
    id: `e${++evSeq}`, turn: 1, date: "2026-01-15", headline: "Test event", body: "",
    countries: [], causes: [], effects, scope: "world", ...opts,
  };
}

export function ctx(days = 30, orders: { id: string; country: string }[] = []): TurnContext {
  return newTurnContext(days, orders);
}

export const idx = (s: GameState, tag: string) => countryIndex(s, tag);
export const country = (s: GameState, tag: string) => s.countries.find((c) => c.tag === tag)!;

/** Start a war directly in state (bypassing the engine). */
export function war(s: GameState, attackers: string[], defenders: string[], id = `w_${attackers[0]}_${defenders[0]}`) {
  s.wars.push({ id, name: `${attackers.join("-")} vs ${defenders.join("-")}`, attackers, defenders, goal: "test", since: s.date });
  return id;
}

/** Provinces owned by `ownerTag`, ordered by BFS distance from territory controlled by `fromTag`. */
export function frontOrder(s: GameState, ownerTag: string, fromTag: string) {
  const o = idx(s, ownerTag), f = idx(s, fromTag);
  const dist = new Map<number, number>();
  const queue: number[] = [];
  for (let id = 1; id <= MAP.count; id++) if (s.controllers[id] === f) { dist.set(id, 0); queue.push(id); }
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of MAP.neighbors[id]) if (!dist.has(n)) { dist.set(n, dist.get(id)! + 1); queue.push(n); }
  }
  return META.provinces
    .filter((p) => s.owners[p.id] === o && s.controllers[p.id] !== f)
    .map((p) => p.id)
    .sort((a, b) => (dist.get(a) ?? 1e9) - (dist.get(b) ?? 1e9));
}
