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

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. Without it the server uses a deterministic offline mock, so everything still runs. The host picks the model chain in the lobby. The default chain is three free models, fastest first by benchmark: `minimax/minimax-m3.1-flash:free` → `nvidia/nemotron-3-super-120b-a12b:free` → `nvidia/nemotron-3.5-super-vl:free`, then `deepseek/deepseek-v4.1-flash-1017` as a paid last resort (about a tenth of a cent per turn), used only when all the free ones fail. OpenRouter accepts at most 3 models per request, so the server sends the chain in batches of 3 and moves to the next batch if one fails. OpenRouter's own limits for free models are 20 requests/minute and 50/day, or 1,000/day once you've bought $10 of credits. The server counts requests for the in-game meter; `OPENROUTER_DAILY_LIMIT` optionally adds a hard local cap. A turn costs about 2 requests: the World Director and the resolver. Chats, the advisor and nation-formation checks cost 1 each. Economy mode merges the Director into the resolver. The World Director's planning doesn't depend on players' orders, so the server starts it as soon as a turn opens; pressing ready then only waits for the resolver (about 15–25 seconds). `bun --cwd apps/server scripts/bench.ts <gameId>` times each model on a saved game's next turn, and `scripts/turn-check.ts <gameId>` times a pre-planned turn and lists its structural changes. Long games stay bounded: chronicles are summarised every 5 turns and folded into one "earlier history" entry once there are more than 6.

Reasoning is off by default: free models answer much faster without it. With the default free chain, a one-month turn takes about 1.5 minutes, a diplomacy reply about 2 seconds and the advisor about 8 seconds. Hosts can switch reasoning on in the lobby. To check the live AI end to end (about 5 requests), run:

```bash
bun run ai:smoke
```

`WORLDLINE_AI=mock` forces the offline mock even when a key is set; the tests use this.

### Playing with friends

Forward port 5173 with VS Code's Ports panel (set visibility to Public) or a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5173`), then share the link. Vite already allows `*.devtunnels.ms`, `*.trycloudflare.com` and ngrok hosts. Everyone shares the server's OpenRouter quota.

### Features

- **Scenarios:** Modern Day (1 Jan 2026) and Cold War (1 Oct 1962), plus any you build in the scenario editor at `/editor`. The editor lets you paint regions, edit nations and save; saving needs an account.
- **Accounts:** optional. Signing in lets you resume your games on any device; guests can still play.
- **Time:** the host can rewind to any earlier turn from the History panel, or stop the last turn at a chosen event with "Intervene here".
- **Diplomacy:** one-to-one chats and multi-nation conferences where you pick who answers. Organisations hold votes with real rules (UN Security Council veto, EU qualified majority, NATO consensus). Nations can be formed when the AI judges it realistic.

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

Terrain relief comes from Natural Earth's 1:50m shaded relief, also public domain:

```bash
mkdir -p tools/mapgen/data/raw/relief && cd tools/mapgen/data/raw/relief && curl -sSLO https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip && unzip -o SR_50M.zip
```

```bash
bun run mapgen
```

`build.ts` merges tiny admin-1 units within each constituent unit (minimum 6,000 km², maximum 30,000 km² after merging), rasterises 16-bit province ids at 8192×4096, and writes adjacency, a coast distance field and simplified border arcs. `scenario-modern.ts` applies `overrides.json` and warns about neighbouring countries whose colours are too similar. `scenario-seed.ts` builds `seed.json`: World Bank stats (cached), leaders, agendas, organisations, treaties, wars, sanctions, relations, the 2026 calendar, the world brief and formable nations.
