// OpenRouter chat-completions client: a 20 requests/minute limiter, retries for 429/5xx, model
// fallback in batches (OpenRouter's `models` array takes at most 3), and a persisted daily counter
// that drives the usage meter. The counter only blocks when OPENROUTER_DAILY_LIMIT is set > 0;
// OpenRouter enforces its own free-model cap (50/day, 1000/day with credits) either way.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AiCallInfo, AiProvider, AiRequest, AiResponse } from "../engine/api.ts";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const PER_MINUTE = 20;
const MAX_RETRIES = 2;
const DEFAULT_USAGE_FILE = join(import.meta.dir, "..", "..", "data", "usage.json");
const LOG_SIZE = 200;
/** OpenRouter rejects a `models` array longer than this. */
const MAX_MODELS_PER_REQUEST = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

/** Requests per UTC day, persisted as {"2026-10-19": 12, ...}. */
class DailyCounter {
  private counts: Record<string, number> = {};

  /** `limit` 0 = count only, never block. */
  constructor(private file: string, readonly limit: number) {
    try {
      if (existsSync(file)) this.counts = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      this.counts = {};
    }
  }

  used() {
    return this.counts[today()] ?? 0;
  }

  take() {
    const day = today();
    if (this.limit > 0 && this.used() >= this.limit) {
      throw new Error(
        `Daily OpenRouter limit reached (${this.limit} requests on ${day} UTC). It resets at midnight UTC; ` +
        "raise or unset OPENROUTER_DAILY_LIMIT to allow more.",
      );
    }
    this.counts[day] = this.used() + 1;
    // Keep a week of history.
    for (const d of Object.keys(this.counts).sort().slice(0, -7)) delete this.counts[d];
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.counts, null, 2));
    } catch (err) {
      console.warn(`[openrouter] could not persist usage: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Serialised sliding-window limiter: at most PER_MINUTE request starts in any 60 s. */
class MinuteLimiter {
  private starts: number[] = [];
  private queue: Promise<void> = Promise.resolve();

  acquire(): Promise<void> {
    const turn = this.queue.then(async () => {
      for (;;) {
        const now = Date.now();
        this.starts = this.starts.filter((t) => now - t < 60_000);
        if (this.starts.length < PER_MINUTE) {
          this.starts.push(now);
          return;
        }
        await sleep(60_000 - (now - this.starts[0]) + 50);
      }
    });
    this.queue = turn.catch(() => {});
    return turn;
  }
}

interface OpenRouterBody {
  model?: string;
  choices?: { message?: { content?: string | { type: string; text?: string }[] | null }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { code?: number | string; message?: string; metadata?: { raw?: string; provider_name?: string } };
}

export class OpenRouterProvider implements AiProvider {
  readonly name = "openrouter" as const;
  private daily: DailyCounter;
  private limiter = new MinuteLimiter();
  /** Most recent calls (newest last), for diagnostics such as scripts/ai-smoke.ts. */
  readonly log: AiCallInfo[] = [];
  private onCall?: (info: AiCallInfo) => void;

  constructor(private apiKey: string, opts: { dailyLimit?: number; usageFile?: string; onCall?: (info: AiCallInfo) => void } = {}) {
    this.daily = new DailyCounter(opts.usageFile ?? DEFAULT_USAGE_FILE, opts.dailyLimit ?? 0);
    this.onCall = opts.onCall;
  }

  quota() {
    return { usedToday: this.daily.used(), dailyLimit: this.daily.limit };
  }

  async complete(req: AiRequest, settings: { modelChain: string[]; reasoningEffort: string }): Promise<AiResponse> {
    const started = performance.now();
    const tries = { n: 0 };
    const record = (info: Omit<AiCallInfo, "kind" | "latencyMs" | "attempts">) => {
      const full: AiCallInfo = { kind: req.kind, latencyMs: Math.round(performance.now() - started), attempts: tries.n, ...info };
      this.log.push(full);
      if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
      this.onCall?.(full);
    };
    try {
      const res = await this.request(req, settings, tries);
      record({ model: res.usage.model, promptTokens: res.usage.promptTokens, completionTokens: res.usage.completionTokens, ok: true });
      return res;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      record({ model: settings.modelChain[0] ?? "", promptTokens: 0, completionTokens: 0, ok: false, error });
      throw err;
    }
  }

  /** Try the chain in batches of up to 3 models; OpenRouter falls back within a batch, we fall back between batches. */
  private async request(req: AiRequest, settings: { modelChain: string[]; reasoningEffort: string }, tries: { n: number }): Promise<AiResponse> {
    const chain = settings.modelChain.filter(Boolean);
    if (!chain.length) throw new Error("No model configured.");
    const errors: string[] = [];
    for (let i = 0; i < chain.length; i += MAX_MODELS_PER_REQUEST) {
      const batch = chain.slice(i, i + MAX_MODELS_PER_REQUEST);
      try {
        return await this.requestBatch(req, batch, settings.reasoningEffort, tries);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Running out of the local daily allowance is not something a later batch can fix.
        if (msg.startsWith("Daily OpenRouter limit")) throw err;
        errors.push(`${batch.join(", ")}: ${msg}`);
      }
    }
    throw new Error(errors.length > 1 ? `all models failed. ${errors.join(" | ")}` : errors[0]);
  }

  /** Models that rejected `reasoning: {enabled:false}`; they get minimal reasoning from then on. */
  private needsReasoning = new Set<string>(["minimax/minimax-m3.1-flash:free"]);

  private async requestBatch(req: AiRequest, chain: string[], reasoningEffort: string, tries: { n: number }): Promise<AiResponse> {
    let effort = (!reasoningEffort || reasoningEffort === "none") && this.needsReasoning.has(chain[0]) ? "low" : reasoningEffort;
    let useSchema = req.jsonSchema !== undefined;
    let lastError = "unknown error";

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      this.daily.take();
      tries.n++;
      await this.limiter.acquire();
      let res: Response;
      let raw: string;
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5173",
            "X-Title": "Worldline",
          },
          body: JSON.stringify(this.body(req, chain, effort, useSchema)),
          signal: AbortSignal.timeout(timeoutFor(req.kind, effort)),
        });
        // The body streams in under the same timeout, and a connection can drop mid-reply.
        raw = await res.text();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A stalled model will stall again: hand over to the next batch instead of re-waiting.
        if (/timed out|timeout|abort/i.test(msg)) throw new Error(`timed out after ${Math.round(timeoutFor(req.kind, effort) / 1000)}s`);
        lastError = `network error: ${msg}`;
        if (attempt < MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
        break;
      }

      let json: OpenRouterBody | undefined;
      try { json = JSON.parse(raw); } catch { json = undefined; }

      if (!res.ok || json?.error) {
        const status = res.ok ? Number(json?.error?.code) || 502 : res.status;
        lastError = `OpenRouter ${status}: ${describe(json, raw)}`;
        // Some models (e.g. MiniMax's free endpoint) refuse to run with reasoning disabled.
        if (status === 400 && (!effort || effort === "none") && /reasoning is mandatory|cannot be disabled/i.test(lastError)) {
          effort = "low";
          this.needsReasoning.add(chain[0]);
          attempt--;
          continue;
        }
        // Some free endpoints reject structured output; retry once asking for plain JSON.
        if (status === 400 && useSchema && /response_format|json_schema|structured/i.test(lastError)) {
          useSchema = false;
          attempt--;
          continue;
        }
        if ((status === 429 || status >= 500) && attempt < MAX_RETRIES) {
          await sleep(retryAfter(res) ?? backoff(attempt));
          continue;
        }
        throw new Error(lastError);
      }

      const choice = json?.choices?.[0];
      const content = choice?.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((p) => p.text ?? "").join("") : "";
      if (!text.trim()) {
        lastError = `OpenRouter returned an empty reply (finish_reason: ${choice?.finish_reason ?? "none"})`;
        if (attempt < MAX_RETRIES) { await sleep(backoff(attempt)); continue; }
        break;
      }
      return {
        text,
        usage: {
          model: json?.model ?? chain[0],
          promptTokens: json?.usage?.prompt_tokens ?? 0,
          completionTokens: json?.usage?.completion_tokens ?? 0,
        },
      };
    }
    throw new Error(lastError);
  }

  private body(req: AiRequest, chain: string[], effort: string, useSchema: boolean) {
    return {
      model: chain[0],
      models: chain,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      // With reasoning on, max_tokens covers the thinking too, so leave headroom for it.
      max_tokens: (req.maxTokens ?? 2000) + (REASONING_HEADROOM[effort] ?? 0),
      temperature: req.temperature ?? 0.7,
      // Some models (e.g. Nemotron) reason by default, so "none" must be sent explicitly.
      reasoning: !effort || effort === "none" ? { enabled: false } : { effort, exclude: true },
      response_format: useSchema
        ? { type: "json_schema", json_schema: { name: req.schemaName ?? "output", strict: false, schema: req.jsonSchema } }
        : undefined,
    };
  }
}

/** Free models generate slowly; the two big turn calls write thousands of tokens. */
const TIMEOUT_MS: Partial<Record<AiRequest["kind"], number>> = { resolver: 240_000, director: 180_000, votes: 120_000 };

/** Per-attempt limit; thinking models get extra time. A timeout moves on to the next models. */
function timeoutFor(kind: AiRequest["kind"], effort: string) {
  const base = TIMEOUT_MS[kind] ?? 90_000;
  const extra = effort === "high" ? 2 : effort === "medium" ? 1.5 : effort === "low" ? 1.25 : 1;
  return Math.round(base * extra);
}

const REASONING_HEADROOM: Record<string, number> = { low: 4000, medium: 8000, high: 16000 };

const backoff = (attempt: number) => 2000 * 3 ** attempt;

function retryAfter(res: Response) {
  const v = Number(res.headers.get("retry-after"));
  return Number.isFinite(v) && v > 0 ? Math.min(30, v) * 1000 : undefined;
}

function describe(json: OpenRouterBody | undefined, raw: string) {
  const e = json?.error;
  if (!e) return raw.slice(0, 300) || "no response body";
  const provider = e.metadata?.provider_name ? ` [${e.metadata.provider_name}]` : "";
  const detail = e.metadata?.raw ? ` (${String(e.metadata.raw).slice(0, 300)})` : "";
  return `${e.message ?? "error"}${provider}${detail}`;
}
