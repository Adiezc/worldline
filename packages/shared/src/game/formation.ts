// Forming a nation. The AI decides requirements and feasibility (see the server's assessor);
// this module only enforces structure and consent, then performs the merge in one step.

import type { MapIndex } from "./mapIndex.ts";
import { removeCountry } from "./engine.ts";
import { countryByTag, countryIndex, getRelation, humanTags, relKey, type FormationGoal, type GameState } from "./state.ts";

export interface FormationCheck {
  ok: boolean;
  problems: string[];
}

export function checkFormation(state: GameState, goal: FormationGoal): FormationCheck {
  const problems: string[] = [];
  const humans = humanTags(state);
  const founder = countryByTag(state, goal.founder);
  if (!founder?.alive) problems.push("the founding country no longer exists");
  if (goal.verdict !== "achievable") problems.push("the assessment does not consider this achievable yet");
  const unmet = goal.requirements.filter((r) => !r.met);
  if (unmet.length) problems.push(`unmet requirements: ${unmet.map((r) => r.text).join("; ")}`);
  const participants = new Set([goal.founder, ...goal.countries]);
  for (const c of goal.consent) {
    if (!c.needed || c.country === goal.founder) continue;
    if (humans.has(c.country) ? c.accepted !== true : c.willing !== true) problems.push(`${c.country} has not agreed`);
  }
  for (const id of goal.provinces) {
    const owner = state.countries[state.owners[id]]?.tag;
    if (!owner || !participants.has(owner)) problems.push(`region ${id} belongs to ${owner ?? "nobody"}, who is not part of the union`);
    else if (humans.has(owner) && owner !== goal.founder && !goal.consent.find((c) => c.country === owner)?.accepted) {
      problems.push(`${owner} is player-controlled and has not accepted`);
    }
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

/** Proclaim the nation: the founder becomes the new state, participants' territory merges in. */
export function formNation(state: GameState, map: MapIndex, goal: FormationGoal) {
  const check = checkFormation(state, goal);
  if (!check.ok) return { ok: false as const, problems: check.problems, mapDiff: [] };
  const founder = countryByTag(state, goal.founder)!;
  const fIdx = countryIndex(state, goal.founder);
  const absorbed = new Set<string>();
  const diff: { province: number; owner: number; controller: number }[] = [];
  let stabilityWeight = founder.stability * founder.population, pop = founder.population;

  for (const id of goal.provinces) {
    const owner = state.countries[state.owners[id]];
    if (owner.tag !== founder.tag) absorbed.add(owner.tag);
    state.owners[id] = fIdx;
    if (state.controllers[id] === countryIndex(state, owner.tag)) state.controllers[id] = fIdx;
    diff.push({ province: id, owner: fIdx, controller: state.controllers[id] });
  }

  for (const tag of absorbed) {
    const k = countryByTag(state, tag)!;
    const idx = countryIndex(state, tag);
    const remaining = state.owners.some((o) => o === idx);
    if (remaining) {
      // Partial union: only the listed regions join; the rest of the country survives.
      continue;
    }
    founder.gdp += k.gdp;
    founder.military = Math.min(100, founder.military + k.military * 0.3);
    stabilityWeight += k.stability * k.population;
    pop += k.population;
    // Keep the founder's memberships and pick up the absorbed country's.
    for (const o of state.organizations) if (o.members.includes(tag) && !o.members.includes(founder.tag)) o.members.push(founder.tag);
    // Provinces the absorbed country occupied abroad return to their owners' control.
    for (const id of removeCountry(state, tag)) diff.push({ province: id, owner: state.owners[id], controller: state.controllers[id] });
  }

  founder.name = goal.plan?.name ?? goal.name;
  founder.color = goal.color;
  founder.government = goal.government;
  founder.population = Math.round(pop * 100) / 100;
  // Population-weighted mean. (Dividing by max(1, pop) wrongly shrank it for unions under 1M people.)
  const meanStability = pop > 0 ? stabilityWeight / pop : founder.stability;
  founder.stability = Math.min(100, Math.max(0, Math.round(meanStability - 10)));
  founder.gdp = Math.round(founder.gdp * 100) / 100;
  for (const r of goal.plan?.reactions ?? []) {
    const key = relKey(r.a, r.b);
    state.relations[key] = Math.max(-100, Math.min(100, getRelation(state, r.a, r.b) + r.delta));
  }
  goal.status = "proclaimed";
  void map;
  return { ok: true as const, problems: [], mapDiff: diff };
}
