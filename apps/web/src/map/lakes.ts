// Lakes from mapgen (lakes.mesh.bin, see tools/mapgen/src/lakes.ts): triangles of water drawn over
// the land. The province bitmap still has land under them, so picking asks this index first and
// treats a lake like the sea.

import { BORDER_QUANT } from "@worldline/shared";

const LAKE_MAGIC = 0x314b4c57; // "WLK1"
/** Spatial index cell size in map px. */
const CELL = 32;

export interface LakeMesh {
  /** Map px × BORDER_QUANT, interleaved x, y. */
  positions: Uint16Array;
  indices: Uint32Array;
}

export function parseLakes(buf: ArrayBuffer): LakeMesh {
  const head = new Uint32Array(buf, 0, 4);
  if (head[0] !== LAKE_MAGIC) throw new Error("lakes.mesh.bin: bad header");
  const V = head[1], I = head[2];
  const posBytes = V * 4, pad = (4 - ((16 + posBytes) % 4)) % 4;
  return { positions: new Uint16Array(buf, 16, V * 2), indices: new Uint32Array(buf, 16 + posBytes + pad, I) };
}

/** Point-in-lake lookups over a coarse grid of the triangles each cell touches. */
export class LakeIndex {
  private cells = new Map<number, number[]>();
  private cols: number;

  constructor(private mesh: LakeMesh, mapW: number) {
    this.cols = Math.ceil(mapW / CELL);
    const { indices } = mesh;
    for (let t = 0; t < indices.length; t += 3) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        const [x, y] = this.vertex(indices[t + k]);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
          const key = cy * this.cols + cx;
          const list = this.cells.get(key);
          if (list) list.push(t);
          else this.cells.set(key, [t]);
        }
      }
    }
  }

  private vertex(i: number): [number, number] {
    return [this.mesh.positions[i * 2] / BORDER_QUANT, this.mesh.positions[i * 2 + 1] / BORDER_QUANT];
  }

  /** Whether map point (x, y) lies on a lake. */
  contains(x: number, y: number) {
    const list = this.cells.get(Math.floor(y / CELL) * this.cols + Math.floor(x / CELL));
    if (!list) return false;
    const { indices } = this.mesh;
    for (const t of list) {
      const [ax, ay] = this.vertex(indices[t]), [bx, by] = this.vertex(indices[t + 1]), [cx, cy] = this.vertex(indices[t + 2]);
      const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
      const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
      const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
      const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) return true;
    }
    return false;
  }
}
