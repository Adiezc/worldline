// Battle-plan arrows, drawn on the label canvas under the troop counters: a tapered ribbon in the
// attacking country's colour with an ink outline (the same language as the counters), its name
// set along the shaft like a map label. Hold lines are drawn by the WebGL renderer along the
// borders they cover.
import type { Camera } from "./renderer.ts";

export type ArrowStyle = "plan" | "draft" | "ally" | "result";

export interface OperationArrow {
  id: string;
  /** Map px points along the route (jump-off first), unwrapped so consecutive points are close. */
  points: [number, number][];
  style: ArrowStyle;
  /** Map colour of the attacking country, "#rrggbb". */
  color: string;
  /** For results: index of the furthest point the offensive reached (0 = no gain). */
  reached?: number;
  /** Set along the shaft, e.g. "Operation Downfall". */
  name?: string;
  /** Short note after the name, e.g. "All-out" or "+3". */
  detail?: string;
}

const INK = "#1b130e";
const TEXT_INK = "rgba(28, 22, 16, 0.88)";
const HALO = "rgba(238, 228, 202, 0.88)";
/** Fill opacity per style; drafts and allies' plans sit back a little. */
const ALPHA: Record<ArrowStyle, number> = { plan: 0.9, draft: 0.55, ally: 0.75, result: 0.9 };

export class OperationLayer {
  private ctx: CanvasRenderingContext2D;
  private arrows: OperationArrow[] = [];
  private font = "Cinzel";

  constructor(readonly canvas: HTMLCanvasElement, private mapW = 8192) {
    this.ctx = canvas.getContext("2d")!;
  }

  set(arrows: OperationArrow[], mapW: number) {
    this.arrows = arrows;
    this.mapW = mapW;
  }

  setFont(font: string) {
    this.font = font;
  }

  get empty() {
    return this.arrows.length === 0;
  }

  draw(cam: Camera) {
    if (!this.arrows.length) return;
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Body width in CSS px grows gently with zoom: a pencil line on the world map, a ribbon up
    // close, never a slab.
    const w = Math.max(3, Math.min(12, 7 * Math.sqrt(Math.max(0.01, cam.zoom) / 0.5)));
    const halfW = W / 2 / cam.zoom;
    for (const a of this.arrows) {
      if (a.points.length < 2) continue;
      const xs = a.points.map((p) => p[0]);
      const minX = Math.min(...xs), maxX = Math.max(...xs);
      for (const off of [-this.mapW, 0, this.mapW]) {
        if (maxX + off < cam.cx - halfW - 300 || minX + off > cam.cx + halfW + 300) continue;
        const pts = a.points.map(([x, y]) => [(x + off - cam.cx) * cam.zoom + W / 2, (y - cam.cy) * cam.zoom + H / 2] as [number, number]);
        this.drawArrow(a, pts, w);
      }
    }
  }

  private drawArrow(a: OperationArrow, pts: [number, number][], w: number) {
    const shape = arrowShape(pts, w);
    if (!shape) return;
    const fill = shade(a.color, 0.8);
    let labelled = shape;
    if (a.style === "result") {
      // The whole plan as a faint dashed ghost; what the offensive took as a full arrow ending
      // where the advance stopped.
      const reached = Math.max(0, Math.min(pts.length - 1, a.reached ?? 0));
      const done = reached > 0 ? arrowShape(pts.slice(0, reached + 1), w) : null;
      if (reached < pts.length - 1) this.paint(shape, fill, 0.18, true, false);
      if (done) {
        this.paint(done, fill, ALPHA.result, false, true);
        labelled = done;
      }
    } else {
      this.paint(shape, fill, ALPHA[a.style], a.style === "draft", a.style !== "draft");
    }
    this.label(a, labelled, w);
  }

  /** Fill (with a soft drop shadow, like the counters), then the ink outline. */
  private paint(shape: ArrowShape, fill: string, alpha: number, dashed: boolean, shadow: boolean) {
    const ctx = this.ctx;
    const trace = () => {
      ctx.beginPath();
      shape.outline.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    ctx.save();
    ctx.lineJoin = "round";
    if (shadow) {
      ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
      ctx.shadowBlur = 3;
      ctx.shadowOffsetY = 1;
    }
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill;
    trace();
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = dashed ? 0.7 : 0.9;
    if (dashed) ctx.setLineDash([4, 3]);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    trace();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The name (and a smaller note) set along the shaft on its upper side, reading left to right,
   * in the map's label face with a paper halo. Skipped when the shaft is too short for it, so it
   * never outgrows the arrow on a zoomed-out map.
   */
  private label(a: OperationArrow, shape: ArrowShape, w: number) {
    if (!a.name && !a.detail) return;
    const ctx = this.ctx;
    const size = Math.min(12.5, 5.5 + w * 0.6);
    if (size < 8.5) return;
    const main = `700 ${size}px ${this.font}, Georgia, serif`;
    const small = `600 ${size * 0.82}px ${this.font}, Georgia, serif`;
    // Spaced capitals like the country names, with a word gap wide enough to read at this size.
    const track = size * 0.1;

    ctx.save();
    // The canvas is shared with the country labels: set every text property explicitly.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
    type Glyph = { ch: string; font: string; w: number; dim: boolean };
    const run = (text: string, font: string, dim: boolean): Glyph[] => {
      ctx.font = font;
      return [...text.toUpperCase()].map((ch) => ({ ch, font, w: ch === " " ? size * 0.45 : ctx.measureText(ch).width + track, dim }));
    };
    const width = (g: Glyph[]) => g.reduce((s, x) => s + x.w, 0);
    const full = [...run(a.name ?? "", main, false), ...(a.detail ? run(`${a.name ? " · " : ""}${a.detail}`, small, true) : [])];
    // The whole text if a straight enough stretch of the shaft takes it, else the name alone.
    let glyphs = full, mid = straightStretch(shape, width(full));
    if (mid === null && a.name && a.detail) {
      glyphs = run(a.name, main, false);
      mid = straightStretch(shape, width(glyphs));
    }
    if (mid === null || !glyphs.length) {
      ctx.restore();
      return;
    }
    const L = width(glyphs);

    // Run the text backwards along the spine if the arrow points left, so it reads left to right.
    const flip = Math.cos(shape.at(mid)[2]) < 0;
    const placed = glyphs.map((g, i) => {
      const x = glyphs.slice(0, i).reduce((s, q) => s + q.w, 0) + g.w / 2 - L / 2;
      const [px, py, ang, half] = shape.at(mid + (flip ? -x : x));
      const theta = ang + (flip ? Math.PI : 0);
      const up = half + 2.5 + size * 0.5;
      return { g, x: px + Math.sin(theta) * up, y: py - Math.cos(theta) * up, theta };
    });
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    // Halos first, so one glyph's halo never covers its neighbour's ink.
    for (const pass of ["halo", "ink"] as const) {
      for (const { g, x, y, theta } of placed) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.translate(x, y);
        ctx.rotate(theta);
        ctx.font = g.font;
        if (pass === "halo") {
          ctx.lineJoin = "round";
          ctx.lineWidth = 3;
          ctx.strokeStyle = HALO;
          ctx.strokeText(g.ch, 0, 0);
        } else {
          ctx.fillStyle = TEXT_INK;
          ctx.globalAlpha = g.dim ? 0.75 : 1;
          ctx.fillText(g.ch, 0, 0);
          ctx.globalAlpha = 1;
        }
      }
    }
    ctx.restore();
  }
}

interface ArrowShape {
  /** Tail, body and head as one closed polygon (screen px). */
  outline: [number, number][];
  /** Length of the body (tail to head base) in px. */
  spineLen: number;
  /** Point, direction and body half-width at a distance along the body. */
  at: (s: number) => [number, number, number, number];
  width: number;
}

/**
 * Where along the body to centre a label `len` px long: the stretch that bends least (within
 * ~25°), preferring the middle of the shaft. Null when no stretch is long and straight enough,
 * since text wrapped round a bend scatters into illegibility.
 */
function straightStretch(shape: ArrowShape, len: number): number | null {
  const margin = shape.width * 0.6;
  const lo = margin + len / 2, hi = shape.spineLen - margin - len / 2;
  if (hi < lo) return null;
  const centre = (lo + hi) / 2;
  let best: number | null = null, bestScore = Infinity;
  for (let c = lo; c <= hi + 1e-6; c += Math.max(2, (hi - lo) / 40)) {
    const a0 = shape.at(c)[2];
    let bend = 0;
    for (let s = c - len / 2; s <= c + len / 2; s += 4) {
      const d = shape.at(s)[2] - a0;
      bend = Math.max(bend, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
    }
    if (bend > 0.45) continue;
    const score = bend + (0.3 * Math.abs(c - centre)) / Math.max(1, hi - lo);
    if (score < bestScore) [best, bestScore] = [c, score];
  }
  return best;
}

/** "#rrggbb" darkened by `k` (0–1); anything unparseable falls back to a dark red. */
function shade(hex: string, k: number) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#8e2a1f";
  const n = parseInt(m[1], 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Catmull-Rom samples through the points: a smooth path that passes through every one. */
function spline(p: [number, number][], steps = 12) {
  const out: [number, number][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}

/**
 * The arrow outline along the smoothed route: a rounded tail, a body that widens from 40% to
 * full width, and a head about twice as wide with its barbs swept back.
 */
function arrowShape(points: [number, number][], w: number): ArrowShape | null {
  const pts = spline(points);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < w * 3) return null;
  const start = Math.min(w * 0.6, total * 0.1); // leave the jump-off point itself visible
  const headLen = Math.min(w * 2, total * 0.35);
  const headBase = total - headLen;
  const point = (s: number): [number, number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    return [x, y, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
  };
  const half = (s: number) => w * 0.5 * (0.4 + 0.6 * Math.max(0, Math.min(1, (s - start) / Math.max(1, headBase - start))));
  const left: [number, number][] = [], right: [number, number][] = [];
  const n = Math.max(2, Math.ceil((headBase - start) / 4));
  for (let k = 0; k <= n; k++) {
    const s = start + ((headBase - start) * k) / n;
    const [x, y, a] = point(s);
    const h = half(s), nx = -Math.sin(a), ny = Math.cos(a);
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
  }
  // Rounded tail: a half circle behind the first sample, from the right edge round to the left.
  const [tx, ty, ta] = point(start);
  const h0 = half(start);
  const tail: [number, number][] = [];
  for (let k = 1; k < 8; k++) {
    const phi = ta - Math.PI / 2 - (Math.PI * k) / 8;
    tail.push([tx + Math.cos(phi) * h0, ty + Math.sin(phi) * h0]);
  }
  // Head: barbs swept back from the base to a sharp point at the route's end.
  const [bx, by, ba] = point(headBase);
  const tip = pts[pts.length - 1];
  const ang = Math.atan2(tip[1] - by, tip[0] - bx) || ba;
  const nx = -Math.sin(ang), ny = Math.cos(ang), hw = w * 1.05, back = w * 0.4;
  const bl: [number, number] = [bx + nx * hw - Math.cos(ang) * back, by + ny * hw - Math.sin(ang) * back];
  const br: [number, number] = [bx - nx * hw - Math.cos(ang) * back, by - ny * hw - Math.sin(ang) * back];
  const outline: [number, number][] = [...left, bl, [tip[0], tip[1]], br, ...right.reverse(), ...tail];
  const at = (s: number): [number, number, number, number] => {
    const abs = Math.max(start, Math.min(headBase, start + s));
    return [...point(abs), half(abs)];
  };
  return { outline, spineLen: headBase - start, at, width: w };
}
