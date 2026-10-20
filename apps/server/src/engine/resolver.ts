// The resolver narrates the turn and proposes effects; every effect then goes through the
// shared validator (applyEvent), so the model can be wrong without breaking the rules.

import {
  activeProjects, atWar,
  addDays, applyEvent, countryByTag, daysBetween, FORTUNES, humanTags, occupyCap, planOperations, ResolverOutputSchema, STANCE_LABELS,
  type Effect, type GameEvent, type GameState, type MapIndex, type OperationPlan, type Order, type OrderVerdict, type Tiers,
  type Outreach, type TurnContext,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { nameOf, receiptBlock, worldContext } from "./context.ts";
import type { NpcIntent } from "./director.ts";
import { clampDate, makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { resolverSystem } from "./prompts.ts";

export interface ResolverResult {
  verdicts: OrderVerdict[];
  events: GameEvent[];
  /** Last day of the turn (stopDate for open-ended jumps). */
  end: string;
  /** Messages AI governments send players unprompted; delivered once the turn commits. */
  outreach: Outreach[];
}

const MAX_EVENTS = 24;

export async function runResolver(
  state: GameState,
  deps: EngineDeps,
  opts: { days: number; orders: Order[]; intents: NpcIntent[]; voteFacts: string[]; tiers: Tiers; ctx: TurnContext },
): Promise<ResolverResult> {
  const { days } = opts;
  // Proclamations of formable nations are settled by the rules after the resolver runs.
  const orders = opts.orders.filter((o) => !o.formable);
  const world = worldContext(state, deps, days, opts.tiers);
  const humans = humanTags(state);
  const calls = state.wars.flatMap((w) => (w.calls ?? []).map((c) => ({ warId: w.id, tag: c.tag, via: c.via })));
  const economy = state.settings.economyMode;
  // The Director's own-country actions and vote results are already in the log for this turn.
  const reported = state.events.filter((e) => e.turn === state.turn);
  // Battle plans are sized against the map as it stands now (after the AI governments moved).
  const plans = planOperations(state, deps.map, orders, occupyCap(state, opts.ctx.days));
  opts.ctx.operations = plans.map((p) => ({ orderId: p.orderId, country: p.country, kind: p.kind, allowed: new Set(p.allowed), cap: p.cap, used: 0 }));

  const sections = [
    world.text,
    orders.length
      ? `ORDERS (from players; give each a verdict):\n${orders.map((o) => `${o.id} [${o.country}] ${o.operation ? "(battle plan, see OPERATIONS) " : ""}${o.text}`).join("\n")}`
      : "ORDERS: none this turn.",
    plans.length ? operationsBlock(state, deps.map, plans) : "",
    opts.intents.length ? `NPC INTENTS (AI governments' plans this period):\n${opts.intents.map((i) => `- ${i.country}: ${i.summary}`).join("\n")}` : "",
    reported.length
      ? `ALREADY REPORTED THIS PERIOD (these happened; do not repeat or re-narrate them, build on them instead):\n${reported.map((e) => `- ${e.date} ${e.headline}`).join("\n")}`
      : "",
    opts.voteFacts.length ? `VOTE OUTCOMES (facts):\n${opts.voteFacts.map((f) => `- ${f}`).join("\n")}` : "",
    calls.length ? `CALLS TO ARMS to answer this period: ${calls.map((c) => `${c.tag} for ${c.warId} (via ${c.via})`).join(", ")}` : "",
    receiptBlock(state),
    `TASK: Write what happens from ${state.date} to ${world.end}${days === 0 ? " (or your stopDate)" : ""}. Return the JSON object.`,
  ];

  const out = await callJson(deps, state, {
    kind: "resolver",
    schemaName: "ResolverOutput",
    system: resolverSystem(state, days, economy),
    user: sections.filter(Boolean).join("\n\n"),
    cacheUpto: world.stable,
    maxTokens: 12000,
    temperature: 0.7,
    reasoning: "setting",
    mockContext: {
      date: state.date,
      end: world.end,
      days,
      orders: orders.map((o) => ({ id: o.id, country: o.country, text: o.text })),
      operations: plans.map((p) => ({ orderId: p.orderId, country: p.country, kind: p.kind, route: p.route, cap: p.cap })),
      humans: [...humans],
      tiers: world.tiers,
      names: Object.fromEntries([...world.tiers.engaged, ...world.tiers.movers].map((t) => [t, nameOf(state, t)])),
      wars: state.wars.map((w) => ({ id: w.id, name: w.name, attackers: w.attackers, defenders: w.defenders })),
      // Only fronts where an AI country could advance; occupations by player armies come from orders.
      front: world.front.filter((f) => !humans.has(f.by)).map((f) => ({ ...f, name: deps.map.names[f.province] })),
      calls,
      intents: opts.intents,
      economy,
      projects: activeProjects(state).filter((p) => humans.has(p.country)).map((p) => ({ id: p.id, country: p.country, name: p.name, progress: p.progress })),
      // Orders from nuclear powers at war, with the enemy they could strike.
      strikes: orders.flatMap((o) => {
        const w = countryByTag(state, o.country)?.nuclear ? state.wars.find((x) => x.attackers.includes(o.country) || x.defenders.includes(o.country)) : undefined;
        return w ? [{ orderId: o.id, country: o.country, target: (w.attackers.includes(o.country) ? w.defenders : w.attackers)[0] }] : [];
      }),
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
    if (o) Object.assign(v, { country: o.country, text: o.text }, o.operation ? { operation: o.operation } : {});
  }
  return { verdicts, events, end, outreach: humans.size ? out.outreach : [] };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * Battle plans for the prompt: the situation to judge, the fortune the engine rolled, the axis by
 * name and id, and the limits the engine enforces. No force counts: the model weighs strength.
 */
function operationsBlock(state: GameState, map: MapIndex, plans: OperationPlan[]) {
  const region = (id: number) => `${map.names[id] ?? "region"} (${id})`;
  const side = (tag: string) => {
    const c = countryByTag(state, tag);
    return c ? `${c.name} (${tag}: military ${Math.round(c.military)}, stability ${Math.round(c.stability)}, war exhaustion ${Math.round(c.warExhaustion)})` : tag;
  };
  const fortune = (p: OperationPlan) => `FORTUNE OF WAR (rolled by the engine; honour it): ${p.fortune.toUpperCase()}, ${FORTUNES[p.fortune].text}.`;
  const month = MONTHS[Number(state.date.slice(5, 7)) - 1] ?? "";
  const lines = plans.map((p) => {
    const enemy = p.enemyTag ? side(p.enemyTag) : "the enemy";
    if (p.kind === "hold") {
      return `${p.orderId} [${p.country}] HOLD LINE "${p.name}": ${side(p.country)} digs in on ${p.route.map(region).join(", ")} against ${enemy}.\n` +
        `  ${fortune(p)} Whatever else happens, the enemy can take at most ${p.cap} of these regions this period; prepared defences make attacks on them costly.`;
    }
    const owner = (id: number) => state.countries[state.owners[id]]?.tag;
    const homeSoil = p.route.slice(1).some((id) => owner(id) === p.enemyTag);
    const dugIn = plans.some((h) => h.kind === "hold" && h.country === p.enemyTag && h.route.some((id) => p.allowed.includes(id)));
    return `${p.orderId} [${p.country}] OFFENSIVE "${p.name}" by ${side(p.country)} against ${enemy}, stance ${STANCE_LABELS[p.stance].toLowerCase()}.\n` +
      `  Axis: ${p.route.map(region).join(" → ")} (${p.route.length - 1} regions deep).\n` +
      `  Judge it from the situation: both sides' real military strength, equipment and allies; morale and war exhaustion; supply over that depth; ` +
      `terrain and rivers along the axis; the season (${month})${homeSoil ? "; the defenders fight on home soil" : ""}${dugIn ? "; the defenders have dug in on a hold line across it" : ""}; air power; and this period's events.\n` +
      `  ${fortune(p)}\n` +
      `  It may take ONLY these regions (the axis and its flanks): ${p.allowed.join(", ")}. At most ${p.cap} this period, nearest the jump-off first; ` +
      `taking fewer, or none, is right when the situation and fortune say so. Record gains as setController (controller ${p.country}) with cause ${p.orderId}; ` +
      `report losses, and add warExhaustion for ${p.country}${p.stance === "allout" ? " (heavier for an all-out push)" : ""}.`;
  });
  return `OPERATIONS (battle plans players drew on the map; adjudicate each like a war correspondent with a staff map):\n${lines.join("\n")}`;
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
