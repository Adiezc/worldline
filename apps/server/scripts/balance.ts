// Balance check: for each difficulty, 40 one-month turns with the offline mock from the modern
// seed (one passive human player), then aggregate drift of the deterministic simulation.
//
//   bun run balance            (TURNS=40 by default)

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMapIndex, type Difficulty, type GameState, type MapMeta, type ScenarioSeed } from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import { engine } from "../src/engine/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const seed = JSON.parse(readFileSync(join(ROOT, "packages/scenarios/modern-2026/seed.json"), "utf8")) as ScenarioSeed;
const map = buildMapIndex(meta);
const TURNS = Number(process.env.TURNS ?? 40);

/** Reason strings with numbers and tags stripped, so similar rejections group together. */
const category = (reason: string) =>
  reason.replace(/-?\d+(\.\d+)?/g, "N").replace(/\b[A-Z]{2,4}\b(, [A-Z]{2,4})*/g, "X").replace(/\s+/g, " ").slice(0, 70);

function stats(s: GameState) {
  const alive = s.countries.filter((c) => c.alive);
  const stab = alive.map((c) => c.stability);
  const we = alive.map((c) => c.warExhaustion);
  let occupied = 0;
  for (let id = 1; id < s.owners.length; id++) if (s.owners[id] >= 0 && s.controllers[id] !== s.owners[id]) occupied++;
  return {
    gdp: alive.reduce((a, c) => a + c.gdp, 0),
    pop: alive.reduce((a, c) => a + c.population, 0),
    stabMean: stab.reduce((a, b) => a + b, 0) / stab.length,
    stabMin: Math.min(...stab),
    collapsed: stab.filter((x) => x < 20).length,
    weMean: we.reduce((a, b) => a + b, 0) / we.length,
    weMax: Math.max(...we),
    wars: s.wars.length,
    occupied,
    alive: alive.length,
  };
}

const f1 = (n: number) => n.toFixed(1);
const warnings: string[] = [];

for (const difficulty of ["easy", "normal", "hard", "realistic"] as Difficulty[]) {
  const state = engine.createGame({ id: `bal-${difficulty}`, name: "Balance", seed });
  state.phase = "orders";
  state.settings.difficulty = difficulty;
  state.settings.jumpDays = 30;
  state.players = [{ id: "p1", name: "Observer", country: "FRA", isHost: true, connected: true, ready: true }];
  const deps = { map, seed, ai: new MockProvider() };
  const start = stats(state);
  let applied = 0, rejected = 0, maxWars = start.wars;
  const reasons = new Map<string, number>();
  const t0 = performance.now();
  for (let i = 0; i < TURNS; i++) {
    const res = await engine.runTurn(state, deps);
    for (const e of res.events) {
      applied += e.effects.length;
      for (const r of e.rejected ?? []) {
        rejected++;
        const k = `${r.effect.type}: ${category(r.reason)}`;
        reasons.set(k, (reasons.get(k) ?? 0) + 1);
      }
    }
    maxWars = Math.max(maxWars, state.wars.length);
  }
  const end = stats(state);
  const years = (Date.parse(state.date) - Date.parse(seed.date)) / (365.25 * 86400000);
  const gdpGrowth = (Math.pow(end.gdp / start.gdp, 1 / years) - 1) * 100;
  const popGrowth = (Math.pow(end.pop / start.pop, 1 / years) - 1) * 100;

  console.log(`\n== ${difficulty}: ${TURNS} turns, ${seed.date} → ${state.date} (${f1(years)} y, ${((performance.now() - t0) / 1000).toFixed(1)}s)`);
  console.log(`  world GDP     ${f1(start.gdp / 1000)}T → ${f1(end.gdp / 1000)}T  (${f1(gdpGrowth)}%/yr)`);
  console.log(`  population    ${f1(start.pop)}M → ${f1(end.pop)}M  (${popGrowth.toFixed(2)}%/yr)`);
  console.log(`  stability     mean ${f1(start.stabMean)} → ${f1(end.stabMean)}, min ${f1(start.stabMin)} → ${f1(end.stabMin)}, below 20: ${start.collapsed} → ${end.collapsed}`);
  console.log(`  war exhaust.  mean ${f1(start.weMean)} → ${f1(end.weMean)}, max ${f1(start.weMax)} → ${f1(end.weMax)}`);
  console.log(`  wars          ${start.wars} → ${end.wars} (max ${maxWars})`);
  console.log(`  occupied      ${start.occupied} → ${end.occupied} regions`);
  console.log(`  alive         ${start.alive} → ${end.alive} countries`);
  console.log(`  effects       ${applied} applied, ${rejected} rejected`);
  for (const [k, n] of [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${String(n).padStart(4)}× ${k}`);

  if (gdpGrowth < 1 || gdpGrowth > 4) warnings.push(`${difficulty}: world GDP growth ${f1(gdpGrowth)}%/yr outside 1–4%`);
  if (end.stabMean < 35) warnings.push(`${difficulty}: mean stability collapsed to ${f1(end.stabMean)}`);
  if (end.collapsed > end.alive / 4) warnings.push(`${difficulty}: ${end.collapsed} countries below stability 20`);
  if (end.weMax >= 95) warnings.push(`${difficulty}: war exhaustion pinned at ${f1(end.weMax)}`);
  if (end.alive < start.alive - 5) warnings.push(`${difficulty}: ${start.alive - end.alive} countries disappeared`);
}

console.log(warnings.length ? `\nWARNINGS:\n${warnings.map((w) => `  - ${w}`).join("\n")}` : "\nAll metrics within plausible ranges.");
process.exit(warnings.length ? 1 : 0);
