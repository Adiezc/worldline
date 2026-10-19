// End-to-end: real server process, two WebSocket players, mock AI, in-memory database.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { join } from "node:path";
import type { ClientMessage, GameView, ServerMessage, TurnResult } from "@worldline/shared";

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  const env: Record<string, string> = { ...process.env, PORT: String(PORT), WORLDLINE_DB: ":memory:" } as Record<string, string>;
  delete env.OPENROUTER_API_KEY; // always the mock provider in tests
  proc = Bun.spawn(["bun", join(import.meta.dir, "..", "src", "index.ts")], { env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {}
    await Bun.sleep(100);
  }
  throw new Error("server did not start");
});

afterAll(() => proc?.kill());

class Client {
  ws!: WebSocket;
  view!: GameView;
  playerId = "";
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  async connect(gameId: string, name: string, playerId?: string) {
    this.ws = new WebSocket(`ws://localhost:${PORT}/ws`);
    await new Promise((r) => (this.ws.onopen = r));
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === "welcome") { this.view = msg.view; this.playerId = msg.playerId; }
      if (msg.t === "view") this.view = msg.view;
      this.inbox.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    };
    const welcome = this.wait((m) => m.t === "welcome");
    this.send({ t: "join", gameId, name, playerId });
    await welcome;
    return this;
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  wait(pred: (m: ServerMessage) => boolean, ms = 8000) {
    return new Promise<ServerMessage>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }

  /** Wait until a pushed view satisfies the predicate. */
  async until(pred: (v: GameView) => boolean) {
    if (this.view && pred(this.view)) return this.view;
    return (await this.wait((m) => (m.t === "view" || m.t === "welcome") && pred(m.view)) as { view: GameView }).view;
  }
}

test("two players play a turn together", async () => {
  const created = (await (await fetch(`${BASE}/api/games`, { method: "POST", body: JSON.stringify({ name: "E2E" }) })).json()) as { gameId: string };
  expect(created.gameId).toBeTruthy();

  const alice = await new Client().connect(created.gameId, "Alice");
  const bob = await new Client().connect(created.gameId, "Bob");
  expect(alice.view.you.isHost).toBe(true);
  expect(bob.view.you.isHost).toBe(false);

  alice.send({ t: "claim", tag: "FRA" });
  bob.send({ t: "claim", tag: "DEU" });
  await alice.until((v) => v.players.filter((p) => p.country).length === 2);

  // Bob cannot take France, and cannot start the game.
  bob.send({ t: "claim", tag: "FRA" });
  expect((await bob.wait((m) => m.t === "error")).t).toBe("error");

  alice.send({ t: "settings", settings: { jumpDays: 90, difficulty: "hard" } });
  await bob.until((v) => v.settings.jumpDays === 90 && v.settings.difficulty === "hard");

  alice.send({ t: "start" });
  await bob.until((v) => v.phase === "orders");

  alice.send({ t: "orders", orders: [{ id: "o1", text: "Propose a joint European defence procurement fund." }] });
  bob.send({ t: "orders", orders: [{ id: "o2", text: "Raise defence spending to 2.5% of GDP." }] });
  // Orders stay private.
  await Bun.sleep(150);
  alice.send({ t: "ready", ready: true });
  await bob.until((v) => v.players.find((p) => p.country === "FRA")?.ready === true);
  expect(bob.view.orders.every((o) => o.country === "DEU")).toBe(true);

  const turnA = alice.wait((m) => m.t === "turn", 20000);
  const turnB = bob.wait((m) => m.t === "turn", 20000);
  bob.send({ t: "ready", ready: true });
  const [ra, rb] = (await Promise.all([turnA, turnB])) as { result: TurnResult }[];
  expect(ra.result.toDate).toBe("2026-04-01");
  expect(rb.result.events.length).toBe(ra.result.events.length);
  // Each player only sees verdicts (which quote orders) for their own orders.
  expect(ra.result.verdicts.map((v) => v.orderId)).toEqual(["o1"]);
  expect(rb.result.verdicts.map((v) => v.orderId)).toEqual(["o2"]);
  expect(ra.result.verdicts[0].text).toContain("defence procurement");

  const after = await alice.until((v) => v.turn === 2 && v.phase === "orders");
  expect(after.date).toBe("2026-04-01");
  expect(after.players.every((p) => !p.ready)).toBe(true);

  // Reconnect keeps identity and country.
  const bobId = bob.playerId;
  bob.ws.close();
  await alice.until((v) => v.players.find((p) => p.id === bobId)?.connected === false);
  const bob2 = await new Client().connect(created.gameId, "Bob", bobId);
  expect(bob2.view.you.country).toBe("DEU");

  // Diplomacy with an AI nation.
  alice.send({ t: "chat.open", with: ["ITA"] });
  const withChat = await alice.until((v) => v.chats.length === 1);
  alice.send({ t: "chat.send", chatId: withChat.chats[0].id, text: "Shall we deepen our trade ties?" });
  const replied = await alice.until((v) => (v.chats[0]?.messages.length ?? 0) >= 2);
  expect(replied.chats[0].messages.at(-1)?.from).toBe("ITA");
  // Bob does not see France's chat.
  expect(bob2.view.chats.length).toBe(0);

  // A UN resolution proposed by France gets voted on next turn.
  const un = after.organizations.find((o) => o.id === "un");
  if (un) {
    alice.send({ t: "org.propose", orgId: "un", resolutionType: "condemn", target: "PRK", text: "Condemns missile tests." });
    await alice.until((v) => v.resolutions.some((r) => r.status === "pending"));
  }

  const next = alice.wait((m) => m.t === "turn", 20000);
  alice.send({ t: "ready", ready: true });
  bob2.send({ t: "ready", ready: true });
  const r2 = (await next) as { result: TurnResult };
  expect(r2.result.turn).toBe(2);
  if (un) expect(r2.result.votes.length).toBeGreaterThan(0);
}, 60000);
