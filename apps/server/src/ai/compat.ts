// OpenAI-compatible chat-completions backend for the direct providers: OpenAI ("openai:<model>"),
// Google Gemini through its OpenAI-compatible endpoint ("gemini:<model>") and local servers such as
// Ollama, LM Studio, llama.cpp or vLLM ("local:<model>"). These cache prompt prefixes on their own,
// which is why the turn prompts put their stable parts first.

import type { AiRequest, AiResponse } from "../engine/api.ts";

export type CompatId = "openai" | "gemini" | "local";

export interface CompatConfig {
  id: CompatId;
  /** Base URL up to and including the version, e.g. http://localhost:11434/v1 */
  baseUrl: string;
  apiKey?: string;
}

export const COMPAT_URLS: Record<Exclude<CompatId, "local">, string> = {
  openai: "https://api.openai.com/v1",
  gemini: "https://generativelanguage.googleapis.com/v1beta/openai",
};

const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface CompatBody {
  model?: string;
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  error?: { message?: string } | string;
}

export class CompatBackend {
  constructor(readonly cfg: CompatConfig) {}

  async complete(req: AiRequest, model: string, reasoningEffort: string): Promise<AiResponse> {
    let jsonMode = req.jsonSchema !== undefined;
    let lastError = "unknown error";
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      let res: Response;
      try {
        res = await fetch(`${this.cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}) },
          body: JSON.stringify(this.body(req, model, reasoningEffort, jsonMode)),
          // Local models on a laptop can take minutes for a full turn.
          signal: AbortSignal.timeout(this.cfg.id === "local" ? 600_000 : 300_000),
        });
      } catch (err) {
        lastError = `network error: ${err instanceof Error ? err.message : String(err)}`;
        if (attempt < MAX_RETRIES) { await sleep(2000 * 3 ** attempt); continue; }
        break;
      }
      const raw = await res.text();
      let json: CompatBody | undefined;
      try { json = JSON.parse(raw); } catch { json = undefined; }
      if (!res.ok) {
        const msg = typeof json?.error === "string" ? json.error : json?.error?.message ?? raw.slice(0, 300);
        lastError = `${this.cfg.id} ${res.status}: ${msg}`;
        // Not every server speaks JSON mode; the prompts ask for JSON anyway.
        if (res.status === 400 && jsonMode && /response_format|json/i.test(msg)) { jsonMode = false; attempt--; continue; }
        if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) { await sleep(2000 * 3 ** attempt); continue; }
        throw new Error(lastError);
      }
      const text = json?.choices?.[0]?.message?.content ?? "";
      if (!text.trim()) {
        lastError = `${this.cfg.id} returned an empty reply (finish_reason: ${json?.choices?.[0]?.finish_reason ?? "none"})`;
        if (attempt < MAX_RETRIES) continue;
        break;
      }
      return {
        text,
        usage: {
          model: json?.model ?? model,
          promptTokens: json?.usage?.prompt_tokens ?? 0,
          completionTokens: json?.usage?.completion_tokens ?? 0,
          cachedTokens: json?.usage?.prompt_tokens_details?.cached_tokens,
        },
      };
    }
    throw new Error(lastError);
  }

  private body(req: AiRequest, model: string, effort: string, jsonMode: boolean) {
    const thinking = !!effort && effort !== "none";
    const base = {
      model,
      messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }],
      response_format: jsonMode ? { type: "json_object" } : undefined,
    };
    const tokens = (req.maxTokens ?? 2000) + (thinking ? 8000 : 0);
    // OpenAI's reasoning models take max_completion_tokens and only the default temperature.
    if (this.cfg.id === "openai") return { ...base, max_completion_tokens: tokens, ...(thinking ? { reasoning_effort: effort } : {}) };
    if (this.cfg.id === "gemini") return { ...base, max_tokens: tokens, temperature: req.temperature ?? 0.7, ...(thinking ? { reasoning_effort: effort } : {}) };
    return { ...base, max_tokens: req.maxTokens ?? 2000, temperature: req.temperature ?? 0.7 };
  }
}
