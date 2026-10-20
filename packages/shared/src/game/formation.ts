// Forming a nation, Paradox-style: each scenario defines formable nations with a fixed name, flag,
// colour and territory. A country listed as a former proclaims one by order once it controls
// every region of that territory; the merge happens in one step when the turn resolves.

import type { Formable } from "./scenario.ts";
import { pruneClaims, removeCountry } from "./engine.ts";
import { countryByTag, countryIndex, type GameState } from "./state.ts";

export interface FormableStatus {
  /** The country may proclaim it (a listed former, alive, not formed yet). */
  eligible: boolean;
  formed: boolean;
  /** Regions of the territory it does not control yet. */
  missing: number[];
  total: number;
}

/** Where `tag` stands on a formable: can it, and which regions are still missing. */
type FormableWorld = Pick<GameState, "countries" | "controllers" | "formed">;

export function formableStatus(state: FormableWorld, f: Formable, tag: string): FormableStatus {
  const formed = (state.formed ?? []).includes(f.id);
  const me = state.countries.findIndex((c) => c.tag === tag);
  const alive = me >= 0 && state.countries[me].alive !== false;
  const missing = f.provinces.filter((id) => state.controllers[id] !== me);
  return { eligible: alive && !formed && f.formers.includes(tag), formed, missing, total: f.provinces.length };
}

/** Formables a country could proclaim at some point (it is listed as a former and they still exist to form). */
export function formablesFor(state: FormableWorld, formables: Formable[], tag: string) {
  return formables.filter((f) => formableStatus(state, f, tag).eligible);
}

/**
 * Proclaim the nation: the founder takes the new name, flag and colour, every region of the
 * territory becomes its own, and countries left with no land are absorbed (economy, people,
 * memberships and claims). Returns the map changes, or the reasons it cannot happen.
 */
export function proclaimNation(state: GameState, f: Formable, founderTag: string) {
  const status = formableStatus(state, f, founderTag);
  const problems: string[] = [];
  if (status.formed) problems.push(`${f.name} already exists`);
  else if (!status.eligible) problems.push(`${founderTag} cannot form ${f.name}`);
  if (status.missing.length) problems.push(`${status.missing.length} of its ${status.total} regions are not under ${founderTag}'s control`);
  if (problems.length) return { ok: false as const, problems, mapDiff: [] };

  const founder = countryByTag(state, founderTag)!;
  const fIdx = countryIndex(state, founderTag);
  const diff: { province: number; owner: number; controller: number }[] = [];
  const touched = new Set<string>();
  for (const id of f.provinces) {
    const owner = state.countries[state.owners[id]]?.tag;
    if (owner && owner !== founderTag) touched.add(owner);
    state.owners[id] = fIdx;
    state.controllers[id] = fIdx;
    diff.push({ province: id, owner: fIdx, controller: fIdx });
  }

  let stabilityWeight = founder.stability * founder.population, pop = founder.population;
  for (const tag of touched) {
    const idx = countryIndex(state, tag);
    // Countries with land outside the territory survive with what remains.
    if (state.owners.some((o) => o === idx)) continue;
    const k = countryByTag(state, tag)!;
    founder.gdp += k.gdp;
    founder.military = Math.min(100, founder.military + k.military * 0.3);
    stabilityWeight += k.stability * k.population;
    pop += k.population;
    for (const o of state.organizations) if (o.members.includes(tag) && !o.members.includes(founderTag)) o.members.push(founderTag);
    for (const c of state.claims ?? []) if (c.claimant === tag) c.claimant = founderTag;
    for (const id of removeCountry(state, tag)) diff.push({ province: id, owner: state.owners[id], controller: state.controllers[id] });
  }
  pruneClaims(state);

  founder.name = f.name;
  founder.color = f.color;
  founder.flag = f.flag;
  if (f.government) founder.government = f.government;
  founder.population = Math.round(pop * 100) / 100;
  // A new state starts a little shaky: the population-weighted mean, minus a transition cost.
  founder.stability = Math.min(100, Math.max(0, Math.round((pop > 0 ? stabilityWeight / pop : founder.stability) - 5)));
  founder.gdp = Math.round(founder.gdp * 100) / 100;
  state.formed = [...(state.formed ?? []), f.id];
  return { ok: true as const, problems: [], mapDiff: diff };
}
