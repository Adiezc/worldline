# Map pipeline

The generated map files in `packages/mapdata` and the scenario seeds in `packages/scenarios` are committed, so you only need this if you change `tools/mapgen`.

## Source data

All source data is from [Natural Earth](https://www.naturalearthdata.com) and is in the public domain. It goes in `tools/mapgen/data/raw/`, which is git-ignored.

Countries and provinces:

```bash
mkdir -p tools/mapgen/data/raw && cd tools/mapgen/data/raw && for f in ne_10m_admin_1_states_provinces ne_10m_admin_0_countries; do curl -sSLO "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/$f.geojson"; done
```

Lakes (1:10m):

```bash
mkdir -p tools/mapgen/data/raw/lakes && curl -sSL -o tools/mapgen/data/raw/lakes/ne_10m_lakes.geojson https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_lakes.geojson
```

Shaded relief (1:50m):

```bash
mkdir -p tools/mapgen/data/raw/relief && cd tools/mapgen/data/raw/relief && curl -sSLO https://naciscdn.org/naturalearth/50m/raster/SR_50M.zip && unzip -o SR_50M.zip
```

## Build

```bash
bun run mapgen
```

The steps, in order:

- **`build.ts`** merges tiny admin-1 units within each constituent unit (minimum 6,000 km², maximum 30,000 km² after merging) and rasterises 16-bit province ids at 8192×4096. It writes adjacency, a coast distance field, simplified border arcs and a triangulated province mesh (`provinces.mesh.bin`) from the same simplified outlines. The client fills land from the bitmap when zoomed out and from the mesh when zoomed in, so close-ups stay sharp. The server gzips the mesh and other large assets when serving the built client.
- **`lakes.ts`** turns the lakes into `lakes.mesh.bin`, drawn as water over the land, so province ids are untouched.
- **`relief.ts`** converts the shaded relief into the terrain texture `relief.png`.
- **`scenario-modern.ts`** applies `packages/scenarios/modern-2026/overrides.json` (names, colours, occupations) and warns about neighbouring countries whose colours are too similar.
- **`scenario-seed.ts`** builds `seed.json`: World Bank stats (cached), leaders, agendas, organisations, treaties, wars, sanctions, relations, the 2026 calendar, the world brief and formable nations.
- **`scenario-coldwar.ts`** builds the 1962 scenario.
