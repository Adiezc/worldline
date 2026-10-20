// Capital cities as Paradox-style stars, drawn on the label canvas after the country names; the
// city's name joins the star once zoomed in far enough to read regions.
import type { Camera } from "./renderer.ts";

export interface CapitalMark {
  tag: string;
  name: string;
  /** Map px. */
  x: number;
  y: number;
  /** The country's size: square root of its land area, in map px. */
  extent: number;
}

/**
 * Victoria 3-style reveal: a capital appears once its country spans this many CSS px on screen
 * (fading in over FADE px), and its name once the country spans NAME_PX.
 */
const STAR_PX = 120;
const NAME_PX = 210;
const FADE = 45;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

export class CapitalLayer {
  private ctx: CanvasRenderingContext2D;
  private marks: CapitalMark[] = [];
  private font = "Cinzel";

  constructor(readonly canvas: HTMLCanvasElement, private mapW = 8192) {
    this.ctx = canvas.getContext("2d")!;
  }

  set(marks: CapitalMark[], mapW: number) {
    // Biggest countries first: they win any overlap.
    this.marks = [...marks].sort((a, b) => b.extent - a.extent);
    this.mapW = mapW;
  }

  setFont(font: string) {
    this.font = font;
  }

  /** `avoid`: screen boxes already taken (country names), which stars and city names keep clear of. */
  draw(cam: Camera, avoid: Box[] = []) {
    if (!this.marks.length) return;
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const r = Math.max(4, Math.min(8, 5 + 2 * Math.log2(Math.max(0.1, cam.zoom) / 0.6)));
    const fontPx = Math.round(10 + r * 0.45);
    ctx.font = `600 ${fontPx}px ${this.font}, Georgia, serif`;
    const halfW = W / 2 / cam.zoom;
    const placed: Box[] = [...avoid];
    for (const m of this.marks) {
      const span = m.extent * cam.zoom;
      if (span < STAR_PX) continue;
      for (const off of [-this.mapW, 0, this.mapW]) {
        const mx = m.x + off;
        if (mx < cam.cx - halfW - 40 || mx > cam.cx + halfW + 40) continue;
        const sx = (mx - cam.cx) * cam.zoom + W / 2, sy = (m.y - cam.cy) * cam.zoom + H / 2;
        if (sy < -20 || sy > H + 20) continue;
        const star: Box = { x0: sx - r - 2, y0: sy - r - 2, x1: sx + r + 2, y1: sy + r + 2 };
        if (placed.some((b) => hits(b, star))) continue;
        placed.push(star);
        ctx.globalAlpha = Math.min(1, (span - STAR_PX) / FADE);
        this.star(sx, sy, r);
        if (span >= NAME_PX) {
          // Name to the right of the star, else to the left, else not at all.
          const tw = ctx.measureText(m.name).width;
          const h = fontPx + 2;
          const right: Box = { x0: sx + r + 2, y0: sy - h / 2, x1: sx + r + 5 + tw, y1: sy + h / 2 };
          const left: Box = { x0: sx - r - 5 - tw, y0: sy - h / 2, x1: sx - r - 2, y1: sy + h / 2 };
          const spot = [right, left].find((b) => !placed.some((p) => hits(p, b)));
          if (spot) {
            placed.push(spot);
            ctx.globalAlpha = Math.min(1, (span - NAME_PX) / FADE);
            this.label(m.name, spot.x0 + 1.5, sy);
          }
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /** Five-pointed gold star with a dark rim and a soft shadow, like a Paradox capital marker. */
  private star(x: number, y: number, r: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 3;
    ctx.shadowOffsetY = 1;
    const g = ctx.createLinearGradient(x, y - r, x, y + r);
    g.addColorStop(0, "#fff4c8");
    g.addColorStop(0.55, "#f2cd5e");
    g.addColorStop(1, "#b98a2a");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, r * 0.2);
    ctx.strokeStyle = "#2b1d0c";
    ctx.stroke();
    ctx.restore();
  }

  private label(text: string, x: number, y: number) {
    const ctx = this.ctx;
    ctx.save();
    // The label layer leaves its own alignment set; names sit to the right of the star.
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(244, 236, 214, 0.85)";
    ctx.strokeText(text, x, y + 0.5);
    ctx.fillStyle = "#2a2118";
    ctx.fillText(text, x, y + 0.5);
    ctx.restore();
  }
}
