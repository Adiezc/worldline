// Live-AI smoke test: one real turn (director, votes, resolver, consolidation if due), a chat
// message to Germany, an advisor briefing and a formation assessment through OpenRouter, printing
// what each call cost and what the validator did with the output.
//
//   OPENROUTER_API_KEY=... bun run ai:smoke
//   WORLDLINE_MODELS="model-a,model-b"  optional model chain override
//
// Exit codes: 0 ok, 1 a step failed, 2 no API key.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildMapIndex, DEFAULT_SETTINGS, type GameState, type MapMeta, type ScenarioSeed } from "@worldline/shared";
import { OpenRouterProvider } from "../src/ai/openrouter.ts";
import type { AiCallInfo, EngineDeps } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";

const key = process.env.OPENROUTER_API_KEY?.trim();
if (!key) {
  console.error("OPENROUTER_API_KEY is not set. This smoke test calls the real OpenRouter API; export the key and run again.");
  process.exit(2);
}

const ROOT = join(import.meta.dir, "..", "..", "..");
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const seed = JSON.parse(readFileSync(join(ROOT, "packages/scenarios/modern-2026/seed.json"), "utf8")) as ScenarioSeed;
const map = buildMapIndex(meta);

const limit = Number(process.env.OPENROUTER_DAILY_LIMIT);
const pad = (s: string | number, n: number) => String(s).padEnd(n);
const printCall = (c: AiCallInfo) =>
  console.log(
    `  [call] ${pad(c.kind, 13)} ${pad(c.ok ? c.model : "FAILED", 44)} ${pad(`${(c.latencyMs / 1000).toFixed(1)}s`, 7)} ` +
    `in ${pad(c.promptTokens, 6)} out ${pad(c.completionTokens, 6)}${c.attempts > 1 ? ` (${c.attempts} attempts)` : ""}` +
    (c.error ? `\n         ${c.error}` : ""),
  );
const ai = new OpenRouterProvider(key, { dailyLimit: Number.isFinite(limit) && limit > 0 ? limit : 50, onCall: printCall });

const validation: string[] = [];
const deps: EngineDeps = {
  map, seed, ai,
  onProgress: (stage) => console.log(`  … ${stage}`),
  onValidation: (e) => {
    const line = `${e.kind}: ${e.outcome}${e.error ? ` (${e.error})` : ""}`;
    validation.push(line);
    console.log(`  [validation] ${line}`);
  },
};

const state: GameState = engine.createGame({ id: "smoke", name: "AI smoke test", seed });
state.phase = "orders";
state.players = [{ id: "p1", name: "Smoke", country: "FRA", isHost: true, connected: true, ready: true }];
const models = process.env.WORLDLINE_MODELS?.split(",").map((m) => m.trim()).filter(Boolean);
state.settings.modelChain = models?.length ? models : DEFAULT_SETTINGS.modelChain;
state.orders = {
  p1: [{
    id: "o1", playerId: "p1", country: "FRA",
    text: "Propose to Germany a joint Franco-German air-defence programme, co-funded 50/50, with a summit in Paris this month.",
  }],
};

console.log(`Worldline AI smoke test: ${seed.name}, ${seed.date}, playing France`);
console.log(`Models: ${state.settings.modelChain.join(" → ")} · reasoning ${state.settings.reasoningEffort}`);
console.log(`Quota: ${ai.quota().usedToday}/${ai.quota().dailyLimit} requests used today\n`);

const failures: string[] = [];
async function step(name: string, fn: () => Promise<void>) {
  console.log(`== ${name}`);
  const t0 = performance.now();
  try {
    await fn();
    console.log(`   ok in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);
  } catch (err) {
    failures.push(name);
    console.log(`   FAILED: ${err instanceof Error ? err.message : err}\n`);
  }
}

await step("turn", async () => {
  const res = await engine.runTurn(state, deps);
  console.log(`  ${res.fromDate} → ${res.toDate}: ${res.events.length} events, ${res.votes.length} votes`);
  for (const e of res.events) console.log(`   ${e.date} ${e.scope === "player" ? "*" : " "} ${e.headline}${e.mapDiff?.length ? ` [map: ${e.mapDiff.length}]` : ""}`);
  console.log("  verdicts:");
  for (const v of res.verdicts) console.log(`   ${v.orderId} ${v.outcome.toUpperCase()}: ${v.reason}`);
  const rejected = res.events.flatMap((e) => e.rejected ?? []);
  const applied = res.events.reduce((n, e) => n + e.effects.length, 0);
  console.log(`  effects: ${applied} applied, ${rejected.length} rejected`);
  const reasons = new Map<string, number>();
  for (const r of rejected) reasons.set(`${r.effect.type}: ${r.reason}`, (reasons.get(`${r.effect.type}: ${r.reason}`) ?? 0) + 1);
  for (const [reason, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`   ${n}× ${reason}`);
  if (!res.events.length) throw new Error("the turn produced no events");
  if (!res.verdicts.some((v) => v.orderId === "o1")) throw new Error("the order got no verdict");
});

await step("chat with Germany", async () => {
  const chatId = engine.openChat(state, { from: "FRA", with: ["DEU"] });
  await engine.sendChat(state, deps, { chatId, playerId: "p1", text: "Berlin, are you ready to co-fund a European air shield with us?" });
  const reply = state.chats.find((c) => c.id === chatId)!.messages.at(-1)!;
  if (reply.from !== "DEU") throw new Error("Germany did not reply");
  console.log(`  DEU: ${reply.text}${reply.proposal ? `\n  proposal: ${reply.proposal.kind} ${reply.proposal.treatyType ?? ""} – ${reply.proposal.terms}` : ""}`);
});

await step("advisor", async () => {
  const text = await engine.advisor(state, deps, { country: "FRA", question: "What should we prioritise next month?" });
  console.log(text.split("\n").map((l) => `  ${l}`).join("\n"));
  if (text.length < 40) throw new Error("briefing suspiciously short");
});

await step("formation assessment", async () => {
  const goal = await engine.assessFormation(state, deps, {
    founder: "FRA",
    request: {
      name: "Carolingian Union", concept: "A federal union of France and the Benelux states.",
      countries: ["BEL", "LUX"], color: "#2b4c9a", government: "Federal republic",
    },
  });
  console.log(`  verdict: ${goal.verdict}`);
  for (const r of goal.requirements) console.log(`   [${r.met ? "x" : " "}] ${r.text} – ${r.why}`);
  for (const c of goal.consent) console.log(`   consent ${c.country}: ${c.willing === null ? "?" : c.willing ? "willing" : "unwilling"}`);
  console.log(`  path: ${goal.suggestedPath}`);
});

const calls = ai.log;
const tokens = calls.reduce((a, c) => ({ p: a.p + c.promptTokens, c: a.c + c.completionTokens }), { p: 0, c: 0 });
console.log("== summary");
console.log(`  ${calls.length} calls (${calls.filter((c) => !c.ok).length} failed), ${tokens.p} prompt + ${tokens.c} completion tokens`);
console.log(`  models: ${[...new Set(calls.filter((c) => c.ok).map((c) => c.model))].join(", ") || "none"}`);
console.log(`  validation: ${validation.length ? validation.join("; ") : "all outputs valid on the first try"}`);
console.log(`  quota now ${ai.quota().usedToday}/${ai.quota().dailyLimit}`);
if (failures.length) {
  console.log(`  FAILED steps: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("  all steps passed");
