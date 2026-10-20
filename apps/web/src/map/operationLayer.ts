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

const PALETTE: Record<ArrowStyle, { fill: string; edge: string; alpha: number }> = {
  plan: { fill: "#c9372c", edge: "#3b0d0a", alpha: 0.92 },
  draft: { fill: "#e0574a", edge: "#3b0d0a", alpha: 0.75 },
  ally: { fill: "#d9892b", edge: "#3a2207", alpha: 0.85 },
  result: { fill: "#a8463c", edge: "#2a0c09", alpha: 0.9 },
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
    const w = Math.max(5, Math.min(14, 7 + 3 * Math.log2(Math.max(0.05, cam.zoom) / 0.5)));
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
    // Start a little past the jump-off centroid and stop short of the last one for the head.
    const path = trimEnds(pts, w * 0.6, w * 1.6);
    if (path.length < 2) return;
    const head = path[path.length - 1];
    const prev = path[path.length - 2];
    const ang = Math.atan2(head[1] - prev[1], head[0] - prev[0]);
    const tip: [number, number] = [head[0] + Math.cos(ang) * w * 1.6, head[1] + Math.sin(ang) * w * 1.6];

    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (a.style === "result") {
      // What the offensive took is solid; the rest of the plan fades out.
      const split = Math.max(0, Math.min(pts.length - 1, a.reached ?? 0));
      const done = split > 0 ? trimEnds(pts.slice(0, split + 1), w * 0.6, 0) : [];
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([w * 1.2, w * 0.9]);
      this.body(path, w, pal);
      this.head(path, tip, ang, w, pal);
      ctx.setLineDash([]);
      ctx.globalAlpha = pal.alpha;
      if (done.length >= 2) this.body(done, w, pal);
    } else {
      ctx.globalAlpha = pal.alpha;
      if (a.style === "draft") ctx.setLineDash([w * 1.4, w * 0.7]);
      this.body(path, w, pal);
      ctx.setLineDash([]);
      this.head(path, tip, ang, w, pal);
    }
    ctx.restore();
    // Caption beyond the arrowhead, where the troop counters (on the line) won't cover it.
    if (a.label) this.caption(a.label, [tip[0] + Math.cos(ang) * 6, tip[1] + Math.sin(ang) * 6], ang, pal);
  }

  /** Smooth body: a dark edge stroke under the fill stroke. */
  private body(path: [number, number][], w: number, pal: (typeof PALETTE)[ArrowStyle]) {
    const ctx = this.ctx;
    smoothPath(ctx, path);
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = w + 3;
    ctx.stroke();
    smoothPath(ctx, path);
    ctx.strokeStyle = pal.fill;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  private head(path: [number, number][], tip: [number, number], ang: number, w: number, pal: (typeof PALETTE)[ArrowStyle]) {
    const ctx = this.ctx;
    const base = path[path.length - 1];
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const hw = w * 1.35;
    ctx.beginPath();
    ctx.moveTo(tip[0], tip[1]);
    ctx.lineTo(base[0] + nx * hw, base[1] + ny * hw);
    ctx.lineTo(base[0] - nx * hw, base[1] - ny * hw);
    ctx.closePath();
    ctx.fillStyle = pal.fill;
    ctx.strokeStyle = pal.edge;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
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

/** Quadratic curve through the midpoints: a smooth line that still passes near every point. */
function smoothPath(ctx: CanvasRenderingContext2D, p: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  if (p.length === 2) {
    ctx.lineTo(p[1][0], p[1][1]);
    return;
  }
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    ctx.quadraticCurveTo(p[i][0], p[i][1], i === p.length - 2 ? p[i + 1][0] : mx, i === p.length - 2 ? p[i + 1][1] : my);
  }
}

/** Shorten a polyline by `start` px at its beginning and `end` px at its end. */
function trimEnds(p: [number, number][], start: number, end: number): [number, number][] {
  const out = p.map((q) => [...q] as [number, number]);
  const cut = (from: number, dir: 1 | -1, amount: number) => {
    let left = amount;
    for (let i = from; out.length >= 2 && left > 0; ) {
      const j = i + dir;
      if (j < 0 || j >= out.length) break;
      const d = Math.hypot(out[j][0] - out[i][0], out[j][1] - out[i][1]);
      if (d > left) {
        out[i] = [out[i][0] + ((out[j][0] - out[i][0]) * left) / d, out[i][1] + ((out[j][1] - out[i][1]) * left) / d];
        return;
      }
      left -= d;
      out.splice(i, 1);
      if (dir === -1) i = out.length - 1;
    }
  };
  if (start > 0) cut(0, 1, start);
  if (end > 0) cut(out.length - 1, -1, end);
  return out;
}
