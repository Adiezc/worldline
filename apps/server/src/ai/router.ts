// Routes each entry of the model chain to its backend. Entries may carry a provider prefix:
//   "anthropic:claude-opus-5-5"   Anthropic Messages API        (ANTHROPIC_API_KEY)
//   "openai:<model>"              OpenAI                         (OPENAI_API_KEY)
//   "gemini:<model>"              Google Gemini                  (GEMINI_API_KEY)
//   "local:<model>"               any OpenAI-compatible server   (LOCAL_LLM_URL, e.g. Ollama)
//   "openrouter:<model>" or no prefix: OpenRouter               (OPENROUTER_API_KEY)
// The chain is tried in order across backends; an entry whose backend has no key is skipped.

import type { AiCallInfo, AiProvider, AiRequest, AiResponse } from "../engine/api.ts";
import type { AnthropicBackend } from "./anthropic.ts";
import type { CompatBackend } from "./compat.ts";
import type { OpenRouterProvider } from "./openrouter.ts";

export const BACKENDS = ["openrouter", "anthropic", "openai", "gemini", "local"] as const;
export type BackendId = (typeof BACKENDS)[number];

const PREFIX = /^(openrouter|anthropic|openai|gemini|local):(.+)$/;

export function parseModel(entry: string): { backend: BackendId; model: string } {
  const m = entry.match(PREFIX);
  return m ? { backend: m[1] as BackendId, model: m[2] } : { backend: "openrouter", model: entry };
}

interface Direct {
  complete(req: AiRequest, model: string, reasoningEffort: string): Promise<AiResponse>;
}

export interface RouterBackends {
  openrouter?: OpenRouterProvider;
  anthropic?: AnthropicBackend;
  openai?: CompatBackend;
  gemini?: CompatBackend;
  local?: CompatBackend;
}

export class RouterProvider implements AiProvider {
  readonly name = "live" as const;
  /** Requests to the direct backends today (OpenRouter keeps its own persisted counter). */
  private direct = { day: "", count: 0 };

  /**
   * `defaults`: models (with prefix) tried when nothing in a game's chain has a configured
   * backend, e.g. a game created with the OpenRouter defaults on a server with only an Anthropic key.
   */
  constructor(
    private backends: RouterBackends,
    private opts: { defaults?: string[]; onCall?: (info: AiCallInfo) => void } = {},
  ) {}

  get configured(): BackendId[] {
    return BACKENDS.filter((b) => this.backends[b]);
  }

  quota() {
    const or = this.backends.openrouter?.quota() ?? { usedToday: 0, dailyLimit: 0 };
    const today = new Date().toISOString().slice(0, 10);
    return { usedToday: or.usedToday + (this.direct.day === today ? this.direct.count : 0), dailyLimit: or.dailyLimit };
  }

  async complete(req: AiRequest, settings: { modelChain: string[]; reasoningEffort: string }): Promise<AiResponse> {
    let chain = settings.modelChain.filter(Boolean).map(parseModel);
    if (!chain.some((c) => this.backends[c.backend])) chain = (this.opts.defaults ?? []).map(parseModel);
    if (!chain.length) throw new Error("No model configured.");
    const errors: string[] = [];
    for (let i = 0; i < chain.length;) {
      const { backend } = chain[i];
      // Consecutive OpenRouter entries go together, so OpenRouter can fall back within its batch.
      let j = i + 1;
      while (backend === "openrouter" && j < chain.length && chain[j].backend === "openrouter") j++;
      const run = chain.slice(i, j).map((c) => c.model);
      i = j;
      if (!this.backends[backend]) {
        errors.push(`${backend}:${run.join(",")}: no ${backend} key configured`);
        continue;
      }
      try {
        if (backend === "openrouter") return await this.backends.openrouter!.complete(req, { modelChain: run, reasoningEffort: settings.reasoningEffort });
        return await this.timed(req, backend, run[0], this.backends[backend] as Direct, settings.reasoningEffort);
      } catch (err) {
        // Including OpenRouter's daily cap: a direct backend later in the chain may still answer.
        errors.push(`${backend}:${run.join(",")}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(errors.length > 1 ? `all models failed. ${errors.join(" | ")}` : errors[0]);
  }

  private async timed(req: AiRequest, backend: BackendId, model: string, b: Direct, effort: string): Promise<AiResponse> {
    const started = performance.now();
    const today = new Date().toISOString().slice(0, 10);
    if (this.direct.day !== today) this.direct = { day: today, count: 0 };
    this.direct.count++;
    const info = (rest: Omit<AiCallInfo, "kind" | "latencyMs" | "attempts">): AiCallInfo =>
      ({ kind: req.kind, latencyMs: Math.round(performance.now() - started), attempts: 1, ...rest });
    try {
      const res = await b.complete(req, model, effort);
      this.opts.onCall?.(info({ model: `${backend}:${res.usage.model}`, promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens, cachedTokens: res.usage.cachedTokens, ok: true }));
      return res;
    } catch (err) {
      this.opts.onCall?.(info({ model: `${backend}:${model}`, promptTokens: 0, completionTokens: 0, ok: false, error: err instanceof Error ? err.message : String(err) }));
      throw err;
    }
  }
}
