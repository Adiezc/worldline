// Curved country-name placement, Paradox style.
//
// Works on a low-resolution owner grid so it can run in a Web Worker whenever borders change:
// connected components → principal axis → per-slice "most interior" points (via a distance
// transform) → least-squares parabola along the axis → quadratic Bézier.

export interface LabelCurve {
  owner: number;
  /** Quadratic Bézier control points in map pixels, ordered left to right. */
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  /** Suggested font size in map pixels. */
  size: number;
}

export interface LabelInput {
  /** Owner index per cell, 0xffff = none (ocean/unowned). */
  grid: Uint16Array;
  width: number;
  height: number;
  /** Map pixels per grid cell. */
  scale: number;
  /** Character count of each owner's display name (drives fitting). */
  nameLengths: number[];
}

const NONE = 0xffff;
const SLICES = 11;
const MAX_ANGLE = (72 * Math.PI) / 180;

export function computeLabels(input: LabelInput, onlyOwners?: Set<number>): LabelCurve[] {
  const { grid, width: W, height: H } = input;
  const comp = new Int32Array(W * H).fill(-1);
  const compOwner: number[] = [];
  const compCells: Int32Array[] = [];
  const queue = new Int32Array(W * H);

  for (let start = 0; start < W * H; start++) {
    const owner = grid[start];
    if (owner === NONE || comp[start] !== -1) continue;
    if (onlyOwners && !onlyOwners.has(owner)) continue;
    const id = compOwner.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    comp[start] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      const y = (i - x) / W;
      if (x > 0) visit(i - 1);
      if (x < W - 1) visit(i + 1);
      if (y > 0) visit(i - W);
      if (y < H - 1) visit(i + W);
    }
    compOwner.push(owner);
    compCells.push(queue.slice(0, tail));

    function visit(j: number) {
      if (comp[j] === -1 && grid[j] === owner) {
        comp[j] = id;
        queue[tail++] = j;
      }
    }
  }

  // Label each owner's largest component, plus any other component at least 35% its size.
  const byOwner = new Map<number, number[]>();
  compOwner.forEach((o, c) => {
    if (!byOwner.has(o)) byOwner.set(o, []);
    byOwner.get(o)!.push(c);
  });

  const labels: LabelCurve[] = [];
  for (const [owner, comps] of byOwner) {
    comps.sort((a, b) => compCells[b].length - compCells[a].length);
    const largest = compCells[comps[0]].length;
    for (const c of comps) {
      const n = compCells[c].length;
      if (c !== comps[0] && n < largest * 0.35) break;
      if (n < 6) continue;
      const curve = fitComponent(compCells[c], c, comp, W, H, input.nameLengths[owner] ?? 6);
      if (!curve) continue;
      const s = input.scale;
      labels.push({
        owner,
        p0: [curve.p0[0] * s, curve.p0[1] * s],
        p1: [curve.p1[0] * s, curve.p1[1] * s],
        p2: [curve.p2[0] * s, curve.p2[1] * s],
        size: curve.size * s,
      });
    }
  }
  return labels;
}

function fitComponent(cells: Int32Array, compId: number, comp: Int32Array, W: number, H: number, nameLen: number) {
  // Bounding box with a 1-cell margin so the distance transform sees the outside.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let mx = 0, my = 0;
  for (const i of cells) {
    const x = i % W, y = (i - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    mx += x;
    my += y;
  }
  const n = cells.length;
  mx = mx / n + 0.5;
  my = my / n + 0.5;
  const bx = Math.max(0, minX - 1), by = Math.max(0, minY - 1);
  const bw = Math.min(W - 1, maxX + 1) - bx + 1;
  const bh = Math.min(H - 1, maxY + 1) - by + 1;

  const inside = new Uint8Array(bw * bh);
  for (const i of cells) {
    const x = i % W, y = (i - x) / W;
    inside[(y - by) * bw + (x - bx)] = 1;
  }
  const dist = distanceTransform(inside, bw, bh);

  // Principal axis, flattened towards horizontal for readability.
  let sxx = 0, syy = 0, sxy = 0;
  for (const i of cells) {
    const x = (i % W) + 0.5 - mx, y = Math.floor(i / W) + 0.5 - my;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  let angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const tr = sxx + syy, det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const anisotropy = (tr / 2 + disc) / Math.max(1e-9, tr / 2 - disc);
  if (anisotropy < 1.6) angle = 0;
  if (angle > Math.PI / 2) angle -= Math.PI;
  if (angle < -Math.PI / 2) angle += Math.PI;
  angle = Math.max(-MAX_ANGLE, Math.min(MAX_ANGLE, angle));
  const cos = Math.cos(angle), sin = Math.sin(angle);

  // Project cells onto the axis; per slice keep the most interior cell.
  let umin = Infinity, umax = -Infinity;
  const us = new Float32Array(n), vs = new Float32Array(n), ds = new Float32Array(n);
  let maxD = 0;
  for (let k = 0; k < n; k++) {
    const i = cells[k];
    const x = (i % W) + 0.5, y = Math.floor(i / W) + 0.5;
    const d = dist[(Math.floor(y) - by) * bw + (Math.floor(x) - bx)];
    us[k] = (x - mx) * cos + (y - my) * sin;
    vs[k] = -(x - mx) * sin + (y - my) * cos;
    ds[k] = d;
    if (us[k] < umin) umin = us[k];
    if (us[k] > umax) umax = us[k];
    if (d > maxD) maxD = d;
  }
  const span = Math.max(1e-6, umax - umin);
  const best = Array.from({ length: SLICES }, () => ({ d: -1, u: 0, v: 0 }));
  for (let k = 0; k < n; k++) {
    const s = Math.min(SLICES - 1, Math.floor(((us[k] - umin) / span) * SLICES));
    if (ds[k] > best[s].d) best[s] = { d: ds[k], u: us[k], v: vs[k] };
  }

  // Longest run of slices that are thick enough to carry text.
  const thick = best.map((b) => b.d >= maxD * 0.45);
  let runStart = 0, runLen = 0;
  for (let s = 0; s < SLICES; ) {
    if (!thick[s]) { s++; continue; }
    let e = s;
    while (e < SLICES && thick[e]) e++;
    const weight = best.slice(s, e).reduce((acc, b) => acc + b.d, 0);
    const bestWeight = best.slice(runStart, runStart + runLen).reduce((acc, b) => acc + b.d, 0);
    if (weight > bestWeight) { runStart = s; runLen = e - s; }
    s = e;
  }
  const pts = best.slice(runStart, runStart + runLen).filter((b) => b.d > 0);
  if (pts.length === 0) return null;

  let u0 = pts[0].u, u1 = pts[pts.length - 1].u;
  // Extend single/short runs symmetrically so tiny countries still get a sensible baseline.
  const minLen = Math.min(span * 0.6, maxD * 3);
  if (u1 - u0 < minLen) {
    const c = (u0 + u1) / 2;
    u0 = c - minLen / 2;
    u1 = c + minLen / 2;
  }
  const pad = (u1 - u0) * 0.06;
  u0 += pad;
  u1 -= pad;

  // Weighted least squares v = a u² + b u + c (falls back to linear / constant).
  const [a0, b0, c0] = fitParabola(pts);
  const len = u1 - u0;
  // Limit bend: sagitta ≤ 18% of the length.
  const maxA = (0.18 * len) / Math.max(1e-6, (len / 2) ** 2);
  const a = Math.max(-maxA, Math.min(maxA, a0));
  const vAt = (u: number) => a * u * u + b0 * u + c0;
  const um = (u0 + u1) / 2;

  const toXY = (u: number, v: number): [number, number] => [mx + u * cos - v * sin, my + u * sin + v * cos];
  let p0 = toXY(u0, vAt(u0));
  let p2 = toXY(u1, vAt(u1));
  const m = toXY(um, vAt(um));
  const p1: [number, number] = [2 * m[0] - (p0[0] + p2[0]) / 2, 2 * m[1] - (p0[1] + p2[1]) / 2];
  if (p0[0] > p2[0]) [p0, p2] = [p2, p0];

  const medianD = pts.map((p) => p.d).sort((x, y) => x - y)[Math.floor(pts.length / 2)];
  const sizeFor = (length: number, d: number) => Math.max(0.6, Math.min((length * 0.95) / Math.max(1, nameLen * 0.92), d * 1.55));

  // The baseline must stay inside the shape; otherwise fall back to a straight horizontal
  // run through the most interior cell.
  const insideAt = (x: number, y: number) => {
    const cx = Math.floor(x), cy = Math.floor(y);
    return cx >= 0 && cy >= 0 && cx < W && cy < H && comp[cy * W + cx] === compId;
  };
  let hits = 0;
  for (let k = 0; k <= 8; k++) {
    const t = k / 8, s = 1 - t;
    if (insideAt(s * s * p0[0] + 2 * s * t * p1[0] + t * t * p2[0], s * s * p0[1] + 2 * s * t * p1[1] + t * t * p2[1])) hits++;
  }
  if (hits >= 8) return { p0, p1, p2, size: sizeFor(len, medianD) };

  let bestI = 0;
  for (let i = 0; i < dist.length; i++) if (dist[i] > dist[bestI]) bestI = i;
  const ix = (bestI % bw) + bx, iy = Math.floor(bestI / bw) + by;
  let l = ix, r = ix;
  while (insideAt(l - 1 + 0.5, iy + 0.5)) l--;
  while (insideAt(r + 1 + 0.5, iy + 0.5)) r++;
  const flatLen = (r - l + 1) * 0.9;
  const cxm = (l + r + 1) / 2, cym = iy + 0.5;
  return {
    p0: [cxm - flatLen / 2, cym] as [number, number],
    p1: [cxm, cym] as [number, number],
    p2: [cxm + flatLen / 2, cym] as [number, number],
    size: sizeFor(flatLen, dist[bestI]),
  };
}

function fitParabola(pts: { u: number; v: number; d: number }[]): [number, number, number] {
  if (pts.length === 1) return [0, 0, pts[0].v];
  if (pts.length === 2) {
    const [p, q] = pts;
    const b = (q.v - p.v) / Math.max(1e-6, q.u - p.u);
    return [0, b, p.v - b * p.u];
  }
  // Normal equations for weights w = d.
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, t0 = 0, t1 = 0, t2 = 0;
  for (const p of pts) {
    const w = p.d, u = p.u, u2 = u * u;
    s0 += w; s1 += w * u; s2 += w * u2; s3 += w * u2 * u; s4 += w * u2 * u2;
    t0 += w * p.v; t1 += w * p.v * u; t2 += w * p.v * u2;
  }
  const m = [
    [s4, s3, s2],
    [s3, s2, s1],
    [s2, s1, s0],
  ];
  const sol = solve3(m, [t2, t1, t0]);
  return sol ?? [0, 0, t0 / s0];
}

function solve3(m: number[][], r: number[]): [number, number, number] | null {
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const d = det(m);
  if (Math.abs(d) < 1e-9) return null;
  const col = (k: number) => m.map((row, i) => row.map((v, j) => (j === k ? r[i] : v)));
  return [det(col(0)) / d, det(col(1)) / d, det(col(2)) / d];
}

/** Exact Euclidean distance (in cells) from each inside cell to the nearest outside cell. */
export function distanceTransform(inside: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float64Array(Math.max(w, h));
  const out = new Float32Array(w * h);
  const tmp = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) tmp[i] = inside[i] ? INF : 0;
  const d = new Float64Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float64Array(Math.max(w, h) + 1);
  const edt1d = (n: number) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = tmp[y * w + x];
    edt1d(h);
    for (let y = 0; y < h; y++) tmp[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = tmp[y * w + x];
    edt1d(w);
    for (let x = 0; x < w; x++) out[y * w + x] = Math.sqrt(d[x]);
  }
  return out;
}
