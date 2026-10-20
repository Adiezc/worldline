// Turn pipeline: director → votes → resolver → validate/apply → simTick → consolidation.
// Everything runs on a clone that is committed only on success, so a failed AI call leaves the
// game exactly as it was.

import {
  addDays, computeTiers, countryByTag, daysBetween, expireCalls, newTurnContext, simTick,
  type GameState, type TurnResult,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { deliverOutreach } from "./chat.ts";
import { consolidate, needsConsolidation } from "./consolidate.ts";
import { collapseGovernments, offerSurrenders } from "./crisis.ts";
import { proclaimFormables } from "./formation.ts";
import { planDirector, runDirector, type NpcIntent } from "./director.ts";
import { makeEvent } from "./game.ts";
import { runResolver } from "./resolver.ts";
import { runVotes } from "./votes.ts";

export async function runTurn(state: GameState, deps: EngineDeps): Promise<TurnResult> {
  const work = structuredClone(state);
  const result = await resolveTurn(work, deps);
  for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
  Object.assign(state, work);
  deps.onProgress?.("done");
  return result;
}

/**
 * Kick off the Director for the turn that just opened. It runs on a copy of the state, so players
 * can keep chatting and ordering meanwhile; runTurn uses it if the turn, date and jump still match.
 */
export function startDirectorPlan(state: GameState, deps: EngineDeps) {
  const days = jumpDays(state);
  const copy = structuredClone(state);
  const plan = state.settings.economyMode
    ? Promise.resolve(null)
    : planDirector(copy, deps, { days, tiers: computeTiers(copy, deps.map) }).catch(() => null);
  return { turn: state.turn, date: state.date, days, plan };
}

/** Jump length: the setting, or the median of the players' votes when jump voting is on. */
export function jumpDays(state: GameState) {
  const votes = Object.values(state.jumpVotes).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (!state.settings.jumpVoting || !votes.length) return state.settings.jumpDays;
  const mid = votes.length >> 1;
  return votes.length % 2 ? votes[mid] : Math.round((votes[mid - 1] + votes[mid]) / 2);
}

async function resolveTurn(state: GameState, deps: EngineDeps): Promise<TurnResult> {
  const progress = deps.onProgress ?? (() => {});
  const turn = state.turn, fromDate = state.date;
  const days = jumpDays(state);
  const orders = Object.values(state.orders).flat().filter((o) => o.text.trim() && countryByTag(state, o.country)?.alive);
  const firstEvent = state.events.length;
  const tiers = computeTiers(state, deps.map);
  // Open-ended jumps size their caps for ~2 months until the resolver picks the stop date.
  const ctx = newTurnContext(days > 0 ? days : 60, orders);

  let intents: NpcIntent[] = [];
  if (!state.settings.economyMode) {
    progress("director");
    const pre = deps.directorPlan;
    const usable = pre && pre.turn === turn && pre.date === fromDate && pre.days === days;
    const plan = usable ? await pre.plan.catch(() => null) : null;
    intents = (await runDirector(state, deps, { days, ctx, tiers, plan })).intents;
  }

  progress("votes");
  const votes = await runVotes(state, deps);

  progress("resolver");
  const res = await runResolver(state, deps, { days, orders, intents, voteFacts: votes.facts, tiers, ctx });

  progress("applying");
  const toDate = days > 0 ? addDays(fromDate, days) : res.end;
  for (const e of state.events.slice(firstEvent)) if (e.date > toDate) e.date = toDate;
  // Proclamations are decided by the rules once the period's fighting and treaties are done.
  const formed = proclaimFormables(state, deps, orders, toDate);
  res.verdicts = [...res.verdicts.filter((v) => !formed.verdicts.some((f) => f.orderId === v.orderId)), ...formed.verdicts];
  for (const v of formed.verdicts) {
    const o = orders.find((x) => x.id === v.orderId);
    if (o) Object.assign(v, { country: o.country, text: o.text });
  }
  simTick(state, Math.max(1, daysBetween(fromDate, toDate)));
  for (const r of expireCalls(state)) {
    state.events.push(makeEvent(state, {
      date: toDate,
      headline: `${countryByTag(state, r.tag)?.name ?? r.tag} ignores ${r.via} call to arms`,
      body: `${countryByTag(state, r.tag)?.name ?? r.tag} has not joined the ${r.war} despite its obligations through ${r.via}, straining the alliance.`,
      countries: [r.tag],
    }));
  }
  // Once the period's events and the drift are in: governments at rock bottom fall.
  collapseGovernments(state, toDate);

  // Chronological log for playback; effects were already applied in validation order.
  const fresh = state.events.splice(firstEvent).map((e, i) => ({ e, i }));
  fresh.sort((a, b) => (a.e.date < b.e.date ? -1 : a.e.date > b.e.date ? 1 : a.i - b.i));
  state.events.push(...fresh.map((x) => x.e));

  state.date = toDate;
  state.turn = turn + 1;
  state.rotation += 10;
  state.orders = {};
  state.jumpVotes = {};
  state.lastVerdicts = res.verdicts;
  state.verdictLog = [...(state.verdictLog ?? []), ...res.verdicts.map((v) => ({ ...v, turn, date: fromDate }))].slice(-500);
  state.phase = "orders";
  for (const p of state.players) p.ready = false;
  // After the turn advances, so the channels count as active in the new one.
  deliverOutreach(state, res.outreach, toDate);
  offerSurrenders(state, toDate);

  if (needsConsolidation(state, turn)) {
    progress("consolidating");
    try {
      await consolidate(state, deps, turn);
    } catch (err) {
      // Memory is a nicety; the turn stands and a later turn catches up.
      console.warn(`[consolidate] skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  return { turn, fromDate, toDate, events: state.events.slice(firstEvent), verdicts: res.verdicts, votes: votes.results };
}
