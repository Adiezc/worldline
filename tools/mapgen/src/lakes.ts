// Lakes: Natural Earth lake outlines → a triangulated water mesh drawn over the land.
// Usage: bun run src/lakes.ts   (expects data/raw/lakes/ne_10m_lakes.geojson, see README)
//
// Admin-1 polygons run out to borders in the middle of lakes (the Great Lakes are split between
// US states and Canadian provinces), so the province map paints them as land. Rather than cutting
// the lakes out of the provinces, which would renumber them and break every scenario's ownership
// arrays, lakes are a separate layer: the client draws this mesh as water and treats it as sea
// for picking. Province ids, adjacency and gameplay stay exactly as they are.
//
// Layout: u32 magic "WLK1", u32 vertexCount, u32 indexCount, u32 reserved;
//         u16[2·V] positions in map px × BORDER_QUANT; (pad to 4) u32[I] indices.

import earcut from "earcut";
import { join } from "node:path";
import { BORDER_QUANT, project } from "@worldline/shared";

const ROOT = join(import.meta.dir, "..", "..", "..");
const SRC = join(import.meta.dir, "..", "data", "raw", "lakes", "ne_10m_lakes.geojson");
const OUT = join(ROOT, "packages", "mapdata", "public", "map", "lakes.mesh.bin");

/** Natural Earth importance: 0 = the largest lakes. Finer ones would be specks at world scale. */
const MAX_SCALERANK = 5;
/** Lakes smaller than this (map px², about 30 km² near the equator per px) are dropped. */
const MIN_AREA_PX = 3;
/** Outline simplification tolerance in map px; the mesh takes over above ~1.25 device px per map px. */
const SIMPLIFY_PX = 0.15;
const CLASSES = new Set(["Lake", "Alkaline Lake", "Reservoir"]);

type Ring = [number, number][];
interface Feat { properties: { featurecla: string; scalerank: number; name?: string }; geometry: { type: string; coordinates: any } }

const data = (await Bun.file(SRC).json()) as { features: Feat[] };

/** Douglas–Peucker on a closed ring (first point kept, closing point dropped). */
function simplify(ring: Ring, tol: number): Ring {
  const pts = ring.slice(0, -1);
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    let far = -1, best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
      if (d > best) { best = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const area = (r: Ring) => {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(s) / 2;
};

const xs: number[] = [], indices: number[] = [];
let kept = 0;
for (const f of data.features) {
  const p = f.properties;
  if (!CLASSES.has(p.featurecla) || p.scalerank > MAX_SCALERANK) continue;
  const polys: [number, number][][][] = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [];
  for (const poly of polys) {
    const rings = poly.map((ring) => simplify(ring.map(([lon, lat]) => project(lon, lat)), SIMPLIFY_PX));
    if (rings[0].length < 3 || area(rings[0]) < MIN_AREA_PX) continue;
    // Islands in a lake are holes; tiny ones vanish at this scale.
    const parts = [rings[0], ...rings.slice(1).filter((r) => r.length >= 3 && area(r) >= MIN_AREA_PX / 4)];
    const flat: number[] = [], holes: number[] = [];
    parts.forEach((r, k) => {
      if (k > 0) holes.push(flat.length / 2);
      for (const [x, y] of r) flat.push(x, y);
    });
    const tri = earcut(flat, holes.length ? holes : undefined, 2);
    const base = xs.length / 2;
    for (let i = 0; i < flat.length; i++) xs.push(Math.max(0, Math.min(65535, Math.round(flat[i] * BORDER_QUANT))));
    for (const t of tri) indices.push(base + t);
    kept++;
  }
}

const V = xs.length / 2, I = indices.length;
const posBytes = V * 4, pad = (4 - ((16 + posBytes) % 4)) % 4;
const buf = new ArrayBuffer(16 + posBytes + pad + I * 4);
const head = new Uint32Array(buf, 0, 4);
head[0] = 0x314b4c57; // "WLK1"
head[1] = V;
head[2] = I;
new Uint16Array(buf, 16, V * 2).set(xs);
new Uint32Array(buf, 16 + posBytes + pad, I).set(indices);
await Bun.write(OUT, new Uint8Array(buf));
console.log(`lakes: ${kept} polygons, ${V} vertices, ${I / 3} triangles, ${(buf.byteLength / 1024).toFixed(0)} KB → ${OUT}`);
