import type { MapMeta } from "../map/types.ts";

/** Lightweight view of the base map the rules engine needs (adjacency, coasts, names). */
export interface MapIndex {
  count: number;
  neighbors: number[][];
  coastal: boolean[];
  names: string[];
  area: number[];
  /** Province centroids in map pixels (for naval reach). */
  cx: number[];
  cy: number[];
  width: number;
}

export function buildMapIndex(meta: MapMeta): MapIndex {
  const count = meta.provinces.length;
  const neighbors: number[][] = [[]];
  const coastal = [false];
  const names = [""];
  const area = [0];
  const cx = [0];
  const cy = [0];
  for (const p of meta.provinces) {
    cx[p.id] = p.cx;
    cy[p.id] = p.cy;
    neighbors[p.id] = p.neighbors;
    coastal[p.id] = p.coastal;
    names[p.id] = p.name;
    area[p.id] = p.areaKm2;
  }
  return { count, neighbors, coastal, names, area, cx, cy, width: meta.width };
}

/** Country-level land adjacency derived from province ownership. */
export function countryAdjacency(owners: number[], map: MapIndex) {
  const adj = new Map<number, Set<number>>();
  for (let id = 1; id <= map.count; id++) {
    const a = owners[id];
    if (a < 0) continue;
    for (const n of map.neighbors[id]) {
      const b = owners[n];
      if (b < 0 || b === a) continue;
      if (!adj.has(a)) adj.set(a, new Set());
      adj.get(a)!.add(b);
    }
  }
  return adj;
}
