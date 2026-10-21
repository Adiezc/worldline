// Live check on a copy of a saved game: plan the AI governments ahead, then time the turn itself
// and list structural changes. The saved game is never modified.
//   bun scripts/turn-check.ts <gameId>
import "../src/env.ts";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMapIndex, type GameState, type MapMeta, type ScenarioSeed } from "@worldline/shared";
import { createProvider } from "../src/ai/index.ts";
import type { EngineDeps } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";

const gameId = process.argv[2];
const ROOT = join(import.meta.dir, "..", "..", "..");
const db = new Database(join(import.meta.dir, "..", "data", "worldline.sqlite"), { readonly: true });
const row = db.query("SELECT state FROM games WHERE id = ?1").get(gameId) as { state: string } | null;
if (!row) throw new Error(`game ${gameId} not found`);
const state = JSON.parse(row.state) as GameState;
state.phase = "orders";
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const seed = JSON.parse(readFileSync(join(ROOT, "packages/scenarios", state.scenarioId, "seed.json"), "utf8")) as ScenarioSeed;
const issues: string[] = [];
const deps: EngineDeps = { map: buildMapIndex(meta), seed, ai: createProvider(), onValidation: (e) => issues.push(`${e.kind} ${e.outcome}: ${e.error.slice(0, 140)}`) };

let t = performance.now();
const pre = engine.planDirector(state, deps);
await pre.plan;
console.log(`planned ahead (while players would be writing orders): ${((performance.now() - t) / 1000).toFixed(0)}s`);
t = performance.now();
const r = await engine.runTurn(state, { ...deps, directorPlan: pre });
console.log(`turn wait after "ready": ${((performance.now() - t) / 1000).toFixed(0)}s, ${r.events.length} events`);
const structural = r.events.flatMap((e) => e.effects.filter((x) => !["statDelta", "relationDelta"].includes(x.type)).map((x) => `${e.date} ${x.type}: ${e.headline}`));
console.log(`structural changes (${structural.length}):\n  ${structural.join("\n  ") || "none"}`);
console.log(`rejected ${r.events.reduce((n, e) => n + (e.rejected?.length ?? 0), 0)}, clamped ${r.events.reduce((n, e) => n + (e.clamped?.length ?? 0), 0)}`);
console.log(`wars now: ${state.wars.map((w) => `${w.attackers.join("+")} vs ${w.defenders.join("+")}`).join("; ")}`);
if (issues.length) console.log(`validation notes:\n  ${issues.join("\n  ")}`);
