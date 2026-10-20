// HOI4-style offensive arrows, drawn on the label canvas under the troop counters. Hold lines
// are drawn by the WebGL renderer along the borders they cover.
import type { Camera } from "./renderer.ts";

export type ArrowStyle = "plan" | "draft" | "ally" | "result";

export interface OperationArrow {
  id: string;
  /** Map px points along the route (jump-off first), unwrapped so consecutive points are close. */
  points: [number, number][];
  style: ArrowStyle;
  /** For results: index of the furthest point the offensive reached (0 = no gain). */
  reached?: number;
  /** Short caption shown at the tail, e.g. "Op. Dawn · 40". */
  label?: string;
}

/** HOI4-like battle-plan colours: fill, border, the lighter streak along the spine. */
const PALETTE: Record<ArrowStyle, { fill: string; edge: string; light: string; alpha: number }> = {
  plan: { fill: "#d0342a", edge: "#4a0d08", light: "#ff9a7e", alpha: 0.88 },
  draft: { fill: "#e0574a", edge: "#4a0d08", light: "#ffb39c", alpha: 0.72 },
  ally: { fill: "#e08a2a", edge: "#4a2a06", light: "#ffd08a", alpha: 0.85 },
  result: { fill: "#b0392f", edge: "#3a0b07", light: "#f08a72", alpha: 0.9 },
};
const FONT = "Inter, system-ui, sans-serif";

export class OperationLayer {
  private ctx: CanvasRenderingContext2D;
  private arrows: OperationArrow[] = [];

  constructor(readonly canvas: HTMLCanvasElement, private mapW = 8192) {
    this.ctx = canvas.getContext("2d")!;
  }

  set(arrows: OperationArrow[], mapW: number) {
    this.arrows = arrows;
    this.mapW = mapW;
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
    // Arrow width in CSS px: readable at world scale, not a slab when zoomed in.
    // Arrow width in CSS px: chunky like HOI4's at every zoom, never a slab.
    const w = Math.max(8, Math.min(24, 13 + 4.5 * Math.log2(Math.max(0.05, cam.zoom) / 0.5)));
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
    const ctx = this.ctx;
    const pal = PALETTE[a.style];
    const shape = arrowShape(pts, w);
    if (!shape) return;

    ctx.save();
    ctx.lineJoin = "round";
    if (a.style === "result") {
      // The whole plan as a ghost; what the offensive actually took as a full, pointed arrow
      // ending where the advance stopped.
      const reached = Math.max(0, Math.min(pts.length - 1, a.reached ?? 0));
      if (reached < pts.length - 1) this.paint(shape.outline, shape, pal, 0.3, true);
      const done = reached > 0 ? arrowShape(pts.slice(0, reached + 1), w) : null;
      if (done) this.paint(done.outline, done, pal, pal.alpha, false);
    } else {
      this.paint(shape.outline, shape, pal, pal.alpha, a.style === "draft");
    }
    ctx.restore();
    // Caption beyond the arrowhead, where the troop counters (on the line) won't cover it.
    if (a.label) this.caption(a.label, [shape.tip[0] + Math.cos(shape.ang) * 6, shape.tip[1] + Math.sin(shape.ang) * 6], shape.ang, pal);
  }

  /**
   * HOI4 look: a pale rim, then the red fill with a lighter streak down the middle, then a dark
   * red border. `dashed` draws the border dashed (a plan still being drawn, or what was not taken).
   */
  private paint(poly: [number, number][], shape: ArrowShape, pal: (typeof PALETTE)[ArrowStyle], alpha: number, dashed: boolean) {
    const ctx = this.ctx;
    const trace = () => {
      ctx.beginPath();
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
    };
    ctx.globalAlpha = alpha;
    trace();
    ctx.strokeStyle = "rgba(255, 238, 214, 0.75)";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = pal.fill;
    ctx.fill();
    // Highlight: a narrow lighter band along the spine, clipped to the arrow.
    ctx.save();
    trace();
    ctx.clip();
    ctx.beginPath();
    shape.spine.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = pal.light;
    ctx.globalAlpha = alpha * 0.45;
    ctx.lineWidth = shape.width * 0.28;
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = alpha;
    trace();
    if (dashed) ctx.setLineDash([shape.width * 0.6, shape.width * 0.4]);
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  private caption(text: string, at: [number, number], ang: number, pal: (typeof PALETTE)[ArrowStyle]) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `600 10.5px ${FONT}`;
    const tw = ctx.measureText(text).width;
    // Anchor the pill on the side the arrow points to.
    const x = Math.cos(ang) >= 0 ? at[0] : at[0] - tw - 10;
    const y = at[1] - 8 + Math.sin(ang) * 8;
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = "rgba(20, 14, 10, 0.82)";
    ctx.strokeStyle = pal.fill;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, tw + 10, 16, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f1e6cf";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + 5, y + 8.5);
    ctx.restore();
  }
}

interface ArrowShape {
  /** Body plus head, as one closed polygon (screen px). */
  outline: [number, number][];
  /** Centre line of the body. */
  spine: [number, number][];
  tip: [number, number];
  ang: number;
  width: number;
}

/** Catmull-Rom samples through the points: a smooth path that passes through every one. */
function spline(p: [number, number][], steps = 12) {
  const out: [number, number][] = [p[0]];
  const idx: number[] = [0];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
    idx.push(out.length - 1);
  }
  return { pts: out, idx };
}

/**
 * The arrow outline: a body that widens from a slim tail toward a broad, sharp head, following
 * the smoothed route.
 */
function arrowShape(points: [number, number][], w: number): ArrowShape | null {
  const { pts } = spline(points);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1];
  if (total < w * 2) return null;
  const start = Math.min(w * 0.7, total * 0.15); // leave the jump-off point itself visible
  const headLen = Math.min(w * 2.4, total * 0.4);
  const headBase = total - headLen;
  const stop = headBase;
  const at = (s: number): [number, number, number] => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
    const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    return [x, y, Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0])];
  };
  const half = (s: number) => w * 0.5 * (0.5 + 0.5 * Math.min(1, (s - start) / Math.max(1, headBase - start)));
  const left: [number, number][] = [], right: [number, number][] = [], spine: [number, number][] = [];
  const n = Math.max(2, Math.ceil((stop - start) / 4));
  for (let k = 0; k <= n; k++) {
    const s = start + ((stop - start) * k) / n;
    const [x, y, a] = at(s);
    const h = half(s), nx = -Math.sin(a), ny = Math.cos(a);
    left.push([x + nx * h, y + ny * h]);
    right.push([x - nx * h, y - ny * h]);
    spine.push([x, y]);
  }
  const back_: [number, number][] = [...right].reverse();
  // Head: a broad base just past the body, swept back slightly, to a sharp point at the route's end.
  const [bx, by, ba] = at(headBase);
  const tip = pts[pts.length - 1];
  const ang = Math.atan2(tip[1] - by, tip[0] - bx) || ba;
  const nx = -Math.sin(ang), ny = Math.cos(ang), hw = w * 1.2, back = w * 0.25;
  const bl: [number, number] = [bx + nx * hw - Math.cos(ang) * back, by + ny * hw - Math.sin(ang) * back];
  const br: [number, number] = [bx - nx * hw - Math.cos(ang) * back, by - ny * hw - Math.sin(ang) * back];
  const outline: [number, number][] = [...left, bl, [tip[0], tip[1]], br, ...back_];
  return { outline, spine, tip: [tip[0], tip[1]], ang, width: w };
}
