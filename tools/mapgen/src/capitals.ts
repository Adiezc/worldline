// Capital cities for a scenario: real coordinates from packages/scenarios/capitals.json, placed on
// the map and tied to the region they lie in (or the country's nearest region for tiny states).
import { decode } from "fast-png";
import { join } from "node:path";
import { project, type Country, type MapMeta } from "@worldline/shared";

const ROOT = join(import.meta.dir, "..", "..", "..");

export async function assignCapitals(scenarioId: string, countries: Country[], owners: number[], meta: MapMeta, warn: (m: string) => void) {
  const table = (await Bun.file(join(ROOT, "packages", "scenarios", "capitals.json")).json()) as Record<string, Record<string, [string, number, number]>>;
  const png = decode(await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.png")).arrayBuffer());
  const ids = png.data as Uint16Array;
  const entries = { ...table.default, ...(table[scenarioId] ?? {}) };
  countries.forEach((c, i) => {
    const e = entries[c.tag];
    if (!e) {
      c.capital = null; // uninhabited entries (a glacier, reefs) have no capital
      return;
    }
    const [name, lat, lon] = e;
    const [x, y] = project(lon, lat);
    let province = ids[Math.max(0, Math.min(png.height - 1, Math.floor(y))) * png.width + Math.max(0, Math.min(png.width - 1, Math.floor(x)))];
    if (!province || owners[province] !== i) {
      // On the coast or in a sliver of a region: the country's region nearest the city.
      let best = -1, bestD = Infinity;
      for (const p of meta.provinces) {
        if (owners[p.id] !== i) continue;
        const dx = Math.abs(p.cx - x);
        const d = Math.hypot(Math.min(dx, meta.width - dx), p.cy - y); // the map wraps at the date line
        if (d < bestD) [best, bestD] = [p.id, d];
      }
      if (best < 0) return warn(`capital ${c.tag}: the country holds no region`);
      if (bestD > 60) warn(`capital ${c.tag} (${name}) is ${Math.round(bestD)} px from its nearest region`);
      province = best;
    }
    c.capital = { name, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, province };
  });
}
