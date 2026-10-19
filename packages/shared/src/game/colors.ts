import type { MapIndex } from "./mapIndex.ts";
import type { GameState } from "./state.ts";

const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const colorDistance = (a: string, b: string) => {
  const x = parse(a), y = parse(b);
  const rm = (x[0] + y[0]) / 2, dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};

function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** Muted colour that contrasts with whoever borders the given provinces. */
export function pickColor(state: GameState, map: MapIndex, provinces: number[]) {
  const near = new Set<number>();
  for (const id of provinces) for (const n of map.neighbors[id] ?? []) near.add(state.owners[n]);
  const neighbourColors = [...near].filter((i) => i >= 0).map((i) => state.countries[i].color);
  let best = "#8a8a8a", score = -1;
  for (let h = 0; h < 360; h += 9) for (const [s, l] of [[0.4, 0.55], [0.32, 0.64], [0.38, 0.45]]) {
    const c = hsl(h, s, l);
    const d = Math.min(400, ...neighbourColors.map((n) => colorDistance(c, n)));
    if (d > score) { score = d; best = c; }
  }
  return best;
}
