// Benchmark models on a real saved game: runs the next turn on a copy of the state once per model
// and reports time, tokens and validity per call. The saved game is never modified.
//
//   bun scripts/bench.ts <gameId> [model ...]
//
// Costs one director + one resolver call per model (paid models bill your OpenRouter credits).

import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMapIndex, type GameState, type MapMeta, type ScenarioSeed } from "@worldline/shared";
import { OpenRouterProvider } from "../src/ai/openrouter.ts";
import type { AiCallInfo, EngineDeps } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set.");
  process.exit(2);
}
const [gameId, ...models] = process.argv.slice(2);
if (!gameId) {
  console.error("usage: bun scripts/bench.ts <gameId> [model ...]");
  process.exit(2);
}

const ROOT = join(import.meta.dir, "..", "..", "..");
const db = new Database(join(import.meta.dir, "..", "data", "worldline.sqlite"), { readonly: true });
const row = db.query("SELECT state FROM games WHERE id = ?1").get(gameId) as { state: string } | null;
if (!row) {
  console.error(`game ${gameId} not found`);
  process.exit(2);
}
const saved = JSON.parse(row.state) as GameState;
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const seed = JSON.parse(readFileSync(join(ROOT, "packages/scenarios", saved.scenarioId, "seed.json"), "utf8")) as ScenarioSeed;
const map = buildMapIndex(meta);
const list = models.length ? models : saved.settings.modelChain;

console.log(`game ${gameId}: turn ${saved.turn}, ${saved.date}, reasoning off for the benchmark\n`);
for (const model of list) {
  const calls: AiCallInfo[] = [];
  const ai = new OpenRouterProvider(key, { onCall: (c) => calls.push(c) });
  const state = structuredClone(saved);
  state.phase = "orders";
  state.settings = { ...state.settings, modelChain: [model], reasoningEffort: "none" };
  const issues: string[] = [];
  const deps: EngineDeps = { map, seed, ai, onValidation: (e) => issues.push(`${e.kind} ${e.outcome}`) };
  const t = performance.now();
  let summary: string;
  try {
    const r = await engine.runTurn(state, deps);
    const rejected = r.events.reduce((n, e) => n + (e.rejected?.length ?? 0), 0);
    summary = `ok ${((performance.now() - t) / 1000).toFixed(0)}s, ${r.events.length} events, ${rejected} rejected`;
  } catch (e) {
    summary = `FAILED after ${((performance.now() - t) / 1000).toFixed(0)}s: ${e instanceof Error ? e.message.slice(0, 160) : e}`;
  }
  console.log(`${model}\n  turn: ${summary}${issues.length ? ` (validation: ${issues.join(", ")})` : ""}`);
  for (const c of calls) {
    console.log(`  ${c.kind.padEnd(13)} ${c.ok ? "ok    " : "FAILED"} ${(c.latencyMs / 1000).toFixed(1).padStart(6)}s  in ${String(c.promptTokens).padStart(6)}  out ${String(c.completionTokens).padStart(6)}${c.attempts > 1 ? `  attempts ${c.attempts}` : ""}${c.error ? `  ${c.error.slice(0, 120)}` : ""}`);
  }
  console.log();
}
