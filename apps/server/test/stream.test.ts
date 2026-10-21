// Streamed chat replies: the partial-JSON reader, the SSE reader, and the room passing a reply to
// the chat's members while it is written.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { GameView } from "@worldline/shared";
import { readSse } from "../src/ai/sse.ts";
import { partialJsonString } from "../src/engine/llm.ts";
import { Client, startServer } from "./fixtures/server.ts";

describe("partialJsonString", () => {
  test("decodes a string field as far as it has been written", () => {
    expect(partialJsonString('{"speaker":"DEU","rep', "reply")).toBeNull();
    expect(partialJsonString('{"speaker":"DEU","reply":"We welc', "reply")).toBe("We welc");
    expect(partialJsonString('{"reply":"Line one\\nsaid \\"no\\" caf\\u00e9","tone":"warm"}', "reply")).toBe('Line one\nsaid "no" café');
    // An escape cut off mid-way waits for the rest rather than showing a backslash.
    expect(partialJsonString('{"reply":"Half \\', "reply")).toBe("Half ");
    expect(partialJsonString('{"reply":"x \\u00', "reply")).toBe("x ");
    // Reasoning before the JSON is skipped, even while it is still open.
    expect(partialJsonString('<think>"reply":"no"', "reply")).toBeNull();
    expect(partialJsonString('<think>plan</think>{"reply":"Yes', "reply")).toBe("Yes");
  });
});

test("readSse folds an event stream into one reply and reports it as it grows", async () => {
  const chunks = [
    ": OPENROUTER PROCESSING\n\n",
    'data: {"model":"m1","choices":[{"delta":{"content":"{\\"rep"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"ly\\":\\"Hi"}}]}\n',
    'data: {"choices":[{"delta":{"content":"\\"}"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n',
  ];
  const body = new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
  const seen: string[] = [];
  const out = await readSse(new Response(body), (t) => seen.push(t));
  expect(out.choices[0].message.content).toBe('{"reply":"Hi"}');
  expect(out).toMatchObject({ model: "m1", usage: { prompt_tokens: 5, completion_tokens: 3 } });
  expect(out.choices[0].finish_reason).toBe("stop");
  expect(seen).toEqual(['{"rep', '{"reply":"Hi', '{"reply":"Hi"}']);
});

const PORT = 3477;
let server: Awaited<ReturnType<typeof startServer>>;
beforeAll(async () => { server = await startServer(PORT); });
afterAll(() => server.kill());

test("a chat reply streams to the chat's members before the finished message arrives", async () => {
  const created = (await (await fetch(`http://localhost:${PORT}/api/games`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Stream" }) })).json()) as { gameId: string };
  const c = await new Client(PORT).connect(created.gameId, "Ann");
  c.send({ t: "claim", tag: "GBR" });
  c.send({ t: "start" });
  await c.until((v) => v.phase === "orders");
  c.send({ t: "chat.open", with: ["DEU"] });
  const withChat = await c.until((v) => v.chats.length === 1);
  const chatId = withChat.chats[0].id;
  const streamed = c.wait((m) => m.t === "chat.stream" && m.chatId === chatId);
  c.send({ t: "chat.send", chatId, text: "Shall we talk trade?" });
  const piece = await streamed;
  expect(piece).toMatchObject({ t: "chat.stream", from: "DEU" });
  const done = await c.until((v: GameView) => (v.chats[0]?.messages.length ?? 0) >= 2);
  // What streamed is the start of the reply that landed.
  expect(done.chats[0].messages[1].text.startsWith((piece as { text: string }).text)).toBe(true);
  c.close();
});
