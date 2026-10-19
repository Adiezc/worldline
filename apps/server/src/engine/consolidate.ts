// Long-term memory: every few turns, older events are compressed into a short chronicle so the
// prompts stay small however long the game runs.

import { ConsolidationOutputSchema, type GameState } from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { callJson } from "./llm.ts";
import { CONSOLIDATION_SYSTEM } from "./prompts.ts";

const coveredTo = (state: GameState) => state.memory.at(-1)?.upToTurn ?? 0;

/**
 * Consolidate after resolving turn `turn` (before the turn counter advances): every 5 turns from
 * turn 5, or earlier when a failed run left a long uncovered stretch.
 */
export function needsConsolidation(state: GameState, turn: number) {
  const cutoff = turn - 2;
  if (turn < 5 || cutoff <= coveredTo(state)) return false;
  return turn % 5 === 0 || cutoff - coveredTo(state) >= 8;
}

export async function consolidate(state: GameState, deps: EngineDeps, turn: number) {
  const from = coveredTo(state), cutoff = turn - 2;
  const list = state.events.filter((e) => e.turn > from && e.turn <= cutoff);
  if (!list.length) {
    state.memory.push({ upToTurn: cutoff, text: "A quiet period with no notable developments." });
    return;
  }
  // Prefer consequential events when there are too many to list.
  const weight = (e: (typeof list)[number]) => (e.mapDiff?.length ? 3 : 0) + (e.scope === "player" ? 2 : 0) + (e.effects.length ? 1 : 0);
  const picked = list.length > 150 ? [...list].sort((a, b) => weight(b) - weight(a)).slice(0, 150).sort((a, b) => (a.date < b.date ? -1 : 1)) : list;
  const lines = picked.map((e) => `${e.date} ${e.headline}${e.body ? ` — ${e.body.slice(0, 160)}` : ""}`);
  const previous = state.memory.at(-1)?.text;

  const out = await callJson(deps, state, {
    kind: "consolidation",
    schemaName: "ConsolidationOutput",
    system: CONSOLIDATION_SYSTEM,
    user: [
      previous ? `PREVIOUS CHRONICLE (do not repeat it):\n${previous}` : "",
      `EVENTS (turns ${from + 1}-${cutoff}):\n${lines.join("\n")}`,
      "TASK: Summarise these events.",
    ].filter(Boolean).join("\n\n"),
    maxTokens: 1500,
    temperature: 0.3,
    mockContext: { headlines: picked.map((e) => e.headline) },
  }, ConsolidationOutputSchema);
  state.memory.push({ upToTurn: cutoff, text: out.summary.trim() });
}
