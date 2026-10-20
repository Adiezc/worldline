// End-to-end: accounts, cross-device resume, rewind, intervene, saved-game files, custom scenarios and
// group chats against a real server process (mock AI, in-memory database).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuthResponse, GameBundle, MeResponse, ScenarioInfo, ScenarioSeed, ServerMessage, TurnResult } from "@worldline/shared";
import { Client, startServer } from "./fixtures/server.ts";

const PORT = 4000 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = await startServer(PORT);
});
afterAll(() => proc?.kill());

const post = (path: string, body: unknown, token?: string) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
const get = (path: string, token?: string) => fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function newGame(body: Record<string, unknown> = { name: "Test" }) {
  const res = await post("/api/games", body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { gameId: string }).gameId;
}

/** Host claims a country, starts, and resolves `turns` turns alone. */
async function playTurns(host: Client, tag: string, turns: number) {
  host.send({ t: "claim", tag });
  await host.until((v) => v.you.country === tag);
  host.send({ t: "start" });
  await host.until((v) => v.phase === "orders");
  const results: TurnResult[] = [];
  for (let i = 0; i < turns; i++) {
    const turn = host.view.turn;
    host.send({ t: "orders", orders: [{ id: `o${turn}`, text: "Expand vocational training and apprenticeships." }] });
    await Bun.sleep(50);
    const next = host.wait((m) => m.t === "turn", 20000);
    host.send({ t: "ready", ready: true });
    results.push(((await next) as { result: TurnResult }).result);
    await host.until((v) => v.turn === turn + 1 && v.phase === "orders");
  }
  return results;
}

describe("accounts", () => {
  test("register, login, me; wrong password rejected", async () => {
    const reg = await post("/api/auth/register", { username: "Ada_1", password: "correct horse" });
    expect(reg.status).toBe(200);
    const auth = (await reg.json()) as AuthResponse;
    expect(auth.token).toMatch(/^[0-9a-f]{64}$/);
    expect(auth.user.username).toBe("Ada_1");

    expect((await post("/api/auth/register", { username: "ada_1", password: "another pass" })).status).toBe(409);
    expect((await post("/api/auth/register", { username: "x", password: "long enough" })).status).toBe(400);
    expect((await post("/api/auth/register", { username: "bob", password: "short" })).status).toBe(400);

    expect((await post("/api/auth/login", { username: "ada_1", password: "wrong password" })).status).toBe(401);
    const login = await post("/api/auth/login", { username: "ADA_1", password: "correct horse" });
    expect(login.status).toBe(200);
    const { token } = (await login.json()) as AuthResponse;

    const me = await get("/api/me", token);
    expect(me.status).toBe(200);
    expect(((await me.json()) as MeResponse).user.id).toBe(auth.user.id);
    expect((await get("/api/me")).status).toBe(401);

    expect((await post("/api/auth/logout", {}, token)).status).toBe(200);
    expect((await get("/api/me", token)).status).toBe(401);
    // The first session is still valid.
    expect((await get("/api/me", auth.token)).status).toBe(200);
  });

  test("login attempts are rate limited", async () => {
    await post("/api/auth/register", { username: "limited", password: "password123" });
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await post("/api/auth/login", { username: "limited", password: "nope-nope" })).status);
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[10]).toBe(429);
  });

  test("a token restores the same player on a second device", async () => {
    const { token } = (await (await post("/api/auth/register", { username: "grace", password: "hopper1906" })).json()) as AuthResponse;
    const gameId = await newGame({ name: "Resume" });
    const laptop = await new Client(PORT).connect(gameId, "Grace", undefined, token);
    laptop.send({ t: "claim", tag: "FRA" });
    await laptop.until((v) => v.you.country === "FRA");

    const phone = await new Client(PORT).connect(gameId, "Grace (phone)", undefined, token);
    expect(phone.playerId).toBe(laptop.playerId);
    expect(phone.view.you.country).toBe("FRA");
    expect(phone.view.you.isHost).toBe(true);
    expect(phone.view.players.length).toBe(1);

    const me = (await (await get("/api/me", token)).json()) as MeResponse;
    expect(me.games.map((g) => g.id)).toEqual([gameId]);
    expect(me.games[0].myCountry).toBe("FRA");
    expect(me.games[0].lastPlayed).toBeGreaterThan(0);
    laptop.close();
    phone.close();
  });
});

describe("time travel", () => {
  test("rewind restores an earlier turn's date and owners", async () => {
    const gameId = await newGame({ name: "Rewind" });
    const host = await new Client(PORT).connect(gameId, "Host");
    const start = { date: host.view.date, owners: host.view.owners, controllers: host.view.controllers };
    const guest = await new Client(PORT).connect(gameId, "Guest");
    await playTurns(host, "FRA", 2);
    expect(host.view.date).not.toBe(start.date);
    expect(host.view.snapshots.map((s) => s.turn)).toEqual([1, 2]);
    expect(host.view.snapshots[0].date).toBe(start.date);
    expect((await guest.until((v) => v.turn === 3)).snapshots).toEqual([]);

    guest.send({ t: "rewind", turn: 1 });
    expect(((await guest.wait((m) => m.t === "error")) as { message: string }).message).toMatch(/host/);

    const toast = host.wait((m) => m.t === "toast" && /Rewound/.test(m.text));
    host.send({ t: "rewind", turn: 1 });
    const v = await host.until((x) => x.turn === 1);
    expect(((await toast) as { text: string }).text).toBe(`Rewound to ${start.date} (turn 1)`);
    expect(v.date).toBe(start.date);
    expect(v.owners).toEqual(start.owners);
    expect(v.controllers).toEqual(start.controllers);
    expect(v.you.country).toBe("FRA");
    expect(v.phase).toBe("orders");
    expect(v.orders).toEqual([]);
    expect(v.snapshots.map((s) => s.turn)).toEqual([1]);

    // The branch plays on.
    const [r] = await playTurns2(host);
    expect(r.fromDate).toBe(start.date);
    host.close();
    guest.close();
  }, 30000);

  test("intervene stops the last turn at an event; non-hosts are refused", async () => {
    const gameId = await newGame({ name: "Intervene" });
    const host = await new Client(PORT).connect(gameId, "Host");
    const guest = await new Client(PORT).connect(gameId, "Guest");
    guest.send({ t: "claim", tag: "DEU" });
    await guest.until((v) => v.you.country === "DEU");
    // The guest is ready from the start so the host alone decides when the turn resolves.
    const [turn] = await playTurns(host, "FRA", 0).then(async () => {
      guest.send({ t: "ready", ready: true });
      host.send({ t: "orders", orders: [{ id: "o1", text: "Expand vocational training." }] });
      await Bun.sleep(50);
      const next = host.wait((m) => m.t === "turn", 20000);
      host.send({ t: "ready", ready: true });
      return [((await next) as { result: TurnResult }).result];
    });
    const v = await host.until((x) => x.turn === 2 && x.phase === "orders");
    expect(turn.events.length).toBeGreaterThan(2);
    expect(v.intervenable).toEqual(turn.events.map((e) => e.id));
    expect((await guest.until((x) => x.turn === 2)).intervenable).toEqual([]);

    const target = turn.events[1];
    guest.send({ t: "intervene", eventId: target.id });
    expect(((await guest.wait((m) => m.t === "error")) as { message: string }).message).toMatch(/host/);

    const toast = host.wait((m) => m.t === "toast" && /Time stopped/.test(m.text));
    const eventCount = v.eventCount;
    host.send({ t: "intervene", eventId: target.id });
    const after = await host.until((x) => x.date === target.date && x.eventCount < eventCount);
    await toast;
    expect(after.turn).toBe(2);
    expect(after.events.at(-1)?.id).toBe(target.id);
    expect(after.eventCount).toBe(eventCount - (turn.events.length - 2));
    expect(after.intervenable).toEqual(turn.events.slice(0, 2).map((e) => e.id));

    // Once orders exist for the new turn, the past is closed.
    host.send({ t: "orders", orders: [{ id: "o2", text: "Hold a referendum on pension reform." }] });
    await Bun.sleep(100);
    host.send({ t: "intervene", eventId: turn.events[0].id });
    expect(((await host.wait((m) => m.t === "error")) as { message: string }).message).toMatch(/no longer/);
    host.close();
    guest.close();
  }, 30000);
});

/** One more turn for a host that already started (used after a rewind). */
async function playTurns2(host: Client) {
  const turn = host.view.turn;
  const next = host.wait((m) => m.t === "turn", 20000);
  host.send({ t: "ready", ready: true });
  const r = ((await next) as { result: TurnResult }).result;
  await host.until((v) => v.turn === turn + 1);
  return [r];
}

describe("scenarios", () => {
  let token = "";
  let modern: ScenarioSeed;

  beforeAll(async () => {
    token = ((await (await post("/api/auth/register", { username: "editor", password: "scenario-maker" })).json()) as AuthResponse).token;
    modern = (await (await get("/api/scenarios/modern-2026")).json()) as ScenarioSeed;
  });

  const custom = (patch: (s: Record<string, unknown>) => void) => {
    const s = structuredClone(modern) as unknown as Record<string, unknown>;
    delete s.id;
    delete s.author;
    s.name = "Pangaea Divided";
    s.description = "A test world.";
    patch(s);
    return s;
  };

  test("lists built-ins and serves full seeds", async () => {
    const list = (await (await get("/api/scenarios")).json()) as ScenarioInfo[];
    const m = list.find((s) => s.id === "modern-2026")!;
    expect(m).toBeDefined();
    expect(m.custom).toBe(false);
    expect(m.countries).toBe(modern.countries.length);
    expect(modern.owners.length).toBeGreaterThan(100);
    expect((await get("/api/scenarios/nope")).status).toBe(404);
  });

  test("validation rejects bad colours and out-of-range owners; requires auth", async () => {
    expect((await post("/api/scenarios", custom(() => {}))).status).toBe(401);

    const badColour = await post("/api/scenarios", custom((s) => {
      (s.countries as { color: string }[])[3].color = "red";
    }), token);
    expect(badColour.status).toBe(400);
    expect(((await badColour.json()) as { error: string }).error).toMatch(/colour/);

    const badOwner = await post("/api/scenarios", custom((s) => {
      (s.owners as number[])[5] = (s.countries as unknown[]).length;
    }), token);
    expect(badOwner.status).toBe(400);
    expect(((await badOwner.json()) as { error: string }).error).toMatch(/owners\[5\]/);

    const shortMap = await post("/api/scenarios", custom((s) => {
      (s.owners as number[]).pop();
    }), token);
    expect(shortMap.status).toBe(400);

    const dupTag = await post("/api/scenarios", custom((s) => {
      const cs = s.countries as { tag: string }[];
      cs[1].tag = cs[0].tag;
    }), token);
    expect(dupTag.status).toBe(400);

    expect((await post("/api/scenarios", custom((s) => { s.date = "2026-02-30"; }), token)).status).toBe(400);
  });

  test("a custom scenario is saved, cleaned up and playable", async () => {
    const res = await post("/api/scenarios", custom((s) => {
      const cs = s.countries as { tag: string; stability: number; gdp: number; agenda?: unknown }[];
      cs[0].stability = 400;
      cs[0].gdp = Number.NaN; // serialised as null
      delete cs[1].agenda;
      (s.treaties as { members: string[] }[]).push({ members: ["ZZZ", "QQQ"] } as never);
      s.relations = { ...(s.relations as object), "FRA|NOPE": 50 };
      delete s.controllers;
    }), token);
    expect(res.status).toBe(200);
    const { id } = (await res.json()) as { id: string };
    expect(id).toMatch(/^custom-[a-z0-9]{8}$/);

    const list = (await (await get("/api/scenarios")).json()) as ScenarioInfo[];
    expect(list.findIndex((s) => s.id === id)).toBeGreaterThan(list.findIndex((s) => s.id === "modern-2026"));
    const info = list.find((s) => s.id === id)!;
    // The era look chosen in the editor is kept (this body was built from the modern seed).
    expect(info).toMatchObject({ name: "Pangaea Divided", custom: true, author: "editor", theme: "modern", description: "A test world." });

    const seed = (await (await get(`/api/scenarios/${id}`)).json()) as ScenarioSeed;
    expect(seed.author).toBe("editor");
    expect(seed.countries[0].stability).toBe(100);
    expect(seed.countries[0].gdp).toBeGreaterThan(0);
    expect(seed.countries[1].agenda.goals.length).toBeGreaterThan(0);
    expect(seed.controllers).toEqual(seed.owners);
    expect(Object.keys(seed.relations).some((k) => k.includes("NOPE"))).toBe(false);
    expect(seed.treaties.every((t) => t.members.length >= 2)).toBe(true);

    const gameId = await newGame({ name: "Custom", scenarioId: id });
    const c = await new Client(PORT).connect(gameId, "Player");
    expect(c.view.theme).toBe("modern");
    expect(c.view.scenarioId).toBe(id);
    expect(c.view.countries.length).toBe(modern.countries.length);
    c.close();

    expect((await post("/api/games", { name: "x", scenarioId: "custom-missing1" })).status).toBe(404);
  });
});

describe("group chats", () => {
  test("a named AI delegation answers in a conference", async () => {
    const gameId = await newGame({ name: "Chat" });
    const host = await new Client(PORT).connect(gameId, "Host");
    host.send({ t: "claim", tag: "FRA" });
    await host.until((v) => v.you.country === "FRA");
    host.send({ t: "chat.open", with: ["DEU", "ITA", "ESP"] });
    const v = await host.until((x) => x.chats.length === 1);
    const chat = v.chats[0];
    expect([...chat.members].sort()).toEqual(["DEU", "ESP", "FRA", "ITA"]);

    const typing = host.wait((m) => m.t === "chat.typing");
    host.send({ t: "chat.send", chatId: chat.id, text: "Germany, what do you say?", speaker: "ESP" });
    expect(((await typing) as Extract<ServerMessage, { t: "chat.typing" }>).from).toBe("ESP");
    const replied = await host.until((x) => (x.chats[0]?.messages.length ?? 0) >= 2);
    // Named in the text, but the explicit speaker wins.
    expect(replied.chats[0].messages.at(-1)?.from).toBe("ESP");

    host.send({ t: "chat.send", chatId: chat.id, text: "And Italy?", speaker: "ITA" });
    expect((await host.until((x) => (x.chats[0]?.messages.length ?? 0) >= 4)).chats[0].messages.at(-1)?.from).toBe("ITA");

    host.send({ t: "chat.send", chatId: chat.id, text: "Myself?", speaker: "FRA" });
    expect((await host.wait((m) => m.t === "error")).t).toBe("error");
    host.close();
  });
});

describe("saved-game files", () => {
  const exportGame = (gameId: string, player?: string) =>
    fetch(`${BASE}/api/games/${gameId}/export`, { headers: player ? { "x-worldline-player": player } : {} });

  test("only the host can export", async () => {
    const gameId = await newGame({ name: "Export Me!" });
    const host = await new Client(PORT).connect(gameId, "Host");
    const guest = await new Client(PORT).connect(gameId, "Guest");
    expect((await exportGame(gameId)).status).toBe(403);
    expect((await exportGame(gameId, guest.playerId)).status).toBe(403);
    expect((await exportGame(gameId, "not-a-player")).status).toBe(403);
    expect((await exportGame("nosuchgame", host.playerId)).status).toBe(404);
    // The seat secret is never accepted from the URL, where logs would keep it.
    expect((await get(`/api/games/${gameId}/export?player=${encodeURIComponent(host.playerId)}`)).status).toBe(403);

    const res = await exportGame(gameId, host.playerId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="worldline-export-me-turn1.json"');
    const bundle = (await res.json()) as GameBundle;
    expect(bundle.format).toBe("worldline-game/1");
    expect(bundle.game.id).toBe(gameId);
    host.close();
    guest.close();
  });

  test("export → import makes a new, playable game that can still rewind", async () => {
    const gameId = await newGame({ name: "Round Trip" });
    const host = await new Client(PORT).connect(gameId, "Host");
    const guest = await new Client(PORT).connect(gameId, "Guest");
    await playTurns(host, "FRA", 2);
    const before = host.view;

    const res = await exportGame(gameId, host.playerId);
    const text = await res.text();
    // Player ids resume seats: they never leave the server.
    expect(text).not.toContain(host.playerId);
    expect(text).not.toContain(guest.playerId);
    const bundle = JSON.parse(text) as GameBundle;
    expect(bundle.snapshots.map((s) => s.turn)).toEqual([1, 2]);
    expect(bundle.game.players.map((p) => p.name)).toEqual(["Host", "Guest"]);
    host.close();
    guest.close();

    const imp = await post("/api/games/import", { ...bundle, name: "Round Trip (copy)" });
    expect(imp.status).toBe(200);
    const { gameId: copyId } = (await imp.json()) as { gameId: string };
    expect(copyId).not.toBe(gameId);

    const c = await new Client(PORT).connect(copyId, "Importer");
    const v = c.view;
    expect(v.id).toBe(copyId);
    expect(v.name).toBe("Round Trip (copy)");
    expect(v.phase).toBe("lobby");
    expect(v.players.length).toBe(1);
    expect(v.you.isHost).toBe(true);
    expect(v.you.country).toBeNull();
    expect([v.turn, v.date]).toEqual([before.turn, before.date]);
    expect(v.owners).toEqual(before.owners);
    expect(v.eventCount).toBe(before.eventCount);
    expect(v.snapshots.map((s) => s.turn)).toEqual([1, 2]);

    // Pick a country mid-game, start, and play on.
    const [r] = await playTurns(c, "DEU", 1);
    expect(r.fromDate).toBe(before.date);
    expect(c.view.turn).toBe(before.turn + 1);

    c.send({ t: "rewind", turn: 1 });
    expect((await c.until((x) => x.turn === 1)).date).toBe(bundle.snapshots[0].date);
    c.close();

    // The original is untouched.
    expect(((await (await get(`/api/games/${gameId}`)).json()) as { turn: number }).turn).toBe(before.turn);
  }, 30000);

  test("malformed files are rejected", async () => {
    const gameId = await newGame({ name: "Template" });
    const host = await new Client(PORT).connect(gameId, "Host");
    const good = (await (await exportGame(gameId, host.playerId)).json()) as GameBundle;
    host.close();
    const bad = async (patch: (b: Record<string, any>) => void, match: RegExp) => {
      const b = structuredClone(good) as unknown as Record<string, any>;
      patch(b);
      const res = await post("/api/games/import", b);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toMatch(match);
    };

    const raw = await fetch(`${BASE}/api/games/import`, { method: "POST", body: "{not json" });
    expect(raw.status).toBe(400);
    await bad((b) => (b.format = "worldline-game/0"), /format/);
    await bad((b) => delete b.game, /game must be an object/);
    await bad((b) => (b.game.countries = []), /countries is empty/);
    await bad((b) => b.game.owners.pop(), /owners must have/);
    await bad((b) => (b.game.controllers[7] = b.game.countries.length), /controllers\[7\]/);
    await bad((b) => (b.game.turn = "3"), /turn/);
    await bad((b) => (b.game.date = "2026-02-30"), /date/);
    await bad((b) => (b.game.countries[2].tag = b.game.countries[0].tag), /tag/);
    await bad((b) => (b.game.wars = [{ attackers: "FRA" }]), /attackers/);
    await bad((b) => (b.game.scenarioId = "custom-missing1"), /scenario/);
    await bad((b) => (b.snapshots = [{ ...b.game, turn: 5 }]), /after the game's turn/);
    await bad((b) => (b.snapshots = [b.game, b.game]), /turn order/);
    await bad((b) => (b.snapshots = { 0: b.game }), /snapshots must be an array/);
  });
});
