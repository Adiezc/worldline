// Picks the AI provider: a router over every backend with a key configured (OpenRouter, Anthropic,
// OpenAI, Gemini, a local OpenAI-compatible server), or the offline mock when there is none.

import type { AiCallInfo, AiProvider } from "../engine/api.ts";
import { AnthropicBackend } from "./anthropic.ts";
import { COMPAT_URLS, CompatBackend } from "./compat.ts";
import { MockProvider } from "./mock.ts";
import { OpenRouterProvider } from "./openrouter.ts";
import { RouterProvider, type RouterBackends } from "./router.ts";

/** One line per AI call in the server terminal, so slow or failing models are visible. */
function logCall(c: AiCallInfo) {
  const line = `[${new Date().toTimeString().slice(0, 8)}] [ai] ${c.kind} ${c.ok ? "ok" : "FAILED"} ${c.model} ${(c.latencyMs / 1000).toFixed(1)}s ` +
    `in=${c.promptTokens}${c.cachedTokens ? ` (cached ${c.cachedTokens})` : ""} out=${c.completionTokens}${c.attempts > 1 ? ` attempts=${c.attempts}` : ""}${c.error ? ` | ${c.error}` : ""}`;
  if (c.ok) console.log(line);
  else console.error(line);
}

export function createProvider(): AiProvider {
  const env = (k: string) => process.env[k]?.trim() || undefined;
  // WORLDLINE_AI=mock forces the offline mock even when keys are in .env (tests, demos).
  if (env("WORLDLINE_AI") === "mock") {
    console.log("[ai] WORLDLINE_AI=mock; using the offline mock provider");
    return new MockProvider();
  }

  const backends: RouterBackends = {};
  const defaults: string[] = [];
  const orKey = env("OPENROUTER_API_KEY");
  if (orKey) {
    const limit = Number(process.env.OPENROUTER_DAILY_LIMIT);
    // Optional local cap; by default only OpenRouter's own limits apply.
    const dailyLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
    backends.openrouter = new OpenRouterProvider(orKey, { dailyLimit, onCall: logCall });
    console.log(`[ai] OpenRouter (${dailyLimit ? `local cap ${dailyLimit} requests/day` : "no local cap"})`);
  }
  const anthropicKey = env("ANTHROPIC_API_KEY");
  if (anthropicKey) {
    backends.anthropic = new AnthropicBackend(anthropicKey);
    defaults.push(`anthropic:${env("ANTHROPIC_MODEL") ?? "claude-opus-5-5"}`);
  }
  for (const id of ["openai", "gemini"] as const) {
    const key = env(`${id.toUpperCase()}_API_KEY`);
    if (!key) continue;
    backends[id] = new CompatBackend({ id, baseUrl: COMPAT_URLS[id], apiKey: key });
    const model = env(`${id.toUpperCase()}_MODEL`);
    if (model) defaults.push(`${id}:${model}`);
  }
  const localUrl = env("LOCAL_LLM_URL");
  if (localUrl) {
    backends.local = new CompatBackend({ id: "local", baseUrl: localUrl, apiKey: env("LOCAL_LLM_KEY") });
    const model = env("LOCAL_LLM_MODEL");
    if (model) defaults.push(`local:${model}`);
  }

  const router = new RouterProvider(backends, { defaults, onCall: logCall });
  if (!router.configured.length) {
    console.log("[ai] no AI key set (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY or LOCAL_LLM_URL); using the offline mock provider");
    return new MockProvider();
  }
  console.log(`[ai] backends: ${router.configured.join(", ")}${defaults.length ? `; fallback models: ${defaults.join(", ")}` : ""}`);
  return router;
}

export { MockProvider, OpenRouterProvider, RouterProvider };
