// Room turn flow in-process: fake sockets, a mock AI slowed down per request kind, and an
// in-memory database, so races between messages and a resolving turn are reproducible.
import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildMapIndex, type MapMeta, type ServerMessage, type TurnResult } from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import type { AiProvider, AiRequest } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";
import { buildFixtureSeed, ROOT } from "./fixtures/seed.ts";

process.env.WORLDLINE_DB = ":memory:";
const { Room } = await import("../src/rooms.ts");

const map = buildMapIndex((await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta);
const seed = await buildFixtureSeed();

function slowAi(delays: Partial<Record<AiRequest["kind"], number>>): AiProvider {
  const mock = new MockProvider();
  return {
    name: "mock",
    quota: () => mock.quota(),
    complete: async (req) => {
      await Bun.sleep(delays[req.kind] ?? 0);
      return mock.complete(req);
    },
  };
}

type FakeSocket = { data: { gameId?: string; playerId?: string }; got: ServerMessage[]; send(text: string): void };
const socket = (): FakeSocket => ({ data: {}, got: [], send(text) { this.got.push(JSON.parse(text)); } });

/** A started game with players A (FRA) and B (DEU), both connected. */
async function startedRoom(ai: AiProvider) {
  const room = new Room(engine.createGame({ id: `r${Math.random().toString(36).slice(2, 8)}`, name: "Rooms", seed }), { map, ai, seed: () => seed });
  const a = socket(), b = socket();
  room.join(a as never, { t: "join", gameId: room.state.id, name: "A" });
  room.join(b as never, { t: "join", gameId: room.state.id, name: "B" });
  await room.handle(a as never, { t: "claim", tag: "FRA" });
  await room.handle(b as never, { t: "claim", tag: "DEU" });
  await room.handle(a as never, { t: "start" });
  return { room, a, b };
}

async function until(cond: () => boolean, ms = 5000) {
  for (const end = Date.now() + ms; !cond(); await Bun.sleep(10)) if (Date.now() > end) throw new Error("timed out");
}

const turnOf = (s: FakeSocket) => (s.got.find((m) => m.t === "turn") as { result: TurnResult } | undefined)?.result;

test("orders sent just before 'ready' land even while another player's chat holds the queue", async () => {
  const { room, a, b } = await startedRoom(slowAi({ chat: 300 }));
  await room.handle(b as never, { t: "chat.open", with: ["ITA"] });
  void room.handle(b as never, { t: "chat.send", chatId: room.state.chats[0].id, text: "Hello, Rome." });
  await room.handle(b as never, { t: "ready", ready: true });
  // What the client's End Turn sends: the order list, then ready.
  void room.handle(a as never, { t: "orders", orders: [{ id: "late", text: "Build a high-speed line to Madrid." }] });
  void room.handle(a as never, { t: "ready", ready: true });
  await until(() => !!turnOf(a));
  expect(turnOf(a)!.verdicts.map((v) => v.orderId)).toEqual(["late"]);
  expect(a.got.filter((m) => m.t === "error")).toEqual([]);
});

test("un-readying while the turn waits for a chat calls the turn off", async () => {
  const { room, a, b } = await startedRoom(slowAi({ chat: 300 }));
  await room.handle(b as never, { t: "chat.open", with: ["ITA"] });
  void room.handle(b as never, { t: "chat.send", chatId: room.state.chats[0].id, text: "Hello, Rome." });
  await room.handle(b as never, { t: "ready", ready: true });
  await room.handle(a as never, { t: "ready", ready: true });
  await room.handle(a as never, { t: "ready", ready: false });
  await until(() => room.state.chats[0].messages.length === 2);
  await Bun.sleep(50);
  expect(room.state.turn).toBe(1);
  expect(room.resolving).toBe(false);
});

test("a player who leaves while the turn resolves is not left 'connected', so the game goes on", async () => {
  const { room, a, b } = await startedRoom(slowAi({ resolver: 200 }));
  await room.handle(b as never, { t: "ready", ready: true });
  await room.handle(a as never, { t: "ready", ready: true });
  await until(() => room.state.phase === "resolving");
  room.leave(b as never);
  const late = socket();
  room.join(late as never, { t: "join", gameId: room.state.id, name: "Latecomer" });
  await until(() => room.state.turn === 2 && !room.resolving);
  expect(room.state.players.find((p) => p.name === "B")?.connected).toBe(false);
  expect(room.state.players.some((p) => p.name === "Latecomer")).toBe(true);
  // With B gone, A alone decides the next turn.
  await room.handle(a as never, { t: "ready", ready: true });
  await until(() => room.state.turn === 3);
});

test("a timed turn waits for someone to play it, and the timer restarts when they come back", async () => {
  const { room, a, b } = await startedRoom(slowAi({}));
  room.leave(a as never);
  room.leave(b as never);
  room.state.settings.turnTimer = 120;
  room.state.turnDeadline = Date.now() - 1000;
  room.tick();
  await Bun.sleep(50);
  expect(room.state.turn).toBe(1);
  const back = socket();
  room.join(back as never, { t: "join", gameId: room.state.id, name: "A", playerId: a.data.playerId, secret: room.state.players[0].secret });
  expect(room.state.turnDeadline).toBeGreaterThan(Date.now() + 100_000);
  room.tick();
  await Bun.sleep(50);
  expect(room.state.turn).toBe(1);
});

test("after the lobby a nation can't be dropped or swapped, unless it no longer exists", async () => {
  const { room, a, b } = await startedRoom(slowAi({}));
  for (const tag of [null, "ITA"]) {
    await room.handle(a as never, { t: "claim", tag });
    expect((a.got.at(-1) as { message?: string }).message).toBe("You can only change country in the lobby.");
  }
  expect(room.state.players[0].country).toBe("FRA");
  // A spectator joining mid-game may take a nation nobody leads.
  const late = socket();
  room.join(late as never, { t: "join", gameId: room.state.id, name: "Latecomer" });
  await room.handle(late as never, { t: "claim", tag: "ESP" });
  expect(room.state.players.find((p) => p.name === "Latecomer")?.country).toBe("ESP");
  // A player whose nation was destroyed no longer holds up the turn, and may lead another.
  room.state.countries.find((c) => c.tag === "FRA")!.alive = false;
  await room.handle(late as never, { t: "ready", ready: true });
  await room.handle(b as never, { t: "ready", ready: true });
  await until(() => room.state.turn === 2 && !room.resolving);
  await room.handle(a as never, { t: "claim", tag: "ITA" });
  expect(room.state.players[0].country).toBe("ITA");
});
