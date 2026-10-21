// Model-chain routing across AI backends, with fake backends (no network).

import { expect, test } from "bun:test";
import type { AiRequest, AiResponse } from "../src/engine/api.ts";
import { parseModel, RouterProvider, type RouterBackends } from "../src/ai/router.ts";

const req: AiRequest = { kind: "chat", system: "s", user: "u" };

/** Records the models it was asked for; fails for the ones listed. */
function fake(name: string, failing: string[] = []) {
  const calls: string[] = [];
  const reply = (model: string): AiResponse => ({ text: `${name}:${model}`, usage: { model, promptTokens: 1, completionTokens: 1 } });
  return {
    calls,
    direct: {
      async complete(_r: AiRequest, model: string) {
        calls.push(model);
        if (failing.includes(model)) throw new Error(`${model} down`);
        return reply(model);
      },
    },
    openrouter: {
      quota: () => ({ usedToday: 3, dailyLimit: 50 }),
      async complete(_r: AiRequest, s: { modelChain: string[] }) {
        calls.push(s.modelChain.join(","));
        if (s.modelChain.every((m) => failing.includes(m))) throw new Error("batch down");
        return reply(s.modelChain[0]);
      },
    },
  };
}

const settings = (modelChain: string[]) => ({ modelChain, reasoningEffort: "none" });

test("parseModel reads provider prefixes and leaves OpenRouter ids alone", () => {
  expect(parseModel("anthropic:claude-opus-5-5")).toEqual({ backend: "anthropic", model: "claude-opus-5-5" });
  expect(parseModel("local:llama3.1:8b")).toEqual({ backend: "local", model: "llama3.1:8b" });
  expect(parseModel("minimax/minimax-m3.1-flash:free")).toEqual({ backend: "openrouter", model: "minimax/minimax-m3.1-flash:free" });
});

test("the chain falls through backends in order, batching consecutive OpenRouter models", async () => {
  const or = fake("or", ["a/x", "b/y"]);
  const an = fake("an", ["claude-sonnet-5-5"]);
  const loc = fake("loc");
  const router = new RouterProvider({ openrouter: or.openrouter, anthropic: an.direct, local: loc.direct } as unknown as RouterBackends);
  const res = await router.complete(req, settings(["a/x", "b/y", "anthropic:claude-sonnet-5-5", "local:qwen"]));
  expect(res.text).toBe("loc:qwen");
  expect(or.calls).toEqual(["a/x,b/y"]);
  expect(an.calls).toEqual(["claude-sonnet-5-5"]);
  expect(router.configured).toEqual(["openrouter", "anthropic", "local"]);
  // OpenRouter's quota plus the direct calls made today.
  expect(router.quota()).toEqual({ usedToday: 5, dailyLimit: 50 });
});

test("entries without a configured backend are skipped, and the server defaults stand in when none is usable", async () => {
  const an = fake("an");
  const router = new RouterProvider({ anthropic: an.direct } as unknown as RouterBackends, { defaults: ["anthropic:claude-opus-5-5"] });
  expect((await router.complete(req, settings(["openai:gpt", "anthropic:claude-haiku-5-5"]))).text).toBe("an:claude-haiku-5-5");
  // A game created with the OpenRouter defaults on a server with only an Anthropic key.
  expect((await router.complete(req, settings(["minimax/minimax-m3.1-flash:free"]))).text).toBe("an:claude-opus-5-5");
});

test("OpenRouter's daily cap falls through to a direct backend later in the chain", async () => {
  const an = fake("an");
  const capped = {
    quota: () => ({ usedToday: 50, dailyLimit: 50 }),
    complete: async () => { throw new Error("Daily OpenRouter limit reached (50 requests on 2026-10-19 UTC)."); },
  };
  const router = new RouterProvider({ openrouter: capped, anthropic: an.direct } as unknown as RouterBackends);
  expect((await router.complete(req, settings(["a/x", "anthropic:claude-opus-5-5"]))).text).toBe("an:claude-opus-5-5");
});

test("when every model fails the error names each one", async () => {
  const an = fake("an", ["claude-opus-5-5"]);
  const router = new RouterProvider({ anthropic: an.direct } as unknown as RouterBackends);
  await expect(router.complete(req, settings(["anthropic:claude-opus-5-5", "gemini:flash"]))).rejects.toThrow(/claude-opus-5-5 down.*no gemini key/);
});
