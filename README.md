# Worldline

An AI-driven grand-strategy browser game. Modern Day scenario starting 1 January 2026, multiplayer for friends, and a political map in the style of Victoria 3. Design plan: `~/.claude/plans/i-want-to-make-swirling-plum.md`.

## Layout

```
apps/web/            Vite + React client; WebGL2 map renderer in src/map/, HUD in src/ui/
apps/server/         Bun server: rooms + WebSocket (src/rooms.ts), SQLite saves (src/db.ts),
                     game engine and prompts (src/engine/), OpenRouter + mock AI (src/ai/)
packages/shared/     Game state, rules engine (validates every AI effect), votes, sim, protocol
packages/mapdata/    Generated base map (province bitmap, borders, metadata) served at /map/*
packages/scenarios/  Scenario starts; modern-2026/overrides.json holds names, colours, occupations
tools/mapgen/        Offline pipeline: Natural Earth → province bitmap + metadata
```

## Running

```bash
bun install
bun run dev
```

This runs the web client on http://localhost:5173 and the game server on :3001. The client proxies `/api` and `/ws` to the server.

### AI

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. Without it the server uses a deterministic offline mock, so everything still runs. The host picks the model chain in the lobby. The default chain is `nvidia/nemotron-3.5-super-vl:free` → `nvidia/nemotron-3-super-120b-a12b:free`, and OpenRouter falls back down it automatically. Free models are capped at 20 requests/minute and 50/day, or 1,000/day after buying $10 of credits; set `OPENROUTER_DAILY_LIMIT` to match. A turn costs about 2 requests: the World Director and the resolver. Chats, the advisor and nation-formation checks cost 1 each. Economy mode merges the Director into the resolver.

### Tests

```bash
bun test
```

Covers the rules engine, voting, the simulation, nation formation, the AI schemas, the turn pipeline with the mock AI, and a two-player WebSocket game.

## Rebuilding the map

The generated files are committed. To regenerate them, download the Natural Earth source data (public domain):

```bash
mkdir -p tools/mapgen/data/raw && cd tools/mapgen/data/raw && for f in ne_10m_admin_1_states_provinces ne_10m_admin_0_countries; do curl -sSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done
```

```bash
bun run mapgen
```

`build.ts` merges tiny admin-1 units within each constituent unit (minimum 6,000 km², maximum 30,000 km² after merging), rasterises 16-bit province ids at 8192×4096, and writes adjacency, a coast distance field and simplified border arcs. `scenario-modern.ts` applies `overrides.json` and warns about neighbouring countries whose colours are too similar. `scenario-seed.ts` builds `seed.json`: World Bank stats (cached), leaders, agendas, organisations, treaties, wars, sanctions, relations, the 2026 calendar, the world brief and formable nations.
