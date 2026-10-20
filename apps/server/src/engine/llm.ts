// Thin layer over the AI provider: JSON extraction, zod validation, one repair round and usage
// accounting. Every engine feature talks to the model through callJson or callText.

import { jsonSchemaOf, salvageModelOutput, type GameState } from "@worldline/shared";
import type { AiRequest, AiResponse, EngineDeps } from "./api.ts";

type Schema = Parameters<typeof jsonSchemaOf>[0];
/** Output type of a zod schema (zod v4 keeps it under `_zod.output`). */
export type Out<S> = S extends { _zod: { output: infer O } } ? O : never;

export type JsonRequest = Omit<AiRequest, "jsonSchema" | "schemaName"> & { schemaName: string };
export type TextRequest = Omit<AiRequest, "jsonSchema" | "schemaName">;

/** Ask for JSON matching `schema`; one repair call on invalid output, then a clear error. */
export async function callJson<S extends Schema>(deps: EngineDeps, state: GameState, req: JsonRequest, schema: S): Promise<Out<S>> {
  const full: AiRequest = { ...req, jsonSchema: jsonSchemaOf(schema) };
  const first = await complete(deps, state, full);
  let result = parseWith(first.text, schema);
  if (result.ok) return result.value as Out<S>;
  state.usage.failures++;
  deps.onValidation?.({ kind: req.kind, outcome: "invalid", error: result.error });

  const repair: AiRequest = {
    ...full,
    user: `${req.user}\n\n---\nYour previous reply could not be used: ${result.error}\n` +
      `Previous reply (truncated):\n${first.text.slice(0, 3000)}\n\n` +
      "Return ONLY the corrected JSON object, with no prose and no code fences.",
  };
  const second = await complete(deps, state, repair);
  result = parseWith(second.text, schema);
  if (result.ok) {
    deps.onValidation?.({ kind: req.kind, outcome: "repaired", error: "" });
    return result.value as Out<S>;
  }
  state.usage.failures++;
  deps.onValidation?.({ kind: req.kind, outcome: "failed", error: result.error });
  throw new Error(`AI ${req.kind} returned unusable output twice (${result.error})`);
}

/** Plain-text completion (advisor). */
export async function callText(deps: EngineDeps, state: GameState, req: TextRequest): Promise<string> {
  const res = await complete(deps, state, req);
  const text = stripThinking(res.text).trim();
  if (!text) {
    state.usage.failures++;
    throw new Error(`AI ${req.kind} returned an empty reply`);
  }
  return text;
}

async function complete(deps: EngineDeps, state: GameState, req: AiRequest): Promise<AiResponse> {
  try {
    const res = await deps.ai.complete(req, {
      modelChain: state.settings.modelChain,
      // Thinking is slow on free models; only the calls that adjudicate (resolver, nation
      // assessments) use the host's effort, everything conversational runs without it.
      reasoningEffort: req.reasoning === "setting" ? state.settings.reasoningEffort : "none",
    });
    state.usage.requests++;
    state.usage.promptTokens += res.usage.promptTokens || 0;
    state.usage.completionTokens += res.usage.completionTokens || 0;
    if (res.usage.model) state.usage.lastModel = res.usage.model;
    return res;
  } catch (err) {
    state.usage.failures++;
    throw new Error(`AI ${req.kind} request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function parseWith(text: string, schema: Schema): { ok: true; value: unknown } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch (err) {
    return { ok: false, error: `not valid JSON (${err instanceof Error ? err.message : String(err)})` };
  }
  const dropped = salvageModelOutput(raw);
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    if (dropped.length) console.warn(`[ai] dropped ${dropped.length} malformed effect(s): ${dropped.slice(0, 4).join("; ")}`);
    return { ok: true, value: parsed.data };
  }
  const issues = parsed.error.issues.slice(0, 8).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return { ok: false, error: `schema mismatch: ${issues.join("; ")}` };
}

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "");

/** Pull the outermost JSON object out of a reply that may carry fences, prose or reasoning. */
export function extractJson(text: string): unknown {
  let s = stripThinking(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1].includes("{")) s = fence[1];
  let start = s.indexOf("{");
  if (start < 0) throw new Error("no JSON object found");
  let firstError: unknown;
  // Prose before the JSON may contain braces of its own, so try a few candidate openings.
  for (let tries = 0; start >= 0 && tries < 12; tries++, start = s.indexOf("{", start + 1)) {
    const end = matchingBrace(s, start);
    const body = s.slice(start, end < 0 ? s.lastIndexOf("}") + 1 : end + 1);
    try {
      return parseLenient(body);
    } catch (err) {
      firstError ??= err;
    }
  }
  throw firstError;
}

function parseLenient(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    // Trailing commas are the most common free-model slip.
    return JSON.parse(body.replace(/,\s*([}\]])/g, "$1"));
  }
}

function matchingBrace(s: string, start: number) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
      continue;
    }
    if (ch === "\"") inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
