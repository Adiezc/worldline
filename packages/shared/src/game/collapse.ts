// When a state breaks. Stability and war exhaustion used to be numbers with no consequence of their
// own: a country at stability 1 and war exhaustion 98 governed and fought on as usual. These are the
// thresholds the turn pipeline acts on (apps/server/src/engine/crisis.ts).

import { countryByTag, countryIndex, warsOf, type GameState } from "./state.ts";

/** At or below this stability the government falls at the end of a turn. */
export const COLLAPSE_STABILITY = 8;
/** Turns before the same country's government can fall again. */
export const COLLAPSE_COOLDOWN = 4;
/** Where the new government starts, and what the upheaval costs. */
export const AFTER_COLLAPSE = { stability: 22, military: 8, gdp: 4, exhaustion: 5 };
/** Turns between a collapsing nation's offers of surrender to the same player. */
export const SURRENDER_REPEAT = 2;

export function governmentFalls(state: GameState, tag: string) {
  const k = countryByTag(state, tag);
  if (!k?.alive || k.stability > COLLAPSE_STABILITY) return false;
  return k.collapsedTurn === undefined || state.turn - k.collapsedTurn >= COLLAPSE_COOLDOWN;
}

/** Share of a country's own regions the enemy holds. */
export function landLost(state: GameState, tag: string) {
  const idx = countryIndex(state, tag);
  let owned = 0, lost = 0;
  for (let id = 1; id < state.owners.length; id++) {
    if (state.owners[id] !== idx) continue;
    owned++;
    if (state.controllers[id] !== idx) lost++;
  }
  return owned ? lost / owned : 0;
}

/**
 * A belligerent that can no longer fight on: near-total war exhaustion, exhaustion with a
 * government barely holding, or half its land overrun. Such a nation sues for peace and signs
 * whatever terms the rules allow the winner to impose.
 */
export function warCollapse(state: GameState, tag: string) {
  const k = countryByTag(state, tag);
  if (!k?.alive || !warsOf(state, tag).length) return false;
  return k.warExhaustion >= 95 || (k.warExhaustion >= 85 && k.stability <= 15) || landLost(state, tag) >= 0.5;
}
