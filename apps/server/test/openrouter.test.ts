// The OpenRouter client against a stubbed fetch: no network, no credits spent.
import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenRouterProvider } from "../src/ai/openrouter.ts";
import type { AiRequest } from "../src/engine/api.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const req: AiRequest = { kind: "chat", system: "s", user: "u", maxTokens: 50 };
const chain = ["free/a:free", "free/b:free", "free/c:free", "paid/d"];
const usageFile = () => join(tmpdir(), `wl-usage-${crypto.randomUUID()}.json`);

function stub(handler: (body: any) => { status: number; json: unknown }) {
  const bodies: any[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    const r = handler(body);
    return new Response(JSON.stringify(r.json), { status: r.status });
  }) as typeof fetch;
  return bodies;
}

test("chains longer than 3 are sent in batches of at most 3, falling back between batches", async () => {
  const bodies = stub((b) =>
    b.models.includes("paid/d")
      ? { status: 200, json: { model: "paid/d", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 5, completion_tokens: 1 } } }
      : { status: 400, json: { error: { code: 400, message: "all free providers rejected the request" } } },
  );
  const ai = new OpenRouterProvider("key", { usageFile: usageFile() });
  const res = await ai.complete(req, { modelChain: chain, reasoningEffort: "none" });
  expect(res.text).toBe("ok");
  expect(res.usage.model).toBe("paid/d");
  expect(bodies.every((b) => b.models.length <= 3)).toBe(true);
  expect(bodies[0].models).toEqual(["free/a:free", "free/b:free", "free/c:free"]);
  expect(bodies.at(-1).models).toEqual(["paid/d"]);
  // Reasoning is switched off explicitly, since some models think by default.
  expect(bodies[0].reasoning).toEqual({ enabled: false });
});

test("a successful first batch never touches the paid model", async () => {
  const bodies = stub(() => ({ status: 200, json: { model: "free/a:free", choices: [{ message: { content: "hi" } }], usage: {} } }));
  const ai = new OpenRouterProvider("key", { usageFile: usageFile() });
  await ai.complete(req, { modelChain: chain, reasoningEffort: "none" });
  expect(bodies).toHaveLength(1);
  expect(bodies[0].models).not.toContain("paid/d");
});

test("no local cap by default; an explicit cap blocks with a clear message", async () => {
  stub(() => ({ status: 200, json: { model: "free/a:free", choices: [{ message: { content: "hi" } }], usage: {} } }));
  const open = new OpenRouterProvider("key", { usageFile: usageFile() });
  for (let i = 0; i < 3; i++) await open.complete(req, { modelChain: chain, reasoningEffort: "none" });
  expect(open.quota()).toEqual({ usedToday: 3, dailyLimit: 0 });

  const capped = new OpenRouterProvider("key", { usageFile: usageFile(), dailyLimit: 1 });
  await capped.complete(req, { modelChain: chain, reasoningEffort: "none" });
  await expect(capped.complete(req, { modelChain: chain, reasoningEffort: "none" })).rejects.toThrow(/Daily OpenRouter limit/);
});

test("a model that requires reasoning is retried with minimal reasoning instead of failing", async () => {
  const bodies = stub((b) =>
    b.reasoning?.enabled === false
      ? { status: 400, json: { error: { code: 400, message: "Reasoning is mandatory for this endpoint and cannot be disabled." } } }
      : { status: 200, json: { model: "minimax/minimax-m3.1-flash:free", choices: [{ message: { content: "ok" } }], usage: {} } },
  );
  const ai = new OpenRouterProvider("key", { usageFile: usageFile() });
  const res = await ai.complete(req, { modelChain: ["other/thinker:free"], reasoningEffort: "none" });
  expect(res.text).toBe("ok");
  expect(bodies).toHaveLength(2);
  expect(bodies[1].reasoning).toEqual({ effort: "low", exclude: true });
  // Remembered: the next call goes straight to minimal reasoning, no wasted request.
  await ai.complete(req, { modelChain: ["other/thinker:free"], reasoningEffort: "none" });
  expect(bodies).toHaveLength(3);
  expect(bodies[2].reasoning).toEqual({ effort: "low", exclude: true });
});
