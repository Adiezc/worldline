# Worldline

An AI-driven grand-strategy browser game. Modern Day scenario starting 1 January 2026, multiplayer for friends, and a political map in the style of Victoria 3. Design plan: `~/.claude/plans/i-want-to-make-swirling-plum.md`.

## Layout

```
apps/web/            Vite + React client; WebGL2 map renderer in src/map/, HUD in src/ui/
apps/server/         Bun server: rooms + WebSocket (src/rooms.ts), SQLite saves (src/db.ts),
                     game engine and prompts (src/engine/), AI backends + mock (src/ai/)
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

Copy `.env.example` to `.env` in the repo root and set `OPENROUTER_API_KEY`. The server loads that file itself, since Bun only reads `.env` from the working directory and the server runs from `apps/server`; variables already set in the shell win. Without a key the server uses a deterministic offline mock, so everything still runs. The host picks the model chain in the lobby. The default chain is three free models, fastest first by benchmark: `minimax/minimax-m3.1-flash:free` → `nvidia/nemotron-3-super-120b-a12b:free` → `nvidia/nemotron-3.5-super-vl:free`, then `deepseek/deepseek-v4.1-flash-1017` as a paid last resort (about a tenth of a cent per turn), used only when all the free ones fail. OpenRouter accepts at most 3 models per request, so the server sends the chain in batches of 3 and moves to the next batch if one fails. OpenRouter's own limits for free models are 20 requests/minute and 50/day, or 1,000/day once you've bought $10 of credits. The server counts requests for the in-game meter; `OPENROUTER_DAILY_LIMIT` optionally adds a hard local cap. A turn costs about 2 requests: the World Director and the resolver. Messages AI nations send players on their own initiative come out of the resolver's answer, so they cost nothing extra. Chats, the advisor and nation-formation checks cost 1 each. Economy mode merges the Director into the resolver. The World Director's planning doesn't depend on players' orders, so the server starts it as soon as a turn opens; pressing ready then only waits for the resolver (about 15–25 seconds). `bun --cwd apps/server scripts/bench.ts <gameId>` times each model on a saved game's next turn, and `scripts/turn-check.ts <gameId>` times a pre-planned turn and lists its structural changes. Long games stay bounded: chronicles are summarised every 5 turns and folded into one "earlier history" entry once there are more than 6. Each turn's prompt also lists the effects the rules engine refused or scaled down the turn before, so the model's picture of the world doesn't drift from the map.

OpenRouter is not required. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` and `LOCAL_LLM_URL` (any OpenAI-compatible server such as Ollama or LM Studio) can each be set alongside it or instead of it. A chain entry picks its backend with a prefix: `anthropic:claude-opus-5-5`, `openai:<model>`, `gemini:<model>`, `local:<model>`; plain ids go to OpenRouter, and the chain falls through backends in order. When no entry in a game's chain has a key, the server uses `ANTHROPIC_MODEL` (default `claude-opus-5-5`), `OPENAI_MODEL`, `GEMINI_MODEL` or `LOCAL_LLM_MODEL`. Turn prompts put their stable parts first and mark cache breakpoints, so providers with prompt caching reuse most of each turn's prompt; the server log shows cached tokens per call. See `.env.example`.

Reasoning is off by default: free models answer much faster without it. With the default free chain, a one-month turn takes about 1.5 minutes, a diplomacy reply about 2 seconds and the advisor about 8 seconds. Hosts can switch reasoning on in the lobby. To check the live AI end to end (about 5 requests), run:

```bash
bun run ai:smoke
```

`WORLDLINE_AI=mock` forces the offline mock even when a key is set; the tests use this.

### Playing with friends

Forward port 5173 with VS Code's Ports panel (set visibility to Public) or a Cloudflare quick tunnel (`cloudflared tunnel --url http://localhost:5173`), then share the link. Vite already allows `*.devtunnels.ms`, `*.trycloudflare.com` and ngrok hosts. Everyone shares the server's AI keys and quota.

### Features

- **Scenarios:** Modern Day (1 Jan 2026) and Cold War (1 Oct 1962), plus any you build in the scenario editor at `/editor`. The editor lets you paint regions, edit nations and save; saving needs an account.
- **Accounts:** optional. Signing in lets you resume your games on any device; guests can still play.
- **Time:** the host can rewind to any earlier turn from the History panel, or stop the last turn at a chosen event with "Intervene here".
- **Saved games:** the host can export the game, with every saved turn, as one JSON file from the History panel; "Import game" on the main menu opens it as a new game whose players pick their countries again. Player ids are replaced in the file, since they work as seat passwords. Files stay under the 60 MB import limit: if a game is bigger, the oldest rewind points are left out and the panel says how many.
- **Diplomacy:** one-to-one chats and multi-nation conferences where you pick who answers. AI nations also write first when events give them a reason (a warning, a demand, an offer), sometimes with a deal attached. Each AI reply keeps a short private record of the conversation, so long negotiations stay consistent after old messages scroll away. Organisations hold votes with real rules (UN Security Council veto, EU qualified majority, NATO consensus). Nations can be formed when the AI judges it realistic.
- **Projects:** orders that take more than one turn (a rail network, a reform, a military build-up) become projects with milestones and a due date. Each turn moves them on within a pace the rules engine enforces; the Projects panel shows progress and whether a project is on track, behind, due soon or overdue, and lets you abandon it. Other players' projects stay private.
- **Advisor:** answers in letters, and may include a small chart when comparing numbers helps (GDP, military strength, relations with neighbours).

### Tests

```bash
bun test
```

Covers the rules engine, voting, the simulation, nation formation, projects, the AI schemas, model-chain routing across AI backends, the turn pipeline with the mock AI, saved-game export and import, what each player's view leaves out, and a two-player WebSocket game.

## Rebuilding the map

The generated files are committed. To regenerate them, download the Natural Earth source data (public domain):

```bash
mkdir -p tools/mapgen/data/raw && cd tools/mapgen/data/raw && for f in ne_10m_admin_1_states_provinces ne_10m_admin_0_countries; do curl -sSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done
```

Lakes come from Natural Earth's 1:10m lakes (`src/lakes.ts` turns them into `lakes.mesh.bin`, drawn as water over the land, so province ids are untouched):

```bash
mkdir -p tools/mapgen/data/raw/lakes && curl -sSL -o tools/mapgen/data/raw/lakes/ne_10m_lakes.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
```

Terrain relief comes from Natural Earth's 1:50m shaded relief, also public domain:

```bash
mkdir -p tools/mapgen/data/raw/relief && cd tools/mapgen/data/raw/relief && curl -sSLO https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip && unzip -o SR_50M.zip
```

```bash
bun run mapgen
```

`build.ts` merges tiny admin-1 units within each constituent unit (minimum 6,000 km², maximum 30,000 km² after merging), rasterises 16-bit province ids at 8192×4096, and writes adjacency, a coast distance field, simplified border arcs and a triangulated province mesh (`provinces.mesh.bin`) from the same simplified outlines. The client fills land from the bitmap when zoomed out and from the mesh when zoomed in, so close-ups stay sharp; the server gzips the mesh and other large assets when serving the built client. `scenario-modern.ts` applies `overrides.json` and warns about neighbouring countries whose colours are too similar. `scenario-seed.ts` builds `seed.json`: World Bank stats (cached), leaders, agendas, organisations, treaties, wars, sanctions, relations, the 2026 calendar, the world brief and formable nations.
