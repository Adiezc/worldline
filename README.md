# Worldline

An AI-driven grand-strategy browser game. Modern Day scenario starting 1 January 2026, multiplayer for friends, and a political map in the style of Victoria 3. Design plan: `~/.claude/plans/i-want-to-make-swirling-plum.md`.

## Layout

```
apps/web/            Vite + React client; WebGL2 map renderer in src/map/
packages/shared/     Shared types, Miller projection, curved-label algorithm
packages/mapdata/    Generated base map (province bitmap, borders, metadata) served at /map/*
packages/scenarios/  Scenario starts; modern-2026/overrides.json holds names, colours, occupations
tools/mapgen/        Offline pipeline: Natural Earth → province bitmap + metadata
```

## Running

```bash
bun install
bun run dev
```

## Rebuilding the map

The generated files are committed. To regenerate them, download the Natural Earth source data (public domain):

```bash
mkdir -p tools/mapgen/data/raw && cd tools/mapgen/data/raw && for f in ne_10m_admin_1_states_provinces ne_10m_admin_0_countries; do curl -sSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done
```

```bash
bun run mapgen
```

`build.ts` merges tiny admin-1 units within each constituent unit (minimum 6,000 km², maximum 30,000 km² after merging), rasterises 16-bit province ids at 8192×4096, and writes adjacency, a coast distance field and simplified border arcs. `scenario-modern.ts` applies `overrides.json` and warns about neighbouring countries whose colours are too similar.
