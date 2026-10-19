// Offline map pipeline: Natural Earth admin-1 → province bitmap + metadata + border arcs.
// Usage: bun run src/build.ts   (expects data/raw/*.geojson, see README)

import { topology } from "topojson-server";
import { feature, merge } from "topojson-client";
import earcut from "earcut";
import { presimplify, simplify, planarTriangleArea } from "topojson-simplify";
import { geoArea, geoCentroid, geoDistance } from "d3-geo";
import { encode } from "fast-png";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  MAP_W,
  MAP_H,
  BORDER_QUANT,
  project,
  distanceTransform,
  type ProvinceMeta,
  type BorderArc,
} from "@worldline/shared";

const ROOT = join(import.meta.dir, "..", "..", "..");
const RAW = join(import.meta.dir, "..", "data", "raw");
const OUT = join(ROOT, "packages", "mapdata", "public", "map");

/** Regions smaller than this are merged with neighbours in the same constituent unit. */
const MIN_AREA_KM2 = 6000;
/** Merging never produces a province larger than this. */
const MAX_MERGED_KM2 = 30000;
const EARTH_R = 6371;

// Natural Earth sovereignty codes that differ from the sovereign's own admin-0 code.
const SOV_TO_ADM0: Record<string, string> = {
  GB1: "GBR", FR1: "FRA", NL1: "NLD", US1: "USA", DN1: "DNK", AU1: "AUS",
  NZ1: "NZL", CH1: "CHN", FI1: "FIN", KA1: "KAZ", CU1: "CUB",
};
// De facto entities kept as their own polity even though NE lists another sovereign.
const KEEP_SEPARATE = new Set(["PSX"]);
const OWNER_OVERRIDES: Record<string, string> = {
  USG: "USA", // Guantanamo Bay
  SAH: "MAR", // Western Sahara: de facto Moroccan administration over most of the territory
};

type Props = Record<string, any>;
interface Feat { type: "Feature"; properties: Props; geometry: any }

const t0 = performance.now();
const log = (...a: unknown[]) => console.log(`[${((performance.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const adm1 = (await Bun.file(join(RAW, "ne_10m_admin_1_states_provinces.geojson")).json()) as { features: Feat[] };
const adm0 = (await Bun.file(join(RAW, "ne_10m_admin_0_countries.geojson")).json()) as { features: Feat[] };

const feats = adm1.features.filter((f) => f.geometry && f.properties.adm0_a3 !== "ATA");
log("admin-1 features", feats.length);

const ownerOf = (p: Props): string => {
  const a = p.adm0_a3 as string;
  if (OWNER_OVERRIDES[a]) return OWNER_OVERRIDES[a];
  if (KEEP_SEPARATE.has(a)) return a;
  const sov = p.sov_a3 as string;
  return SOV_TO_ADM0[sov] ?? sov ?? a;
};

// ---------------------------------------------------------------------------
// Topology: snaps shared edges and gives feature adjacency for free.
const topo: any = topology({ provinces: { type: "FeatureCollection", features: feats } as any }, 1e6);
const geoms: any[] = topo.objects.provinces.geometries;
const snapped = (feature(topo, topo.objects.provinces) as any).features as Feat[];

const arcOwners: number[][] = Array.from({ length: topo.arcs.length }, () => []);
const walkArcs = (g: any, fn: (arc: number) => void) => {
  const polys = g.type === "Polygon" ? [g.arcs] : g.type === "MultiPolygon" ? g.arcs : [];
  for (const poly of polys) for (const ring of poly) for (const a of ring) fn(a < 0 ? ~a : a);
};
geoms.forEach((g, i) => walkArcs(g, (a) => { if (!arcOwners[a].includes(i)) arcOwners[a].push(i); }));

const featNeighbors: Set<number>[] = feats.map(() => new Set());
for (const owners of arcOwners) {
  if (owners.length === 2) {
    featNeighbors[owners[0]].add(owners[1]);
    featNeighbors[owners[1]].add(owners[0]);
  }
}

const featArea = snapped.map((f) => {
  let a = geoArea(f as any);
  if (a > 2 * Math.PI) a = 4 * Math.PI - a; // ring winding opposite to d3's convention
  return a * EARTH_R * EARTH_R;
});
const featCentroid = snapped.map((f) => geoCentroid(f as any));
const groupOf = (i: number) => `${feats[i].properties.adm0_a3}|${feats[i].properties.geonunit || ""}`;

// ---------------------------------------------------------------------------
// Merge tiny regions (e.g. UK unitary authorities, Slovene municipalities) within each
// constituent unit, preferring partners from the same NE "region".
interface Cluster { id: number; members: number[]; area: number; regions: Set<string>; group: string; centroid: [number, number]; stuck: boolean }
const parent = feats.map((_, i) => i);
const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
const clusters = new Map<number, Cluster>();
feats.forEach((f, i) => clusters.set(i, {
  id: i, members: [i], area: featArea[i], regions: new Set([f.properties.region || ""]),
  group: groupOf(i), centroid: featCentroid[i] as [number, number], stuck: false,
}));

const clusterNeighbors = (c: Cluster) => {
  const out = new Set<number>();
  for (const m of c.members) for (const n of featNeighbors[m]) {
    const r = find(n);
    if (r !== c.id) out.add(r);
  }
  return out;
};

for (;;) {
  let c: Cluster | undefined;
  for (const k of clusters.values()) if (!k.stuck && k.area < MIN_AREA_KM2 && (!c || k.area < c.area)) c = k;
  if (!c) break;
  const fits = (o: Cluster) => o.group === c!.group && o.area + c!.area <= MAX_MERGED_KM2;
  let options = [...clusterNeighbors(c)].map((r) => clusters.get(r)!).filter(fits);
  if (options.length === 0 && c.area < MIN_AREA_KM2 * 0.5) {
    // Islands: attach to the nearest cluster in the same unit within ~500 km.
    options = [...clusters.values()]
      .filter((o) => o.id !== c!.id && fits(o) && geoDistance(o.centroid, c!.centroid) * EARTH_R < 500)
      .sort((a, b) => geoDistance(a.centroid, c!.centroid) - geoDistance(b.centroid, c!.centroid))
      .slice(0, 1);
  }
  if (options.length === 0) { c.stuck = true; continue; }
  const shares = (o: Cluster) => [...o.regions].some((r) => r && c!.regions.has(r));
  options.sort((a, b) => Number(shares(b)) - Number(shares(a)) || a.area - b.area);
  const into = options[0];
  for (const m of c.members) parent[m] = into.id;
  into.members.push(...c.members);
  const w = into.area + c.area;
  into.centroid = [
    (into.centroid[0] * into.area + c.centroid[0] * c.area) / w,
    (into.centroid[1] * into.area + c.centroid[1] * c.area) / w,
  ];
  into.area = w;
  for (const r of c.regions) into.regions.add(r);
  into.stuck = false;
  clusters.delete(c.id);
}
for (let i = 0; i < feats.length; i++) find(i);
log("provinces after merging", clusters.size);

// Stable ids: order by owner, then west→east so ids are human-browsable.
const ordered = [...clusters.values()].sort((a, b) => {
  const oa = ownerOf(feats[a.members[0]].properties), ob = ownerOf(feats[b.members[0]].properties);
  return oa < ob ? -1 : oa > ob ? 1 : a.centroid[0] - b.centroid[0];
});
if (ordered.length >= 0xffff) throw new Error("too many provinces for 16-bit ids");
const provinceOfCluster = new Map<number, number>();
ordered.forEach((c, i) => provinceOfCluster.set(c.id, i + 1));
const provinceOfFeat = feats.map((_, i) => provinceOfCluster.get(find(i))!);

const regionUse = new Map<string, number>();
for (const c of ordered) if (c.regions.size === 1) {
  const r = [...c.regions][0];
  if (r) regionUse.set(`${c.group}|${r}`, (regionUse.get(`${c.group}|${r}`) ?? 0) + 1);
}
const provinceName = (c: Cluster) => {
  const largest = c.members.reduce((a, b) => (featArea[b] > featArea[a] ? b : a));
  const r = [...c.regions][0];
  if (c.members.length > 1 && c.regions.size === 1 && r && regionUse.get(`${c.group}|${r}`) === 1) return r;
  return feats[largest].properties.name ?? feats[largest].properties.name_en ?? "Unnamed";
};

// ---------------------------------------------------------------------------
// Rasterise: even-odd scanline fill sampled at pixel centres. Shared edges are identical
// after topology snapping, so adjacent provinces tile with no gaps or overlaps.
const ids = new Uint16Array(MAP_W * MAP_H);

function fill(geom: any, id: number) {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.type === "MultiPolygon" ? geom.coordinates : [];
  for (const poly of polys) {
    const rows = new Map<number, number[]>();
    for (const ring of poly) {
      const pts = ring.map(([lon, lat]: [number, number]) => project(lon, lat));
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        if (y0 === y1) continue;
        const ylo = Math.min(y0, y1), yhi = Math.max(y0, y1);
        const r0 = Math.max(0, Math.ceil(ylo - 0.5)), r1 = Math.min(MAP_H - 1, Math.ceil(yhi - 0.5) - 1);
        for (let r = r0; r <= r1; r++) {
          const yc = r + 0.5;
          let xs = rows.get(r);
          if (!xs) rows.set(r, (xs = []));
          xs.push(x0 + ((yc - y0) * (x1 - x0)) / (y1 - y0));
        }
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      const base = r * MAP_W;
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const s = Math.max(0, Math.ceil(xs[k] - 0.5)), e = Math.min(MAP_W, Math.ceil(xs[k + 1] - 0.5));
        for (let x = s; x < e; x++) ids[base + x] = id;
      }
    }
  }
}
snapped.forEach((f, i) => fill(f.geometry, provinceOfFeat[i]));
log("rasterised");

// Provinces too small to cover a pixel centre get stamped at their label point.
const pixels = new Uint32Array(ordered.length + 1);
for (let i = 0; i < ids.length; i++) pixels[ids[i]]++;
let stamped = 0;
ordered.forEach((c, k) => {
  const pid = k + 1;
  if (pixels[pid] > 0) return;
  const p = feats[c.members[0]].properties;
  const [x, y] = project(p.longitude ?? c.centroid[0], p.latitude ?? c.centroid[1]);
  outer: for (let r = 0; r <= 3; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const px = Math.floor(x) + dx, py = Math.floor(y) + dy;
    if (px < 0 || py < 0 || px >= MAP_W || py >= MAP_H) continue;
    if (ids[py * MAP_W + px] === 0) { ids[py * MAP_W + px] = pid; pixels[pid]++; stamped++; break outer; }
  }
  if (pixels[pid] === 0) {
    // Landlocked enclave (Vatican, San Marino): take the centre pixel from the surrounding province.
    const i = Math.floor(y) * MAP_W + Math.floor(x);
    pixels[ids[i]]--;
    ids[i] = pid;
    pixels[pid]++;
    stamped++;
  }
});
log("stamped tiny provinces", stamped);

// ---------------------------------------------------------------------------
// Per-province stats and adjacency from the raster (wrapping across the antimeridian).
const sumX = new Float64Array(ordered.length + 1), sumY = new Float64Array(ordered.length + 1);
const coastal = new Uint8Array(ordered.length + 1);
const adj = new Set<number>();
const link = (a: number, b: number) => {
  if (a === b) return;
  if (a === 0 || b === 0) { coastal[a || b] = 1; return; }
  adj.add(a < b ? a * 65536 + b : b * 65536 + a);
};
for (let y = 0; y < MAP_H; y++) {
  for (let x = 0; x < MAP_W; x++) {
    const i = y * MAP_W + x, a = ids[i];
    if (a) { sumX[a] += x + 0.5; sumY[a] += y + 0.5; }
    link(a, ids[y * MAP_W + ((x + 1) % MAP_W)]);
    if (y + 1 < MAP_H) link(a, ids[i + MAP_W]);
  }
}
const neighbors: Set<number>[] = Array.from({ length: ordered.length + 1 }, () => new Set());
for (const key of adj) {
  const a = Math.floor(key / 65536), b = key % 65536;
  neighbors[a].add(b);
  neighbors[b].add(a);
}
// Topological adjacency catches neighbours whose shared edge is thinner than a pixel.
feats.forEach((_, i) => {
  for (const n of featNeighbors[i]) {
    const a = provinceOfFeat[i], b = provinceOfFeat[n];
    if (a !== b) { neighbors[a].add(b); neighbors[b].add(a); }
  }
});

const provinces: ProvinceMeta[] = ordered.map((c, k) => {
  const id = k + 1;
  const p = feats[c.members[0]].properties;
  const [fx, fy] = project(c.centroid[0], c.centroid[1]);
  return {
    id,
    name: provinceName(c),
    adm0: p.adm0_a3,
    unit: p.geonunit || p.admin,
    defaultOwner: ownerOf(p),
    cx: pixels[id] ? Math.round((sumX[id] / pixels[id]) * 10) / 10 : Math.round(fx * 10) / 10,
    cy: pixels[id] ? Math.round((sumY[id] / pixels[id]) * 10) / 10 : Math.round(fy * 10) / 10,
    areaKm2: Math.round(c.area),
    pixels: pixels[id],
    coastal: coastal[id] === 1,
    neighbors: [...neighbors[id]].sort((a, b) => a - b),
  };
});

// ---------------------------------------------------------------------------
// Coast distance field (quarter resolution): <128 ocean depth, >128 inland distance.
const CW = MAP_W / 4, CH = MAP_H / 4;
const land = new Uint8Array(CW * CH), sea = new Uint8Array(CW * CH);
for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
  const isLand = ids[(y * 4 + 2) * MAP_W + x * 4 + 2] !== 0;
  land[y * CW + x] = isLand ? 1 : 0;
  sea[y * CW + x] = isLand ? 0 : 1;
}
const dLand = distanceTransform(land, CW, CH), dSea = distanceTransform(sea, CW, CH);
const coast = new Uint8Array(CW * CH);
for (let i = 0; i < coast.length; i++) {
  coast[i] = land[i] ? 128 + Math.min(127, Math.round(dLand[i] * 6)) : 127 - Math.min(127, Math.round(dSea[i] * 6));
}
log("coast field");

// ---------------------------------------------------------------------------
// Border arcs: simplified shared edges, tagged with the province on each side.
const simple: any = simplify(presimplify(topo, planarTriangleArea), 1.5e-4);
const decodeArc = (arc: number[][]): [number, number][] => {
  if (!simple.transform) return arc.map((p) => [p[0], p[1]]);
  const { scale: [kx, ky], translate: [tx, ty] } = simple.transform;
  let x = 0, y = 0;
  return arc.map((p) => { x += p[0]; y += p[1]; return [x * kx + tx, y * ky + ty]; });
};
const arcs: BorderArc[] = [];
simple.arcs.forEach((arc: number[][], ai: number) => {
  const owners = arcOwners[ai];
  if (owners.length === 0) return;
  const a = provinceOfFeat[owners[0]], b = owners.length > 1 ? provinceOfFeat[owners[1]] : 0;
  if (a === b) return; // internal to a merged province
  const lonlat = decodeArc(arc);
  if (b === 0 && lonlat.every(([lon]) => Math.abs(lon) > 179.99)) return; // antimeridian cut
  const pts: number[] = [];
  for (const [lon, lat] of lonlat) {
    const [x, y] = project(lon, lat);
    const qx = Math.round(x * BORDER_QUANT), qy = Math.round(y * BORDER_QUANT);
    const n = pts.length;
    if (n >= 2 && pts[n - 2] === qx && pts[n - 1] === qy) continue;
    pts.push(qx, qy);
  }
  if (pts.length >= 4) arcs.push({ a: Math.min(a, b) === 0 ? Math.max(a, b) : a, b, pts });
});
log("border arcs", arcs.length, "points", arcs.reduce((s, a) => s + a.pts.length / 2, 0));

// ---------------------------------------------------------------------------
// Country base names (era-agnostic list of modern polities appearing as owners).
const adm0Props = new Map<string, Props>();
for (const f of adm0.features) {
  const p = f.properties;
  adm0Props.set(p.ADM0_A3 ?? p.adm0_a3, p);
}
const ownerTags = [...new Set(provinces.map((p) => p.defaultOwner))].sort();
const countriesBase = ownerTags.map((tag) => {
  const p = adm0Props.get(tag);
  const fallback = feats.find((f) => f.properties.adm0_a3 === tag)?.properties.admin ?? tag;
  return { tag, name: (p?.NAME ?? p?.name ?? fallback) as string, longName: (p?.NAME_LONG ?? fallback) as string };
});

await mkdir(OUT, { recursive: true });
await Bun.write(join(OUT, "provinces.png"), encode({ width: MAP_W, height: MAP_H, data: ids, depth: 16, channels: 1 }));
await Bun.write(join(OUT, "coast.png"), encode({ width: CW, height: CH, data: coast, depth: 8, channels: 1 }));
await Bun.write(join(OUT, "provinces.json"), JSON.stringify({ width: MAP_W, height: MAP_H, provinces }));
await Bun.write(join(OUT, "borders.json"), JSON.stringify({ arcs }));
await Bun.write(join(OUT, "provinces.mesh.bin"), buildMesh());
await Bun.write(join(OUT, "countries.base.json"), JSON.stringify(countriesBase, null, 1));

// Sanity checks.
const problems: string[] = [];
for (const p of provinces) {
  for (const n of p.neighbors) if (!provinces[n - 1].neighbors.includes(p.id)) problems.push(`asymmetric adjacency ${p.id}-${n}`);
  if (p.pixels === 0) problems.push(`province ${p.id} ${p.name} has no pixels`);
}
for (const tag of ownerTags) if (!provinces.some((p) => p.defaultOwner === tag)) problems.push(`owner ${tag} has no provinces`);
log(`wrote ${provinces.length} provinces, ${ownerTags.length} owners → ${OUT}`);
if (problems.length) {
  console.warn(`${problems.length} sanity problems:\n` + problems.slice(0, 20).join("\n"));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Province mesh: each province's merged outline from the same simplified topology as the border
// arcs, triangulated, so the client can draw crisp vector fills when zoomed in (the raster
// province bitmap looks soft once a texel covers many screen pixels).
// Layout: u32 magic "WLM1", u32 vertexCount, u32 indexCount, u32 reserved;
//         u16[2·V] positions in map px × BORDER_QUANT; u16[V] province ids; (pad to 4) u32[I] indices.
function buildMesh() {
  const xs: number[] = [], ids: number[] = [], indices: number[] = [];
  const geometries = simple.objects.provinces.geometries;
  ordered.forEach((c, k) => {
    const pid = k + 1;
    const merged: any = merge(simple, c.members.map((m) => geometries[m]));
    const polys: number[][][][] = merged.type === "Polygon" ? [merged.coordinates] : merged.coordinates ?? [];
    for (const poly of polys) {
      const flat: number[] = [], holes: number[] = [];
      poly.forEach((ring, r) => {
        if (r > 0) holes.push(flat.length / 2);
        // Drop the closing point; earcut wants open rings.
        for (const [lon, lat] of ring.slice(0, -1)) flat.push(...project(lon, lat));
      });
      if (flat.length < 6) continue;
      const tri = earcut(flat, holes.length ? holes : undefined, 2);
      const base = xs.length / 2;
      for (let i = 0; i < flat.length; i += 2) {
        xs.push(Math.max(0, Math.min(65535, Math.round(flat[i] * BORDER_QUANT))), Math.max(0, Math.min(65535, Math.round(flat[i + 1] * BORDER_QUANT))));
        ids.push(pid);
      }
      for (const t of tri) indices.push(base + t);
    }
  });
  const V = ids.length, I = indices.length;
  const posBytes = V * 4, idBytes = V * 2, pad = (4 - ((16 + posBytes + idBytes) % 4)) % 4;
  const buf = new ArrayBuffer(16 + posBytes + idBytes + pad + I * 4);
  const head = new Uint32Array(buf, 0, 4);
  head[0] = 0x314d4c57; // "WLM1"
  head[1] = V;
  head[2] = I;
  new Uint16Array(buf, 16, V * 2).set(xs);
  new Uint16Array(buf, 16 + posBytes, V).set(ids);
  new Uint32Array(buf, 16 + posBytes + idBytes + pad, I).set(indices);
  log(`province mesh: ${V} vertices, ${I / 3} triangles, ${(buf.byteLength / 1e6).toFixed(1)} MB`);
  return new Uint8Array(buf);
}
