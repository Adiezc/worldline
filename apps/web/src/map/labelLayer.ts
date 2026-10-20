import type { LabelCurve } from "@worldline/shared";
import type { Camera } from "./renderer.ts";
import type { MapTheme } from "./theme.ts";

const MIN_PX = 9;
const MAX_PX = 96;
const MIN_SPACING = 0.12; // letter spacing bounds, as a fraction of font size
const MAX_SPACING = 1.3;
const FILL = 0.86; // share of the baseline the spaced-out name should span

/** Country names set along quadratic curves on a 2D canvas overlay. */
export class LabelLayer {
  private ctx: CanvasRenderingContext2D;
  private widthCache = new Map<string, number>();
  labels: LabelCurve[] = [];
  names: string[] = [];
  /** Per-owner ink: a deep shade of the country's own colour, Paradox style. */
  inks: string[] = [];
  private fade = 1;
  /** Screen boxes (CSS px) of the letters drawn last frame, so other marks can keep clear. */
  boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  private colors: string[] = [];

  setColors(colors: string[]) {
    this.colors = colors;
    const { labelShade: k, labelAlpha: a } = this.theme;
    this.inks = colors.map((hex) => {
      const c = [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * k));
      return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
    });
  }

  /** Swap the era theme (ink depth and font); re-derives the per-country inks. */
  setTheme(theme: MapTheme) {
    if (theme.labelFont !== this.theme.labelFont) this.widthCache.clear();
    this.theme = theme;
    this.setColors(this.colors);
  }

  constructor(readonly canvas: HTMLCanvasElement, private theme: MapTheme) {
    this.ctx = canvas.getContext("2d")!;
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  /** Width of a character at 100px, cached. */
  private charWidth(ch: string) {
    let w = this.widthCache.get(ch);
    if (w === undefined) {
      this.ctx.font = `700 100px ${this.theme.labelFont}`;
      w = this.ctx.measureText(ch).width;
      this.widthCache.set(ch, w);
    }
    return w;
  }

  draw(cam: Camera, mapW: number) {
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.boxes = [];
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = this.theme.labelInk;

    // Country names fade out when zoomed in close; region names live in the tooltip.
    const countryFade = 1 - smoothstep(2.0, 3.4, cam.zoom);
    const halfW = W / 2 / cam.zoom;
    if (countryFade <= 0) return;
    this.fade = countryFade;
    for (const label of this.labels) {
      const name = this.names[label.owner];
      if (!name) continue;
      for (const off of [-mapW, 0, mapW]) {
        const minX = Math.min(label.p0[0], label.p2[0]) + off, maxX = Math.max(label.p0[0], label.p2[0]) + off;
        if (maxX < cam.cx - halfW || minX > cam.cx + halfW) continue;
        this.drawCurve(name.toUpperCase(), label, off, cam, W, H);
      }
    }
  }

  private drawCurve(text: string, l: LabelCurve, off: number, cam: Camera, W: number, H: number) {
    const ctx = this.ctx;
    const toScreen = (p: [number, number]): [number, number] => [
      (p[0] + off - cam.cx) * cam.zoom + W / 2,
      (p[1] - cam.cy) * cam.zoom + H / 2,
    ];
    const a = toScreen(l.p0), b = toScreen(l.p1), c = toScreen(l.p2);

    // Arc-length table for the Bézier.
    const N = 48;
    const pts: [number, number][] = [];
    const acc: number[] = [0];
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t;
      pts.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
      if (i > 0) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const length = acc[N];

    let size = l.size * cam.zoom;
    const chars = [...text];
    const glyphs = (s: number) => chars.reduce((sum, ch) => sum + (this.charWidth(ch) / 100) * s, 0);
    const gaps = Math.max(1, chars.length - 1);
    // Shrink to fit the baseline if even tight spacing overruns the curve.
    const tight = glyphs(size) + size * MIN_SPACING * gaps;
    if (tight > length) size *= length / tight;
    if (size < MIN_PX) return;
    size = Math.min(size, MAX_PX);
    // Then spread the letters to span most of the country.
    const spacing = Math.max(MIN_SPACING * size, Math.min(MAX_SPACING * size, (length * FILL - glyphs(size)) / gaps));
    const total = glyphs(size) + spacing * (chars.length - 1);
    const alpha = Math.min(1, (size - MIN_PX) / 5) * this.fade;
    const mid = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
    if (mid[0] < -length || mid[0] > W + length || mid[1] < -size * 2 || mid[1] > H + size * 2) return;

    ctx.font = `700 ${size}px ${this.theme.labelFont}`;
    ctx.fillStyle = this.inks[l.owner] ?? this.theme.labelInk;
    ctx.globalAlpha = alpha;
    let s = (length - total) / 2;
    for (const ch of chars) {
      const w = (this.charWidth(ch) / 100) * size;
      const at = s + w / 2;
      // Locate `at` on the arc-length table.
      let i = 1;
      while (i < N && acc[i] < at) i++;
      const seg = acc[i] - acc[i - 1] || 1;
      const f = Math.max(0, Math.min(1, (at - acc[i - 1]) / seg));
      const x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f;
      const y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
      const ang = Math.atan2(pts[i][1] - pts[i - 1][1], pts[i][0] - pts[i - 1][0]);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      // A legible letter claims its spot (an axis-aligned box is close enough for gentle curves).
      if (alpha > 0.3) this.boxes.push({ x0: x - w / 2, y0: y - size * 0.45, x1: x + w / 2, y1: y + size * 0.45 });
      s += w + spacing;
    }
    ctx.globalAlpha = 1;
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
