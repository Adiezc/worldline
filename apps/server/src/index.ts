// Worldline game server: REST for creating/looking up games, WebSocket for play.
// Serves the built web client from apps/web/dist when it exists (production).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SERVER_PORT, buildMapIndex, type ClientMessage, type CreateGameRequest, type GameSummary, type HealthResponse,
  type MapMeta, type ScenarioSeed,
} from "@worldline/shared";
import { createProvider } from "./ai/index.ts";
import { RoomManager, errorText, type SocketData } from "./rooms.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
const meta = JSON.parse(readFileSync(join(ROOT, "packages/mapdata/public/map/provinces.json"), "utf8")) as MapMeta;
const map = buildMapIndex(meta);

const seeds = new Map<string, ScenarioSeed>();
function seed(id: string): ScenarioSeed {
  let s = seeds.get(id);
  if (!s) {
    const path = join(ROOT, "packages/scenarios", id, "seed.json");
    if (!existsSync(path)) throw new Error(`Scenario ${id} has no seed.json; run \`bun run mapgen\``);
    s = JSON.parse(readFileSync(path, "utf8")) as ScenarioSeed;
    seeds.set(id, s);
  }
  return s;
}

const ai = createProvider();
const rooms = new RoomManager({ map, ai, seed });
const WEB_DIST = join(ROOT, "apps/web/dist");
const port = Number(process.env.PORT ?? SERVER_PORT);

const json = (data: unknown, status = 200) => Response.json(data, { status });

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
        const room = rooms.create(String(body.name ?? "New game"), body.scenarioId ?? "modern-2026");
        return json({ gameId: room.state.id });
      } catch (e) {
        return json({ error: errorText(e) }, 500);
      }
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
      if (!path.includes("..") && (await file.exists())) return new Response(file);
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
        ws.send(JSON.stringify({ t: "error", message: "Malformed message" }));
        return;
      }
      if (msg.t === "join") {
        const room = rooms.get(msg.gameId);
        if (!room) ws.send(JSON.stringify({ t: "error", message: "Game not found" }));
        else room.join(ws, msg);
        return;
      }
      const room = ws.data.gameId ? rooms.get(ws.data.gameId) : null;
      if (!room) {
        ws.send(JSON.stringify({ t: "error", message: "Join a game first" }));
        return;
      }
      room.handle(ws, msg).catch((e) => ws.send(JSON.stringify({ t: "error", message: errorText(e) })));
    },
    close(ws) {
      const room = ws.data.gameId ? rooms.get(ws.data.gameId) : null;
      room?.leave(ws);
    },
  },
});

console.log(`Worldline server on http://localhost:${server.port} (AI: ${ai.name})`);
