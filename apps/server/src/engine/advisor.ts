// Player-side helpers: the strategic adviser, order polishing and order brainstorming.

import {
  addDays, BrainstormOutputSchema, countryAdjacency, countryByTag, countryIndex, formablesFor, formableStatus, getRelation, humanTags,
  PolishOutputSchema,
  type GameState,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import {
  calendarBlock, countryBrief, countryDetail, fmtGdp, memoryBlock, nameOf, recentEventsBlock, treatiesBlock,
} from "./context.ts";
import { callJson, callText } from "./llm.ts";
import { advisorSystem, BRAINSTORM_SYSTEM, POLISH_SYSTEM } from "./prompts.ts";

/** Everything a player's adviser should know about one country, compactly. */
export function countryContext(state: GameState, deps: EngineDeps, tag: string) {
  const k = countryByTag(state, tag);
  if (!k?.alive) throw new Error(`Unknown country ${tag}.`);
  const humans = humanTags(state);
  const idx = countryIndex(state, tag);
  const neighbours = [...(countryAdjacency(state.owners, deps.map).get(idx) ?? [])].map((i) => state.countries[i]).filter((c) => c?.alive);
  const rels = Object.entries(state.relations)
    .filter(([key, v]) => key.split("|").includes(tag) && Math.abs(v) >= 20)
    .map(([key, v]) => [key.split("|").find((t) => t !== tag)!, v] as const)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 16);
  const wars = state.wars.filter((w) => w.attackers.includes(tag) || w.defenders.includes(tag))
    .map((w) => `${w.name} (${w.attackers.join(", ")} vs ${w.defenders.join(", ")}; goal: ${w.goal})`);
  const sanctions = state.sanctions.filter((s) => s.target === tag || s.by.includes(tag))
    .map((s) => (s.target === tag ? `sanctioned by ${s.by.length} countries (${s.source})` : `sanctioning ${s.target}`));
  const orgs = state.organizations.filter((o) => o.members.includes(tag));
  const pending = state.resolutions.filter((r) => r.status === "pending" && orgs.some((o) => o.id === r.orgId))
    .map((r) => `${r.id} ${r.type}${r.target ? ` on ${r.target}` : ""} by ${r.proposer}: "${r.text}"`);
  // Nations this country could proclaim, and how much of their territory it still lacks.
  const formations = formablesFor(state, deps.seed.formables, tag).map((f) => {
    const st = formableStatus(state, f, tag);
    return `"${f.name}" (controls ${st.total - st.missing.length} of ${st.total} regions; proclaimed by order once it controls all of them)`;
  });
  const goals = k.agenda.goals.length ? `\nHistorical agenda of ${k.name}: ${k.agenda.goals.join("; ")}` : "";

  return [
    `DATE: ${state.date}`,
    memoryBlock(state, deps.seed),
    `YOUR COUNTRY: ${countryDetail(state, k, humans)}${goals}`,
    neighbours.length ? `NEIGHBOURS: ${neighbours.map((c) => `${countryBrief(c)} rel ${getRelation(state, tag, c.tag)}`).join("; ")}` : "",
    rels.length ? `KEY RELATIONS: ${rels.map(([t, v]) => `${t} ${nameOf(state, t)} ${v > 0 ? "+" : ""}${v}`).join(", ")}` : "",
    treatiesBlock(state, new Set([tag]), 15),
    wars.length ? `WARS: ${wars.join("; ")}` : "WARS: none",
    sanctions.length ? `SANCTIONS: ${sanctions.join("; ")}` : "",
    orgs.length ? `MEMBERSHIPS: ${orgs.map((o) => `${o.id} ${o.abbrev}`).join(", ")}` : "",
    pending.length ? `PENDING VOTES: ${pending.join("; ")}` : "",
    formations.length ? `FORMABLE NATIONS: ${formations.join("; ")}` : "",
    `ECONOMY RANK: #${rank(state, tag)} by GDP (${fmtGdp(k.gdp)})`,
    recentEventsBlock(state, { max: 25 }),
    calendarBlock(deps.seed, state.date, addDays(state.date, 120)),
  ].filter(Boolean).join("\n\n");
}

const rank = (state: GameState, tag: string) =>
  state.countries.filter((c) => c.alive).sort((a, b) => b.gdp - a.gdp).findIndex((c) => c.tag === tag) + 1;

export async function advisor(state: GameState, deps: EngineDeps, opts: { country: string; question?: string }) {
  const k = countryByTag(state, opts.country);
  const question = opts.question?.trim();
  return callText(deps, state, {
    kind: "advisor",
    system: advisorSystem(k?.name ?? opts.country),
    user: `${countryContext(state, deps, opts.country)}\n\n${question ? `THE LEADER ASKS: ${question}` : "TASK: Give your situation briefing and recommendations."}`,
    maxTokens: 1500,
    temperature: 0.7,
    mockContext: {
      country: opts.country, name: k?.name, stability: k?.stability, gdp: k?.gdp, question,
      wars: state.wars.filter((w) => [...w.attackers, ...w.defenders].includes(opts.country)).map((w) => w.name),
    },
  });
}

export async function polish(state: GameState, deps: EngineDeps, opts: { country: string; text: string }) {
  const k = countryByTag(state, opts.country);
  const out = await callJson(deps, state, {
    kind: "polish",
    schemaName: "PolishOutput",
    system: POLISH_SYSTEM,
    user: `COUNTRY: ${k ? countryBrief(k) : opts.country}\nDATE: ${state.date}\n\nORDER TO REWRITE:\n${opts.text}`,
    maxTokens: 800,
    temperature: 0.3,
    mockContext: { text: opts.text, country: opts.country },
  }, PolishOutputSchema);
  return out.text.trim();
}

export async function brainstorm(state: GameState, deps: EngineDeps, opts: { country: string }) {
  const k = countryByTag(state, opts.country);
  const idx = countryIndex(state, opts.country);
  const neighbours = [...(countryAdjacency(state.owners, deps.map).get(idx) ?? [])].map((i) => state.countries[i]?.tag).filter(Boolean);
  const out = await callJson(deps, state, {
    kind: "brainstorm",
    schemaName: "BrainstormOutput",
    system: BRAINSTORM_SYSTEM,
    user: `${countryContext(state, deps, opts.country)}\n\nTASK: Suggest 4-6 orders for ${k?.name ?? opts.country}.`,
    maxTokens: 1500,
    temperature: 0.9,
    mockContext: { country: opts.country, name: k?.name, goals: k?.agenda.goals ?? [], neighbours },
  }, BrainstormOutputSchema);
  return out.ideas.map((i) => i.trim()).filter(Boolean).slice(0, 6);
}
