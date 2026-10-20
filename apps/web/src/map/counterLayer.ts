// Front counters at the front anchors, drawn on the label canvas after the names: a unit symbol
// in each side's colour showing who holds the line. No troop numbers: how strong each side is,
// is the narrator's judgement, not arithmetic.
import type { Camera } from "./renderer.ts";

export interface FrontCounter {
  frontId: string;
  warId: string;
  /** 0 = attackers' side, 1 = defenders'. */
  side: 0 | 1;
  tag: string;
  enemyTag: string;
  name: string;
  enemyName: string;
  color: string;
  /** Countries fighting on this side of the front, main one first. */
  by: string[];
  /** "the Ukrainian front" */
  label: string;
  /** Map px: this counter's anchor and the opposing one. */
  anchor: [number, number];
  other: [number, number];
  /** Front length, km. */
  length: number;
}

export interface FrontsOverlay {
  /** Province pairs along every front, for the line mesh. */
  pairs: [number, number][];
  counters: FrontCounter[];
}

interface Hit {
  x: number;
  y: number;
  w: number;
  h: number;
  counter: FrontCounter;
}

/** Below this zoom, fronts of the same war and pair of countries merge into one counter each. */
const MERGE_ZOOM = 0.6;
/** Below this zoom only long fronts keep their counters. */
const WORLD_ZOOM = 0.34;
const WORLD_MIN_KM = 400;
const FONT = "Inter, system-ui, sans-serif";

export class CounterLayer {
  private ctx: CanvasRenderingContext2D;
  private counters: FrontCounter[] = [];
  private merged: FrontCounter[] = [];
  private hits: Hit[] = [];
  /** Hovered counter and the pointer (canvas CSS px) for the tooltip. */
  hover: { counter: FrontCounter; x: number; y: number } | null = null;

  constructor(readonly canvas: HTMLCanvasElement, private mapW = 8192) {
    this.ctx = canvas.getContext("2d")!;
  }

  set(counters: FrontCounter[], mapW: number) {
    this.mapW = mapW;
    this.counters = counters;
    this.merged = merge(counters, mapW);
    this.hits = [];
    // Keep the tooltip across recomputes (views arrive often) when its counter still exists.
    const h = this.hover;
    const same = h && [...counters, ...this.merged].find((c) => c.frontId === h.counter.frontId && c.side === h.counter.side);
    this.hover = h && same ? { ...h, counter: same } : null;
  }

  get empty() {
    return this.counters.length === 0;
  }

  /** Counter under a canvas-relative CSS px position, as last drawn. */
  pickCounter(x: number, y: number): FrontCounter | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.counter;
    }
    return null;
  }

  draw(cam: Camera) {
    this.hits = [];
    if (!this.counters.length) return;
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const W = this.canvas.width / dpr, H = this.canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const list = cam.zoom < MERGE_ZOOM ? this.merged.filter((c) => cam.zoom >= WORLD_ZOOM || c.length >= WORLD_MIN_KM) : this.counters;
    const s = Math.max(0.75, Math.min(1.3, 0.85 + 0.3 * Math.log2(cam.zoom / 0.5)));
    const halfW = W / 2 / cam.zoom;
    const mapW = this.mapW;
    for (const c of list) {
      for (const off of [-mapW, 0, mapW]) {
        const ax = c.anchor[0] + off;
        if (ax < cam.cx - halfW - 200 || ax > cam.cx + halfW + 200) continue;
        // The opposing anchor on the copy nearest to this one.
        const ox = ax + ((((c.other[0] - c.anchor[0] + mapW / 2) % mapW) + mapW) % mapW) - mapW / 2;
        const pa = [(ax - cam.cx) * cam.zoom + W / 2, (c.anchor[1] - cam.cy) * cam.zoom + H / 2];
        const pb = [(ox - cam.cx) * cam.zoom + W / 2, (c.other[1] - cam.cy) * cam.zoom + H / 2];
        this.drawCounter(c, pa, pb, s, W, H);
      }
    }
    // A zoom can merge or hide the hovered counter under a still pointer.
    if (this.hover && !this.hits.some((h) => h.counter === this.hover!.counter)) this.hover = null;
    if (this.hover) this.drawTooltip(this.hover.counter, this.hover.x, this.hover.y, W, H);
  }

  private drawCounter(c: FrontCounter, pa: number[], pb: number[], s: number, W: number, H: number) {
    const ctx = this.ctx;
    const h = 17 * s, g = 15 * s, pad = 3 * s;
    const w = pad + g + pad;
    // Keep the two sides of a front from overlapping: push apart along the line between them.
    let dx = pa[0] - pb[0], dy = pa[1] - pb[1];
    const d = Math.hypot(dx, dy);
    if (d < 1e-3) [dx, dy] = [c.side === 0 ? -1 : 1, 0];
    else [dx, dy] = [dx / d, dy / d];
    const need = Math.max(w, h * 2) + 6 * s;
    let x = pa[0], y = pa[1];
    if (d < need) {
      const mx = (pa[0] + pb[0]) / 2, my = (pa[1] + pb[1]) / 2;
      x = mx + (dx * need) / 2;
      y = my + (dy * need) / 2;
    }
    x -= w / 2;
    y -= h / 2;
    if (x + w < 0 || x > W || y + h < 0 || y > H) return;
    const hovered = this.hover?.counter === c;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
    ctx.shadowBlur = 4 * s;
    ctx.shadowOffsetY = 1 * s;
    roundRect(ctx, x, y, w, h, 3 * s);
    ctx.fillStyle = c.color;
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = Math.max(1, 1.4 * s);
    ctx.strokeStyle = hovered ? "#f2d27a" : "#1b130e";
    roundRect(ctx, x, y, w, h, 3 * s);
    ctx.stroke();

    // NATO infantry symbol: a framed box with a saltire.
    const gx = x + pad, gy = y + (h - 10 * s) / 2, gh = 10 * s;
    ctx.fillStyle = "rgba(250, 245, 230, 0.93)";
    ctx.fillRect(gx, gy, g, gh);
    ctx.lineWidth = Math.max(0.8, 1.1 * s);
    ctx.strokeStyle = "#1b130e";
    ctx.strokeRect(gx, gy, g, gh);
    ctx.beginPath();
    ctx.moveTo(gx, gy);
    ctx.lineTo(gx + g, gy + gh);
    ctx.moveTo(gx + g, gy);
    ctx.lineTo(gx, gy + gh);
    ctx.stroke();
    this.hits.push({ x, y, w, h, counter: c });
  }

  private drawTooltip(c: FrontCounter, px: number, py: number, W: number, H: number) {
    const ctx = this.ctx;
    const lines: { text: string; font: string; color: string }[] = [
      { text: `${c.name} on ${c.label}`, font: `600 12px ${FONT}`, color: "#efe6d0" },
    ];
    const others = c.by.filter((n) => n !== c.name);
    if (others.length) lines.push({ text: `With ${others.join(", ")}`, font: `400 11px ${FONT}`, color: "rgba(239, 230, 208, 0.7)" });
    lines.push({ text: `Facing ${c.enemyName}`, font: `400 11px ${FONT}`, color: "rgba(240, 160, 150, 0.9)" });
    let w = 0;
    for (const l of lines) {
      ctx.font = l.font;
      w = Math.max(w, ctx.measureText(l.text).width);
    }
    w += 20;
    const h = 12 + lines.length * 16;
    const x = Math.min(px + 14, W - w - 6), y = Math.min(py + 16, H - h - 6);
    roundRect(ctx, x, y, w, h, 4);
    ctx.fillStyle = "rgba(22, 17, 13, 0.95)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(201, 164, 92, 0.6)";
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    lines.forEach((l, i) => {
      ctx.font = l.font;
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x + 10, y + 6 + 8 + i * 16);
    });
  }
}

/** One counter per (war, own lead, enemy lead): length-weighted anchors, every contributor. */
function merge(counters: FrontCounter[], mapW: number) {
  const groups = new Map<string, FrontCounter[]>();
  for (const c of counters) {
    const key = `${c.warId}|${c.tag}|${c.enemyTag}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(c);
  }
  const out: FrontCounter[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    const ref = list[0].anchor[0];
    const unwrap = (x: number) => ref + ((((x - ref + mapW / 2) % mapW) + mapW) % mapW) - mapW / 2;
    const wrap = (x: number) => ((x % mapW) + mapW) % mapW;
    let total = 0, ax = 0, ay = 0, ox = 0, oy = 0;
    const by = new Set<string>();
    for (const c of list) {
      const k = Math.max(1, c.length);
      total += k;
      ax += unwrap(c.anchor[0]) * k;
      ay += c.anchor[1] * k;
      ox += unwrap(c.other[0]) * k;
      oy += c.other[1] * k;
      for (const b of c.by) by.add(b);
    }
    out.push({
      ...list[0],
      frontId: list.map((c) => c.frontId).join(","),
      by: [...by],
      anchor: [wrap(ax / total), ay / total],
      other: [wrap(ox / total), oy / total],
      length: list.reduce((s, c) => s + c.length, 0),
    });
  }
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
