// Picks the AI provider: OpenRouter when an API key is configured, otherwise the offline mock.

import type { AiProvider } from "../engine/api.ts";
import { MockProvider } from "./mock.ts";
import { OpenRouterProvider } from "./openrouter.ts";

export function createProvider(): AiProvider {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  // WORLDLINE_AI=mock forces the offline mock even when a key is in .env (tests, demos).
  if (key && process.env.WORLDLINE_AI !== "mock") {
    const limit = Number(process.env.OPENROUTER_DAILY_LIMIT);
    const dailyLimit = Number.isFinite(limit) && limit > 0 ? limit : 50;
    console.log(`[ai] using OpenRouter (daily limit ${dailyLimit} requests)`);
    return new OpenRouterProvider(key, { dailyLimit });
  }
  console.log("[ai] OPENROUTER_API_KEY not set; using the offline mock provider");
  return new MockProvider();
}

export { MockProvider, OpenRouterProvider };
