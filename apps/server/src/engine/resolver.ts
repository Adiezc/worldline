// The resolver narrates the turn and proposes effects; every effect then goes through the
// shared validator (applyEvent), so the model can be wrong without breaking the rules.

import {
  atWar,
  addDays, applyEvent, countryByTag, daysBetween, humanTags, ResolverOutputSchema,
  type Effect, type GameEvent, type GameState, type Order, type OrderVerdict, type Tiers, type TurnContext,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { nameOf, worldContext } from "./context.ts";
import type { NpcIntent } from "./director.ts";
import { clampDate, makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { resolverSystem } from "./prompts.ts";

export interface ResolverResult {
  verdicts: OrderVerdict[];
  events: GameEvent[];
  /** Last day of the turn (stopDate for open-ended jumps). */
  end: string;
}

const MAX_EVENTS = 24;

export async function runResolver(
  state: GameState,
  deps: EngineDeps,
  opts: { days: number; orders: Order[]; intents: NpcIntent[]; voteFacts: string[]; tiers: Tiers; ctx: TurnContext },
): Promise<ResolverResult> {
  const { days, orders } = opts;
  const world = worldContext(state, deps, days, opts.tiers);
  const humans = humanTags(state);
  const calls = state.wars.flatMap((w) => (w.calls ?? []).map((c) => ({ warId: w.id, tag: c.tag, via: c.via })));
  const economy = state.settings.economyMode;
  // The Director's own-country actions and vote results are already in the log for this turn.
  const reported = state.events.filter((e) => e.turn === state.turn);

  const sections = [
    world.text,
    orders.length
      ? `ORDERS (from players; give each a verdict):\n${orders.map((o) => `${o.id} [${o.country}] ${o.text}`).join("\n")}`
      : "ORDERS: none this turn.",
    opts.intents.length ? `NPC INTENTS (AI governments' plans this period):\n${opts.intents.map((i) => `- ${i.country}: ${i.summary}`).join("\n")}` : "",
    reported.length
      ? `ALREADY REPORTED THIS PERIOD (these happened; do not repeat or re-narrate them, build on them instead):\n${reported.map((e) => `- ${e.date} ${e.headline}`).join("\n")}`
      : "",
    opts.voteFacts.length ? `VOTE OUTCOMES (facts):\n${opts.voteFacts.map((f) => `- ${f}`).join("\n")}` : "",
    calls.length ? `CALLS TO ARMS to answer this period: ${calls.map((c) => `${c.tag} for ${c.warId} (via ${c.via})`).join(", ")}` : "",
    `TASK: Write what happens from ${state.date} to ${world.end}${days === 0 ? " (or your stopDate)" : ""}. Return the JSON object.`,
  ];

  const out = await callJson(deps, state, {
    kind: "resolver",
    schemaName: "ResolverOutput",
    system: resolverSystem(state, days, economy),
    user: sections.filter(Boolean).join("\n\n"),
    maxTokens: 12000,
    temperature: 0.7,
    reasoning: "setting",
    mockContext: {
      date: state.date,
      end: world.end,
      days,
      orders: orders.map((o) => ({ id: o.id, country: o.country, text: o.text })),
      humans: [...humans],
      tiers: world.tiers,
      names: Object.fromEntries([...world.tiers.engaged, ...world.tiers.movers].map((t) => [t, nameOf(state, t)])),
      wars: state.wars.map((w) => ({ id: w.id, name: w.name, attackers: w.attackers, defenders: w.defenders })),
      // Only fronts where an AI country could advance; occupations by player armies come from orders.
      front: world.front.filter((f) => !humans.has(f.by)).map((f) => ({ ...f, name: deps.map.names[f.province] })),
      calls,
      intents: opts.intents,
      economy,
    },
  }, nonEmptyTurn(orders.length, days));

  // Open-ended jumps stop at the model's stopDate (at least one day, at most the window end).
  let end = world.end;
  if (days === 0) {
    const last = out.events.map((e) => e.date).sort().pop();
    end = clampDate(out.stopDate ?? last ?? addDays(state.date, 30), addDays(state.date, 1), world.end);
    opts.ctx.days = Math.max(1, daysBetween(state.date, end));
  }

  const orderIds = new Set(orders.map((o) => o.id));
  const orderCountry = new Map(orders.map((o) => [o.id, o.country]));

  const verdicts: OrderVerdict[] = [];
  for (const v of out.orderVerdicts) {
    if (orderIds.has(v.orderId) && !verdicts.some((x) => x.orderId === v.orderId)) verdicts.push(v);
  }

  const events: GameEvent[] = [];
  const drafts = out.events
    .map((e, i) => ({ ...e, i, date: clampDate(e.date, state.date, end) }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i))
    .slice(0, MAX_EVENTS);
  for (const d of drafts) {
    const causes = [...new Set(d.causes.filter((c) => orderIds.has(c)))];
    const countries = [...d.countries, ...causes.map((c) => orderCountry.get(c)!)].filter((t) => countryByTag(state, t));
    const ev = makeEvent(state, {
      date: d.date,
      headline: d.headline.trim(),
      body: d.body.trim(),
      countries,
      causes,
      effects: d.effects as Effect[],
    });
    applyEvent(state, deps.map, ev, opts.ctx);
    const unwarred = hostilitiesWithoutWar(state, ev);
    if (unwarred) deps.onValidation?.({ kind: "resolver", outcome: "invalid", error: `"${ev.headline}" reads like fighting between ${unwarred} but no war is declared` });
    state.events.push(ev);
    events.push(ev);
  }

  // Every order gets a verdict, even if the model forgot one.
  for (const o of orders) {
    if (verdicts.some((v) => v.orderId === o.id)) continue;
    const cited = events.some((e) => e.causes.includes(o.id));
    verdicts.push({
      orderId: o.id,
      outcome: cited ? "partial" : "fail",
      reason: cited ? "Some progress was made; see the events of this turn." : "The order produced no notable result this period.",
    });
  }
  // Attach the order text so clients can show "what you ordered → what happened" after a reload.
  for (const v of verdicts) {
    const o = orders.find((x) => x.id === v.orderId);
    if (o) Object.assign(v, { country: o.country, text: o.text });
  }
  return { verdicts, events, end };
}

/** A turn with no news is a failed generation (seen with some fast models), not a quiet month. */
function nonEmptyTurn(orderCount: number, days: number) {
  const min = Math.max(orderCount, days === 0 || days >= 7 ? 3 : 1);
  return ResolverOutputSchema.refine((o) => o.events.length >= min, {
    message: `expected at least ${min} events covering the period and every order`,
  });
}

const COMBAT = /\b(invad\w*|invasion|offensive|incursion|raid(s|ed)?|shell(s|ed|ing)|air ?strikes?|missile strikes?|bombard\w*|troops? (cross|advance|attack)\w*|armed clash\w*)\b/i;

/** Safety net for the prompt rule: combat narrated between two states that are not at war. */
function hostilitiesWithoutWar(state: GameState, ev: GameEvent) {
  if (!COMBAT.test(`${ev.headline} ${ev.body}`)) return null;
  if (ev.effects.some((e) => e.type === "declareWar" || e.type === "joinWar")) return null;
  const tags = ev.countries.filter((t) => countryByTag(state, t)?.alive);
  for (const a of tags) for (const b of tags) if (a < b && !atWar(state, a, b)) {
    // Only flag pairs that are hostile enough for fighting to be plausible.
    const key = `${a}|${b}`;
    if ((state.relations[key] ?? 0) <= -40) return `${a} and ${b}`;
  }
  return null;
}
