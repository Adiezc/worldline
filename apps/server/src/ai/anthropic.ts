// Direct Anthropic backend: "anthropic:<model>" entries in the model chain, through the official SDK.
// The system prompt and the stable head of the user prompt (AiRequest.cacheUpto) carry cache
// breakpoints, so the bulk of each turn's prompt is read from cache on the next turn.
//
// Output is plain JSON as the prompts ask, not `output_config.format`: the zod schemas coerce and
// transform values in ways a strict grammar can't express, and llm.ts validates and repairs anyway.

import Anthropic from "@anthropic-ai/sdk";
import type { AiRequest, AiResponse } from "../engine/api.ts";

/** Models that accept server-side refusal fallbacks; "default" routes by refusal category. */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);
/** Older models reject `effort`. */
const NO_EFFORT = /haiku-4|sonnet-4-5|claude-3/;

/**
 * The game's reasoning setting as an effort level. Current models always think, so "none" maps to
 * the cheapest level rather than switching thinking off (which they refuse).
 */
const EFFORT: Record<string, "low" | "medium" | "high"> = { none: "low", low: "low", medium: "medium", high: "high" };
/** max_tokens covers thinking too, so leave room for it on top of the answer. */
const THINKING_HEADROOM: Record<string, number> = { low: 4000, medium: 8000, high: 16000 };

export class AnthropicBackend {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2 });
  }

  async complete(req: AiRequest, model: string, reasoningEffort: string): Promise<AiResponse> {
    const effort = EFFORT[reasoningEffort] ?? "low";
    const cut = Math.max(0, Math.min(req.cacheUpto ?? 0, req.user.length));
    const user: Anthropic.Beta.BetaTextBlockParam[] = cut > 0 && cut < req.user.length
      ? [{ type: "text", text: req.user.slice(0, cut), cache_control: { type: "ephemeral" } }, { type: "text", text: req.user.slice(cut) }]
      : [{ type: "text", text: req.user }];
    const fallback = FALLBACK_MODELS.has(model);
    // Streamed so long resolver turns never hit an HTTP timeout.
    const stream = this.client.beta.messages.stream({
      model,
      max_tokens: (req.maxTokens ?? 2000) + THINKING_HEADROOM[effort],
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
      ...(NO_EFFORT.test(model) ? {} : { output_config: { effort } }),
      ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (req.onText) stream.on("text", (_delta, snapshot) => req.onText!(snapshot));
    const msg = await stream.finalMessage();

    if (msg.stop_reason === "refusal") throw new Error(`Anthropic declined the request (${msg.stop_details?.category ?? "no category"})`);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    if (!text.trim()) throw new Error(`Anthropic returned an empty reply (stop_reason: ${msg.stop_reason})`);
    const u = msg.usage;
    const cached = u.cache_read_input_tokens ?? 0;
    return {
      text,
      usage: {
        model: msg.model,
        promptTokens: u.input_tokens + cached + (u.cache_creation_input_tokens ?? 0),
        completionTokens: u.output_tokens,
        cachedTokens: cached,
      },
    };
  }
}
