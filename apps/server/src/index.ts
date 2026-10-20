// Worldline game server: REST for games, scenarios and accounts, WebSocket for play.
// Serves the built web client from apps/web/dist when it exists (production).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SERVER_PORT, buildMapIndex, type AuthResponse, type ClientMessage, type CreateGameRequest, type GameSummary,
  type HealthResponse, type MapMeta, type MeResponse, type Player,
} from "@worldline/shared";
import { createProvider } from "./ai/index.ts";
import { createSession, createUser, deleteSession, findUser, gameSummaryRow, userForToken, userGames } from "./db.ts";
import { RoomManager, errorText, type SocketData } from "./rooms.ts";
import { ScenarioError, ScenarioRegistry } from "./scenarios.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const map = buildMapIndex(meta);
const scenarios = new ScenarioRegistry(join(ROOT, "packages/scenarios"), map.count);

const ai = createProvider();
const rooms = new RoomManager({ map, ai, seed: (id) => scenarios.seed(id) });
const WEB_DIST = join(ROOT, "apps/web/dist");
const port = Number(process.env.PORT ?? SERVER_PORT);

const json = (data: unknown, status = 200) => Response.json(data, { status });

/** Text and binary map assets worth compressing (the province mesh and borders are megabytes). */
const COMPRESSIBLE = /\.(?:js|css|html|json|svg|bin|txt|map)$/;
const gzipCache = new Map<string, { mtime: number; body: Uint8Array<ArrayBuffer> }>();

/** Static file, gzipped (once per file version) when the client accepts it. */
async function serveStatic(req: Request, file: ReturnType<typeof Bun.file>) {
  const name = file.name ?? "";
  if (!COMPRESSIBLE.test(name) || !/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "") || file.size < 1024) {
    return new Response(file);
  }
  let hit = gzipCache.get(name);
  if (!hit || hit.mtime !== file.lastModified) {
    hit = { mtime: file.lastModified, body: Bun.gzipSync(new Uint8Array(await file.arrayBuffer())) as Uint8Array<ArrayBuffer> };
    gzipCache.set(name, hit);
  }
  return new Response(hit.body, {
    headers: { "Content-Type": file.type, "Content-Encoding": "gzip", Vary: "Accept-Encoding" },
  });
}
const MAX_SCENARIO_BYTES = 3 * 1024 * 1024;

// ---- accounts ----

const USERNAME = /^[A-Za-z0-9_-]{3,24}$/;
const bearer = (req: Request) => req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? null;
const authUser = (req: Request) => {
  const t = bearer(req);
  return t ? userForToken(t) : null;
};

/** Login attempts per IP+username in the last minute. */
const attempts = new Map<string, number[]>();
function rateLimited(key: string) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  attempts.set(key, recent);
  if (attempts.size > 10_000) for (const [k, v] of attempts) if (v.every((t) => now - t >= 60_000)) attempts.delete(k);
  return recent.length > 10;
}

async function readAuth(req: Request): Promise<{ username: string; password: string } | null> {
  const body = (await req.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  if (!body || typeof body.username !== "string" || typeof body.password !== "string") return null;
  return { username: body.username.trim(), password: body.password };
}

function summaryOf(id: string): GameSummary | null {
  const room = rooms.peek(id);
  const s = room ? { id, name: room.state.name, date: room.state.date, turn: room.state.turn, players: room.state.players } : gameSummaryRow(id);
  if (!s) return null;
  return {
    id: s.id, name: s.name, date: s.date, turn: s.turn,
    players: (s.players as Player[]).map((p) => ({ name: p.name, country: p.country, connected: !!room && p.connected })),
  };
}

async function readJsonLimited(req: Request, limit: number): Promise<{ ok: true; value: unknown } | { ok: false; status: number; error: string }> {
  if (Number(req.headers.get("content-length") ?? 0) > limit) return { ok: false, status: 413, error: "Scenario too large (3 MB max)." };
  const text = await req.text();
  if (text.length > limit) return { ok: false, status: 413, error: "Scenario too large (3 MB max)." };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Malformed JSON." };
  }
}

const server = Bun.serve<SocketData>({
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ws") {
      if (srv.upgrade(req, { data: {} })) return undefined;
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    if (path === "/api/health") {
      const q = ai.quota();
      return json({ ok: true, ai: ai.name, dailyLimit: q.dailyLimit, usedToday: q.usedToday } satisfies HealthResponse);
    }

    if (path === "/api/games" && req.method === "POST") {
      try {
        const body = (await req.json().catch(() => ({}))) as Partial<CreateGameRequest>;
        const scenarioId = typeof body.scenarioId === "string" && body.scenarioId ? body.scenarioId : "modern-2026";
        if (!scenarios.get(scenarioId)) return json({ error: `Unknown scenario "${scenarioId}"` }, 404);
        const room = rooms.create(String(body.name ?? "New game"), scenarioId);
        return json({ gameId: room.state.id });
      } catch (e) {
        return json({ error: errorText(e) }, 500);
      }
    }

    // ---- scenarios ----

    if (path === "/api/scenarios" && req.method === "GET") return json(scenarios.list());

    if (path === "/api/scenarios" && req.method === "POST") {
      const user = authUser(req);
      if (!user) return json({ error: "Sign in to save scenarios." }, 401);
      const body = await readJsonLimited(req, MAX_SCENARIO_BYTES);
      if (!body.ok) return json({ error: body.error }, body.status);
      try {
        return json({ id: scenarios.create(body.value, user) });
      } catch (e) {
        if (e instanceof ScenarioError) return json({ error: e.message }, 400);
        return json({ error: errorText(e) }, 500);
      }
    }

    const sc = path.match(/^\/api\/scenarios\/([A-Za-z0-9_-]+)$/);
    if (sc && req.method === "GET") {
      const seed = scenarios.get(sc[1]);
      return seed ? json(seed) : json({ error: "Scenario not found" }, 404);
    }

    // ---- accounts ----

    if (path === "/api/auth/register" && req.method === "POST") {
      const body = await readAuth(req);
      if (!body) return json({ error: "Username and password are required." }, 400);
      if (!USERNAME.test(body.username)) return json({ error: "Usernames are 3–24 letters, digits, _ or -." }, 400);
      if (body.password.length < 8) return json({ error: "Passwords need at least 8 characters." }, 400);
      if (body.password.length > 256) return json({ error: "Password too long." }, 400);
      if (findUser(body.username)) return json({ error: "That username is taken." }, 409);
      const hash = await Bun.password.hash(body.password, { algorithm: "argon2id" });
      const user = createUser(body.username, hash);
      if (!user) return json({ error: "That username is taken." }, 409);
      return json({ token: createSession(user.id), user } satisfies AuthResponse);
    }

    if (path === "/api/auth/login" && req.method === "POST") {
      const body = await readAuth(req);
      if (!body) return json({ error: "Username and password are required." }, 400);
      const ip = srv.requestIP(req)?.address ?? "unknown";
      if (rateLimited(`${ip}|${body.username.toLowerCase()}`)) return json({ error: "Too many attempts; wait a minute." }, 429);
      const row = findUser(body.username);
      const ok = row ? await Bun.password.verify(body.password, row.pass_hash).catch(() => false) : false;
      if (!row || !ok) return json({ error: "Wrong username or password." }, 401);
      return json({ token: createSession(row.id), user: { id: row.id, username: row.username } } satisfies AuthResponse);
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      const t = bearer(req);
      if (t) deleteSession(t);
      return json({ ok: true });
    }

    if (path === "/api/me" && req.method === "GET") {
      const user = authUser(req);
      if (!user) return json({ error: "Not signed in." }, 401);
      const games: MeResponse["games"] = [];
      for (const link of userGames(user.id)) {
        const g = summaryOf(link.game_id);
        if (!g) continue;
        const room = rooms.peek(link.game_id);
        const players = room ? room.state.players : gameSummaryRow(link.game_id)?.players ?? [];
        const myCountry = players.find((p) => p.id === link.player_id)?.country ?? null;
        games.push({ ...g, lastPlayed: link.last_played, myCountry });
      }
      return json({ user, games } satisfies MeResponse);
    }

    const m = path.match(/^\/api\/games\/([a-z0-9]+)$/);
    if (m && req.method === "GET") {
      const room = rooms.get(m[1]);
      if (!room) return json({ error: "Game not found" }, 404);
      const s = room.state;
      return json({
        id: s.id, name: s.name, date: s.date, turn: s.turn,
        players: s.players.map((p) => ({ name: p.name, country: p.country, connected: p.connected })),
      } satisfies GameSummary);
    }

    if (path.startsWith("/api/")) return json({ error: "Not found" }, 404);

    // Production: static client with SPA fallback.
    if (existsSync(WEB_DIST)) {
      const file = Bun.file(join(WEB_DIST, path === "/" ? "index.html" : path));
      if (!path.includes("..") && (await file.exists())) return serveStatic(req, file);
      return new Response(Bun.file(join(WEB_DIST, "index.html")));
    }
    return new Response("Worldline server. Run the web client with `bun run dev`.", { status: 200 });
  },
  websocket: {
    perMessageDeflate: true,
    maxPayloadLength: 1 << 20,
    message(ws, raw) {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        msg = null as unknown as ClientMessage;
      }
      // Anything but an object with a string type is refused: a throw in this handler would take
      // the whole server, and every game on it, down.
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") {
        ws.send(JSON.stringify({ t: "error", message: "Malformed message" }));
        return;
      }
      try {
        if (msg.t === "join") {
          const room = typeof msg.gameId === "string" ? rooms.get(msg.gameId) : null;
          if (!room) {
            // Closing is what tells the client to stop waiting and show why it could not join.
            ws.send(JSON.stringify({ t: "error", message: "Game not found" }));
            ws.close();
            return;
          }
          // An invalid or expired token just joins anonymously.
          const user = typeof msg.token === "string" ? userForToken(msg.token) : null;
          room.join(ws, msg, user);
          return;
        }
        const room = ws.data.gameId ? rooms.get(ws.data.gameId) : null;
        if (!room) {
          ws.send(JSON.stringify({ t: "error", message: "Join a game first" }));
          return;
        }
        room.handle(ws, msg).catch((e) => ws.send(JSON.stringify({ t: "error", message: errorText(e) })));
      } catch (e) {
        ws.send(JSON.stringify({ t: "error", message: errorText(e) }));
      }
    },
    close(ws) {
      const room = ws.data.gameId ? rooms.get(ws.data.gameId) : null;
      room?.leave(ws);
    },
  },
});

console.log(`Worldline server on http://localhost:${server.port} (AI: ${ai.name})`);
