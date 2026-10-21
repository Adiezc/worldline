// Deterministic background simulation run after each turn's events, so the numbers move even
// when the AI narrates nothing about a country.

import { loanDrag } from "./loans.ts";
import { falloutDrag } from "./nuclear.ts";
import { countryIndex, getRelation, relKey, warsOf, type GameState } from "./state.ts";

export function simTick(state: GameState, days: number) {
  const years = days / 365;
  const months = days / 30;
  const blocMembers = new Set(state.organizations.filter((o) => o.effects.tradeBloc).flatMap((o) => o.members));
  const sanctionCount = new Map<string, number>();
  for (const s of state.sanctions) sanctionCount.set(s.target, (sanctionCount.get(s.target) ?? 0) + Math.min(3, Math.ceil(s.by.length / 5)));
  // Total sanction pressure is capped so stacked records cannot drive growth below -100%.
  for (const [t, n] of sanctionCount) sanctionCount.set(t, Math.min(6, n));

  for (const k of state.countries) {
    if (!k.alive) continue;
    const wars = warsOf(state, k.tag);
    const idx = countryIndex(state, k.tag);
    let owned = 0, occupied = 0;
    for (let id = 1; id < state.owners.length; id++) {
      if (state.owners[id] !== idx) continue;
      owned++;
      if (state.controllers[id] !== idx) occupied++;
    }
    const occShare = owned ? occupied / owned : 0;
    const sanctions = sanctionCount.get(k.tag) ?? 0;
    // Contaminated land and wrecked cities drag on the economy and morale for about a year.
    const fallout = falloutDrag(state, k.tag, state.date);
    // IMF and World Bank loans: austerity or investment while the programme runs, repayments after.
    const loans = loanDrag(state, k.tag, state.date);

    // GDP: trend growth bent by stability, war, sanctions and trade-bloc membership.
    const growth = 2.4 + (k.stability - 55) / 18 - k.warExhaustion / 30 - (wars.length ? 1.2 : 0)
      - occShare * 8 - sanctions * 1.6 - fallout + (blocMembers.has(k.tag) ? 0.4 : 0) + loans.growth;
    // Floor growth: a base of (1 + g/100) <= 0 raised to a fractional power is NaN.
    k.gdp = Math.max(0.01, r2(k.gdp * Math.pow(1 + Math.max(-50, growth) / 100, years)));

    // Population: slow growth, dented by war.
    const popGrowth = (k.population > 100 ? 0.7 : 1.1) - (wars.length ? 0.6 : 0) - occShare * 2;
    // Keep micro-states above zero after rounding (same floor as the engine's STAT_RANGE).
    k.population = Math.max(0.001, r2(k.population * Math.pow(1 + popGrowth / 100, years)));

    // Stability drifts to a target pulled down by war exhaustion, occupation and sanctions.
    const target = 58 - k.warExhaustion * 0.35 - occShare * 30 - sanctions * 4 - fallout * 1.5 + loans.stability;
    k.stability = r2(clamp(k.stability + (target - k.stability) * Math.min(1, 0.05 * months), 0, 100));

    // War exhaustion builds while fighting (faster when occupied) and fades in peace. Growth slows
    // as it rises, so a long war grinds towards 100 over years instead of pinning there.
    if (wars.length) k.warExhaustion = r2(clamp(k.warExhaustion + (1.5 + occShare * 12) * months * (1 - k.warExhaustion / 100), 0, 100));
    else k.warExhaustion = r2(clamp(k.warExhaustion - 5 * months, 0, 100));

    // Militaries wear down in long wars.
    if (wars.length) k.military = r2(clamp(k.military - 0.25 * months, 0, 100));
  }

  // Organisation cohesion drifts back towards a healthy level; open feuds between members drag it.
  for (const o of state.organizations) {
    let feud = 0;
    for (const a of o.members) for (const b of o.members) if (a < b && getRelation(state, a, b) < -40) feud++;
    o.cohesion = r2(clamp(o.cohesion + (72 - o.cohesion) * Math.min(1, 0.04 * months) - feud * 0.5 * months, 0, 100));
  }

  // Relations slowly regress toward neutral so old grudges and honeymoons fade.
  for (const key of Object.keys(state.relations)) {
    const v = state.relations[key];
    const [a, b] = key.split("|");
    if (warsOf(state, a).some((w) => w.attackers.includes(b) || w.defenders.includes(b))) continue;
    // Rounded to 2 decimals, not integers: Math.round(v * 0.97) === v for |v| <= 16, so with
    // monthly ticks small grudges never faded at all.
    state.relations[key] = r2(v * Math.pow(0.97, months));
    if (Math.abs(state.relations[key]) < 0.5) delete state.relations[key];
  }
}

/** Calls to arms left unanswered for a turn count as refusals: cohesion and relations suffer. */
export function expireCalls(state: GameState) {
  const refusals: { tag: string; war: string; via: string }[] = [];
  for (const w of state.wars) {
    const keep: NonNullable<typeof w.calls> = [];
    for (const call of w.calls ?? []) {
      if (state.turn - call.since < 2) { keep.push(call); continue; }
      refusals.push({ tag: call.tag, war: w.name, via: call.via });
      const org = state.organizations.find((o) => o.abbrev === call.via);
      if (org) org.cohesion = clamp(org.cohesion - 6, 0, 100);
      for (const d of w.defenders) state.relations[relKey(d, call.tag)] = clamp(getRelation(state, d, call.tag) - 12, -100, 100);
    }
    w.calls = keep;
  }
  return refusals;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (v: number) => Math.round(v * 100) / 100;
