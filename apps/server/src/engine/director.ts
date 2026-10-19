// The Director plans what AI governments do this turn. Purely domestic moves are applied right
// away as world events; anything touching other countries is handed to the resolver.

import {
  addDays, applyEvent, countryByTag, DirectorOutputSchema, humanTags,
  type Effect, type GameEvent, type GameState, type Tiers, type TurnContext,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import {
  calendarBlock, calendarIn, countriesBlock, memoryBlock, nameOf, orgsBlock, recentEventsBlock, relationsBlock,
  sanctionsBlock, treatiesBlock, warsBlock, windowEnd, windowLine,
} from "./context.ts";
import { makeEvent, spreadDate } from "./game.ts";
import { callJson } from "./llm.ts";
import { directorSystem } from "./prompts.ts";

export interface NpcIntent {
  country: string;
  summary: string;
}

export interface DirectorResult {
  intents: NpcIntent[];
  events: GameEvent[];
}

/** Only effects on the acting country itself survive. */
export function selfOnly(e: Effect, tag: string) {
  return (e.type === "statDelta" || e.type === "changeLeader" || e.type === "updateAgenda") && e.country === tag;
}

export async function runDirector(
  state: GameState, deps: EngineDeps, opts: { days: number; ctx: TurnContext; tiers: Tiers },
): Promise<DirectorResult> {
  const humans = humanTags(state);
  const end = windowEnd(state, opts.days);
  // Countries with scheduled events act too, so the planner can decide those events.
  const scheduled = calendarIn(deps.seed, state.date, end).flatMap((c) => c.countries);
  const acting = [...new Set([...opts.tiers.movers, ...opts.tiers.background, ...scheduled])]
    .filter((t) => !humans.has(t) && countryByTag(state, t)?.alive);
  if (!acting.length) return { intents: [], events: [] };

  const scope = new Set([...acting, ...humans]);
  const user = [
    windowLine(state, opts.days),
    memoryBlock(state, deps.seed),
    countriesBlock(state, acting, [...humans]).replace("COUNTRIES IN FOCUS:", "ACTING COUNTRIES:"),
    relationsBlock(state, scope),
    warsBlock(state),
    treatiesBlock(state, new Set(acting), 30),
    sanctionsBlock(state, 15),
    orgsBlock(state, { maxMembers: 12 }),
    recentEventsBlock(state, { max: 30 }),
    calendarBlock(deps.seed, state.date, end),
    `TASK: Decide what the ${acting.length} acting governments do between ${state.date} and ${end}. Return the JSON object.`,
  ].filter(Boolean).join("\n\n");

  const out = await callJson(deps, state, {
    kind: "director",
    schemaName: "DirectorOutput",
    system: directorSystem(state),
    user,
    maxTokens: 6000,
    temperature: 0.8,
    mockContext: {
      date: state.date,
      end,
      acting: acting.map((t) => ({ tag: t, name: nameOf(state, t) })),
      calendar: calendarIn(deps.seed, state.date, end),
    },
  }, DirectorOutputSchema);

  // Open-ended turns end at an unknown date; keep planner events early so they survive clamping.
  const evEnd = opts.days > 0 ? end : addDays(state.date, 14);
  const allowed = new Set(acting);
  const intents: NpcIntent[] = [];
  const events: GameEvent[] = [];
  const valid = out.intents.filter((i) => allowed.has(i.country));

  valid.forEach((intent, i) => {
    // Plans involving others are played out (and reported) by the resolver.
    if (intent.affectsOthers) {
      intents.push({ country: intent.country, summary: intent.summary });
      return;
    }
    const effects = (intent.selfEffects as Effect[]).filter((e) => selfOnly(e, intent.country));
    if (!effects.length) return;
    const ev = makeEvent(state, {
      date: spreadDate(state.date, evEnd, i, valid.length),
      headline: headlineOf(intent.summary),
      countries: [intent.country],
      effects,
      scope: "world",
    });
    applyEvent(state, deps.map, ev, opts.ctx);
    state.events.push(ev);
    events.push(ev);
  });

  // Agenda changes are internal to the AI: validate them, but keep them out of the news feed.
  const agenda: Effect[] = out.agendaUpdates
    .filter((a) => allowed.has(a.country))
    .map((a) => ({ type: "updateAgenda", country: a.country, goals: a.goals }));
  if (agenda.length) {
    applyEvent(state, deps.map, {
      id: "agenda", turn: state.turn, date: state.date, headline: "Agenda updates", body: "", countries: [], causes: [],
      effects: agenda, scope: "world",
    }, opts.ctx);
  }

  out.resolutions.filter((r) => allowed.has(r.proposer)).slice(0, 3).forEach((r, i) => {
    const org = state.organizations.find((o) => o.id === r.orgId);
    if (!org) return;
    const target = r.target ? ` on ${nameOf(state, r.target)}` : "";
    const ev = makeEvent(state, {
      date: spreadDate(state.date, evEnd, i, 3),
      headline: `${nameOf(state, r.proposer)} tables ${r.resolutionType} resolution${target} at the ${org.abbrev}`,
      body: r.text,
      countries: [r.proposer, ...(r.target ? [r.target] : [])],
      effects: [{ type: "proposeResolution", orgId: r.orgId, resolutionType: r.resolutionType, proposer: r.proposer, target: r.target, text: r.text }],
    });
    applyEvent(state, deps.map, ev, opts.ctx);
    if (!ev.effects.length) return;
    state.events.push(ev);
    events.push(ev);
  });

  return { intents, events };
}

/** Planner summaries are sentences; headlines drop the final full stop. */
export const headlineOf = (s: string) => s.trim().replace(/\.$/, "");
