// Scenario catalogue: GET /api/scenarios (+ full seeds), cached for the session.
// Falls back to the bundled Modern Day scenario when the server is offline or too old.
import type { ScenarioInfo, ScenarioSeed, ScenarioStart } from "@worldline/shared";
import start from "@worldline/scenarios/modern-2026/start.json";
import { api, ApiError } from "./api.ts";

export const DEFAULT_SCENARIO = "modern-2026";

export const FALLBACK_SCENARIOS: ScenarioInfo[] = [
  {
    id: DEFAULT_SCENARIO,
    name: "Modern Day",
    date: "2026-01-01",
    description:
      "201 nations, live alliances, wars and institutions as they stand at the dawn of 2026. Claim a country, write your orders in plain language, and let the world respond.",
    theme: "modern",
    custom: false,
    countries: 201,
  },
];

export const STATIC_START = start as ScenarioStart;

let listCache: ScenarioInfo[] | null = null;

/** Scenario list; `offline` when it came from the bundled fallback. */
export async function listScenarios(force = false): Promise<{ list: ScenarioInfo[]; offline: boolean; error?: string }> {
  if (listCache && !force) return { list: listCache, offline: false };
  try {
    const raw = await api.scenarios();
    if (!Array.isArray(raw) || !raw.length) throw new ApiError("No scenarios", 404);
    // Built-in scenarios without a blurb get the bundled one.
    const list = raw.map((s) => (s.description ? s : { ...s, description: FALLBACK_SCENARIOS.find((f) => f.id === s.id)?.description ?? "" }));
    listCache = list;
    return { list, offline: false };
  } catch (e) {
    const error = e instanceof ApiError && e.status === 0 ? "Server offline" : e instanceof ApiError && e.status === 404 ? "Scenario list unavailable on this server" : String((e as Error).message);
    return { list: FALLBACK_SCENARIOS, offline: true, error };
  }
}

/** Forget the list (e.g. after saving a new custom scenario). */
export const invalidateScenarios = () => void (listCache = null);

const seeds = new Map<string, Promise<ScenarioSeed>>();

async function bundledSeed(): Promise<ScenarioSeed> {
  const mod = await import("@worldline/scenarios/modern-2026/seed.json");
  return { theme: "modern", ...(mod.default as unknown as ScenarioSeed) };
}

/**
 * Full seed for a scenario (cached). The bundled Modern Day seed stands in when the server
 * can't provide it; `fromBundle` tells the caller so it can say so.
 */
export function loadSeed(id: string): Promise<ScenarioSeed & { fromBundle?: boolean }> {
  let p = seeds.get(id);
  if (!p) {
    p = api.scenario(id).catch(async (e) => {
      seeds.delete(id);
      if (id === DEFAULT_SCENARIO) return { ...(await bundledSeed()), fromBundle: true };
      throw e;
    });
    seeds.set(id, p);
  }
  return p;
}

/** Ownership-only view of a seed for the map backdrop. */
export function backdropOf(seed: ScenarioSeed): ScenarioStart {
  return {
    id: seed.id,
    name: seed.name,
    date: seed.date,
    countries: seed.countries.map((c) => ({ tag: c.tag, name: c.name, color: c.color })),
    owners: seed.owners,
    controllers: seed.controllers,
  };
}
