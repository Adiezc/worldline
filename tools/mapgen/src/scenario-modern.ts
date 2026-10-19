// Builds the Modern Day (Jan 1, 2026) start: countries, colours, owners and controllers.
// Reads the base map produced by build.ts plus hand-maintained overrides in the scenario folder.

import { join } from "node:path";
import type { MapMeta, ScenarioStart } from "@worldline/shared";

const ROOT = join(import.meta.dir, "..", "..", "..");
const MAP = join(ROOT, "packages", "mapdata", "public", "map");
const SCEN = join(ROOT, "packages", "scenarios", "modern-2026");

const meta = (await Bun.file(join(MAP, "provinces.json")).json()) as MapMeta;
const base = (await Bun.file(join(MAP, "countries.base.json")).json()) as { tag: string; name: string }[];
const overrides = (await Bun.file(join(SCEN, "overrides.json")).json()) as {
  names: Record<string, string>;
  colors: Record<string, string>;
  /** "TAG:Province name" → controller tag (occupation at start). */
  controllers: Record<string, string>;
};

const tags = base.map((c) => c.tag);
const index = new Map(tags.map((t, i) => [t, i]));
const owners = [-1, ...meta.provinces.map((p) => index.get(p.defaultOwner)!)];
const controllers = [...owners];
for (const [key, ctrl] of Object.entries(overrides.controllers)) {
  const [tag, name] = key.split(":");
  const p = meta.provinces.find((q) => q.defaultOwner === tag && q.name === name);
  if (!p) throw new Error(`controller override: no province ${key}`);
  controllers[p.id] = index.get(ctrl)!;
}

// Country adjacency (land) for colouring.
const countryNeighbors = tags.map(() => new Set<number>());
for (const p of meta.provinces) for (const n of p.neighbors) {
  const a = owners[p.id], b = owners[n];
  if (a !== b) { countryNeighbors[a].add(b); countryNeighbors[b].add(a); }
}
const size = tags.map(() => 0);
for (const p of meta.provinces) size[owners[p.id]] += p.areaKm2;

// Muted candidate palette: hues around the wheel at a few saturation/lightness levels.
const hsl = (h: number, s: number, l: number) => {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255)) as [number, number, number];
};
const palette: [number, number, number][] = [];
for (let h = 0; h < 360; h += 12) for (const [s, l] of [[0.42, 0.55], [0.32, 0.66], [0.38, 0.44]]) palette.push(hsl(h, s, l));
const hex = (c: number[]) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");
const parse = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a: number[], b: number[]) => {
  const rm = (a[0] + b[0]) / 2, dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
};

const colors: (number[] | null)[] = tags.map((t) => (overrides.colors[t] ? parse(overrides.colors[t]) : null));
const order = tags.map((_, i) => i).filter((i) => !colors[i]).sort((a, b) => size[b] - size[a]);
const used = new Map<string, number>();
for (const i of order) {
  let best = palette[0], bestScore = -Infinity;
  palette.forEach((c, k) => {
    let near = Infinity;
    for (const n of countryNeighbors[i]) if (colors[n]) near = Math.min(near, dist(c, colors[n]!));
    // Second ring keeps clusters of small countries varied.
    for (const n of countryNeighbors[i]) for (const m of countryNeighbors[n]) if (m !== i && colors[m]) near = Math.min(near, dist(c, colors[m]!) * 1.6);
    const score = Math.min(near, 400) - (used.get(hex(c)) ?? 0) * 18 + ((i * 7 + k * 13) % 5);
    if (score > bestScore) { bestScore = score; best = c; }
  });
  colors[i] = best;
  used.set(hex(best), (used.get(hex(best)) ?? 0) + 1);
}

// Report neighbouring countries whose colours are too close to tell apart.
const MIN_CONTRAST = 70;
for (let i = 0; i < tags.length; i++) for (const n of countryNeighbors[i]) {
  if (n > i && dist(colors[i]!, colors[n]!) < MIN_CONTRAST) {
    console.warn(`low contrast: ${tags[i]} ${hex(colors[i]!)} vs ${tags[n]} ${hex(colors[n]!)} (${dist(colors[i]!, colors[n]!).toFixed(0)})`);
  }
}

const start: ScenarioStart = {
  id: "modern-2026",
  name: "Modern Day",
  date: "2026-01-01",
  countries: base.map((c, i) => ({ tag: c.tag, name: overrides.names[c.tag] ?? c.name, color: hex(colors[i]!) })),
  owners,
  controllers,
};
await Bun.write(join(SCEN, "start.json"), JSON.stringify(start));
console.log(`modern-2026: ${start.countries.length} countries, ${Object.keys(overrides.controllers).length} occupied provinces`);
