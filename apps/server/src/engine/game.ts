// Game creation and small helpers for building events.

import {
  addDays, daysBetween, DEFAULT_SETTINGS, humanTags, nextId,
  type Effect, type GameEvent, type GameState, type ScenarioSeed,
} from "@worldline/shared";

export function createGame(opts: { id: string; name: string; seed: ScenarioSeed }): GameState {
  const seed = structuredClone(opts.seed);
  return {
    id: opts.id,
    scenarioId: seed.id,
    name: opts.name,
    date: seed.date,
    turn: 1,
    phase: "lobby",
    settings: structuredClone(DEFAULT_SETTINGS),
    countries: seed.countries.map((c) => ({ ...c, alive: c.alive ?? true, agenda: c.agenda ?? { persona: "", goals: [] } })),
    owners: seed.owners,
    controllers: seed.controllers,
    relations: seed.relations ?? {},
    treaties: seed.treaties ?? [],
    wars: seed.wars ?? [],
    sanctions: seed.sanctions ?? [],
    organizations: seed.organizations ?? [],
    resolutions: [],
    events: [],
    memory: [],
    chats: [],
    formations: [],
    players: [],
    orders: {},
    jumpVotes: {},
    lastVerdicts: [],
    usage: { requests: 0, promptTokens: 0, completionTokens: 0, failures: 0 },
    rotation: 0,
    seq: 0,
  };
}

/** Clamp an ISO date into [from, to]; malformed dates fall back to `from`. */
export function clampDate(date: string, from: string, to: string) {
  const t = Date.parse(date + "T00:00:00Z");
  if (Number.isNaN(t)) return from;
  const iso = new Date(t).toISOString().slice(0, 10);
  return iso < from ? from : iso > to ? to : iso;
}

/** Spread n dates evenly across the window, e.g. for planner intents. */
export function spreadDate(from: string, to: string, i: number, n: number) {
  const span = Math.max(0, daysBetween(from, to));
  return addDays(from, Math.min(span, Math.round(((i + 1) * span) / (n + 1))));
}

/** "player" when an order caused it or a player country is involved. */
export function scopeOf(state: GameState, causes: string[], countries: string[]): GameEvent["scope"] {
  const humans = humanTags(state);
  return causes.length || countries.some((t) => humans.has(t)) ? "player" : "world";
}

export function makeEvent(
  state: GameState,
  e: { date: string; headline: string; body?: string; countries?: string[]; causes?: string[]; effects?: Effect[]; scope?: GameEvent["scope"] },
): GameEvent {
  const countries = [...new Set(e.countries ?? [])];
  const causes = e.causes ?? [];
  return {
    id: nextId(state, "e"),
    turn: state.turn,
    date: e.date,
    headline: e.headline,
    body: e.body ?? "",
    countries,
    causes,
    effects: e.effects ?? [],
    scope: e.scope ?? scopeOf(state, causes, countries),
  };
}
