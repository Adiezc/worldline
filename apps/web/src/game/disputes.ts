// Client glue for territorial disputes: dashed lines where a claim cuts across the map (always
// shown, like disputed borders on a road map) and, in the Disputes map mode, claimed land
// striped in the claimant's colour.
import type { Claim, GameView, MapIndex } from "@worldline/shared";
import { getMap } from "../map/controller.ts";
import { useMap } from "../store.ts";
import { mapIndexFor } from "./fronts.ts";
import { useGame } from "./store.ts";

/**
 * Border pairs a claim disputes: from each claimed region to neighbours outside the claim that
 * belong to the same holder (the line a claim draws through a country) or to the claimant (a
 * frontier the claimant doesn't accept). Borders with uninvolved countries stay solid.
 */
export function claimLinePairs(view: Pick<GameView, "countries" | "owners">, map: MapIndex, claims: Claim[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (const c of claims) {
    const claimant = view.countries.findIndex((k) => k.tag === c.claimant);
    const set = new Set(c.provinces);
    for (const id of c.provinces) {
      for (const n of map.neighbors[id] ?? []) {
        if (set.has(n)) continue;
        if (view.owners[n] === view.owners[id] || view.owners[n] === claimant) pairs.push([id, n]);
      }
    }
  }
  return pairs;
}

/** Claims on a province, newest last. */
export const claimsOn = (view: Pick<GameView, "claims">, id: number) => (view.claims ?? []).filter((c) => c.provinces.includes(id));

/** Push dispute lines (and the Disputes mode's stripes) for the current view. */
export function pushDisputes() {
  const map = getMap();
  if (!map) return;
  const { view, mapMode } = useGame.getState();
  const { meta, editing } = useMap.getState();
  if (!view || !meta || editing || !view.claims?.length) {
    map.setClaims(null, null);
    return;
  }
  const idx = mapIndexFor(meta);
  const pairs = claimLinePairs(view, idx, view.claims);
  let marks: Map<number, number> | null = null;
  if (mapMode === "disputes") {
    marks = new Map();
    for (const c of view.claims) {
      const ci = view.countries.findIndex((k) => k.tag === c.claimant);
      for (const id of c.provinces) if (!marks.has(id)) marks.set(id, ci);
    }
  }
  map.setClaims(pairs.length ? pairs : null, marks);
}
