// Picks the AI provider: OpenRouter when an API key is configured, otherwise the offline mock.

import type { AiProvider } from "../engine/api.ts";
import { MockProvider } from "./mock.ts";
import { OpenRouterProvider } from "./openrouter.ts";

export function createProvider(): AiProvider {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  // WORLDLINE_AI=mock forces the offline mock even when a key is in .env (tests, demos).
  if (key && process.env.WORLDLINE_AI !== "mock") {
    const limit = Number(process.env.OPENROUTER_DAILY_LIMIT);
    // Optional local cap; by default only OpenRouter's own limits apply.
    const dailyLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
    console.log(`[ai] using OpenRouter (${dailyLimit ? `local cap ${dailyLimit} requests/day` : "no local cap"})`);
    return new OpenRouterProvider(key, {
      dailyLimit,
      // One line per AI call in the server terminal, so slow or failing models are visible.
      onCall: (c) => {
        const line = `[${new Date().toTimeString().slice(0, 8)}] [ai] ${c.kind} ${c.ok ? "ok" : "FAILED"} ${c.model} ${(c.latencyMs / 1000).toFixed(1)}s ` +
          `in=${c.promptTokens} out=${c.completionTokens}${c.attempts > 1 ? ` attempts=${c.attempts}` : ""}${c.error ? ` | ${c.error}` : ""}`;
        if (c.ok) console.log(line);
        else console.error(line);
      },
    });
  }
  console.log("[ai] OPENROUTER_API_KEY not set; using the offline mock provider");
  return new MockProvider();
}

export { MockProvider, OpenRouterProvider };
