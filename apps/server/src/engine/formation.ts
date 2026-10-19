// Forming a nation. The assessor model decides the requirements (no thresholds in code); the
// shared formation module enforces consent and performs the merge.

import {
  AssessorOutputSchema, checkFormation, countryByTag, formNation, GREAT_POWERS, getRelation, humanTags, nextId,
  type FormationGoal, type FormationRequest, type GameState,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import {
  countryDetail, nameOf, recentEventsBlock, regionName, relationsBlock, treatiesBlock,
} from "./context.ts";
import { makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { ASSESSOR_SYSTEM } from "./prompts.ts";

type AssessOpts = { founder: string; request: FormationRequest } | { formationId: string };

export async function assessFormation(state: GameState, deps: EngineDeps, opts: AssessOpts): Promise<FormationGoal> {
  let goal: FormationGoal;
  if ("formationId" in opts) {
    const found = state.formations.find((f) => f.id === opts.formationId);
    if (!found) throw new Error("No such formation goal.");
    // Rechecks are rate-limited to once per turn per goal.
    if (found.status !== "active" || found.lastChecked === state.turn) return found;
    goal = found;
  } else {
    goal = newGoal(state, opts.founder, opts.request);
  }
  await assess(state, deps, goal);
  const i = state.formations.findIndex((f) => f.id === goal.id);
  if (i >= 0) state.formations[i] = goal;
  else state.formations.push(goal);
  return goal;
}

function newGoal(state: GameState, founder: string, req: FormationRequest): FormationGoal {
  const f = countryByTag(state, founder);
  if (!f?.alive) throw new Error("The founding country does not exist.");
  const name = req.name.trim().slice(0, 80);
  if (!name) throw new Error("The new nation needs a name.");
  const humans = humanTags(state);
  const countries = [...new Set(req.countries)].filter((t) => t !== founder && countryByTag(state, t)?.alive);
  const members = new Set([founder, ...countries].map((t) => state.countries.findIndex((c) => c.tag === t)));
  const provinces = req.provinces?.length
    ? [...new Set(req.provinces)].filter((id) => id >= 1 && id < state.owners.length)
    : state.owners.map((o, id) => (id > 0 && members.has(o) ? id : 0)).filter((id) => id > 0);
  return {
    id: nextId(state, "f"),
    founder,
    name,
    concept: req.concept.trim().slice(0, 600),
    color: /^#[0-9a-fA-F]{6}$/.test(req.color) ? req.color : f.color,
    government: req.government.trim().slice(0, 80) || f.government,
    countries,
    provinces,
    verdict: "notYet",
    requirements: [],
    consent: countries.map((t) => ({ country: t, needed: true, willing: null, human: humans.has(t) })),
    suggestedPath: "",
    lastChecked: -1,
    status: "active",
  };
}

async function assess(state: GameState, deps: EngineDeps, goal: FormationGoal) {
  const humans = humanTags(state);
  const parts = [goal.founder, ...goal.countries];
  const owners = new Map<string, number>();
  for (const id of goal.provinces) {
    const t = state.countries[state.owners[id]]?.tag ?? "none";
    owners.set(t, (owners.get(t) ?? 0) + 1);
  }
  const regionList = goal.provinces.length <= 40 ? `: ${goal.provinces.map((id) => regionName(deps.map, id)).join(", ")}` : "";
  const wars = state.wars.filter((w) => [...w.attackers, ...w.defenders].some((t) => parts.includes(t)))
    .map((w) => `${w.name}: ${w.attackers.join(", ")} vs ${w.defenders.join(", ")}`);
  const scope = new Set([...parts, ...GREAT_POWERS]);
  const previous = goal.requirements.length
    ? `PREVIOUS REQUIREMENTS:\n${goal.requirements.map((r, i) => `[${i}] ${r.met ? "MET" : "unmet"}: ${r.text}`).join("\n")}`
    : "";

  const user = [
    `DATE: ${state.date}`,
    `REQUEST: ${nameOf(state, goal.founder)} (${goal.founder}) wants to form "${goal.name}" as a ${goal.government}.\n` +
      `Concept: ${goal.concept || "(none given)"}\nParticipants: ${goal.countries.join(", ") || "none (founder only)"}\n` +
      `Territory: ${goal.provinces.length} regions (${[...owners].map(([t, n]) => `${t} ${n}`).join(", ")})${regionList}`,
    `COUNTRIES:\n${parts.map((t) => countryDetail(state, countryByTag(state, t)!, humans)).join("\n")}`,
    relationsBlock(state, scope, 20, 40),
    treatiesBlock(state, new Set(parts), 15),
    wars.length ? `WARS: ${wars.join("; ")}` : "",
    recentEventsBlock(state, { involving: new Set(parts), max: 15 }),
    previous,
    "TASK: Assess this formation now. Return the JSON object.",
  ].filter(Boolean).join("\n\n");

  const out = await callJson(deps, state, {
    kind: "assessor",
    schemaName: "AssessorOutput",
    system: ASSESSOR_SYSTEM,
    user,
    maxTokens: 3000,
    temperature: 0.4,
    mockContext: {
      founder: goal.founder,
      name: goal.name,
      countries: goal.countries,
      humans: [...humans],
      founderStability: countryByTag(state, goal.founder)?.stability ?? 0,
      relations: Object.fromEntries(goal.countries.map((t) => [t, getRelation(state, goal.founder, t)])),
    },
  }, AssessorOutputSchema);

  goal.requirements = out.requirements.map((r) => ({ text: r.text.trim(), met: r.met, why: r.why.trim() }));
  // "achievable" is only consistent when nothing is left to do.
  goal.verdict = out.verdict === "achievable" && goal.requirements.some((r) => !r.met) ? "notYet" : out.verdict;
  goal.consent = goal.countries.map((t) => {
    const prev = goal.consent.find((c) => c.country === t);
    const ai = out.consent.find((c) => c.country === t);
    if (humans.has(t)) return { country: t, needed: true, willing: prev?.accepted ?? null, human: true, accepted: prev?.accepted };
    return { country: t, needed: ai?.needed ?? true, willing: ai?.willing ?? null, human: false };
  });
  goal.suggestedPath = out.suggestedPath.trim();
  goal.plan = out.plan ? { ...out.plan, name: out.plan.name.trim() || goal.name } : undefined;
  goal.lastChecked = state.turn;
}

export function consentFormation(state: GameState, opts: { formationId: string; country: string; accept: boolean }) {
  const goal = state.formations.find((f) => f.id === opts.formationId);
  if (!goal || goal.status !== "active") return { ok: false, message: "No such active formation." };
  const entry = goal.consent.find((c) => c.country === opts.country);
  if (!entry) return { ok: false, message: `${opts.country} is not part of this formation.` };
  if (!humanTags(state).has(opts.country)) return { ok: false, message: "Only player countries give consent this way." };
  entry.human = true;
  entry.accepted = opts.accept;
  entry.willing = opts.accept;
  return { ok: true, message: opts.accept ? `${opts.country} agrees to join ${goal.name}.` : `${opts.country} refuses to join ${goal.name}.` };
}

export async function proclaimFormation(state: GameState, deps: EngineDeps, opts: { formationId: string }) {
  const goal = state.formations.find((f) => f.id === opts.formationId);
  if (!goal || goal.status !== "active") return { ok: false, problems: ["No such active formation."] };
  // A fresh, final assessment: the situation may have changed since the last check.
  await assess(state, deps, goal);
  const check = checkFormation(state, goal);
  if (!check.ok) return { ok: false, problems: check.problems };

  const founderName = nameOf(state, goal.founder);
  const partners = goal.countries.map((t) => nameOf(state, t));
  const res = formNation(state, deps.map, goal);
  if (!res.ok) return { ok: false, problems: res.problems };
  const name = goal.plan?.name ?? goal.name;
  const ev = makeEvent(state, {
    date: state.date,
    headline: `Proclamation of ${name}`,
    body: partners.length
      ? `${founderName} and ${partners.join(", ")} unite as ${name}, a ${goal.government}. ${goal.plan?.orgHandling ?? ""}`.trim()
      : `${founderName} proclaims itself ${name}, a ${goal.government}.`,
    countries: [goal.founder, ...goal.countries],
    causes: [`formation:${goal.id}`],
    scope: "player",
  });
  if (res.mapDiff.length) ev.mapDiff = res.mapDiff;
  state.events.push(ev);
  return { ok: true, problems: [], event: ev };
}

export function abandonFormation(state: GameState, opts: { formationId: string }) {
  const goal = state.formations.find((f) => f.id === opts.formationId);
  if (goal && goal.status === "active") goal.status = "abandoned";
}
