// Client glue for front lines: computes them from a view (or the map as drawn during playback),
// with who fights on each side, and pushes the overlay to the map.
import {
  buildMapIndex, computeFronts, estimateForces, frontName,
  type Country, type ForceEstimate, type Front, type GameView, type MapIndex, type MapMeta, type War,
} from "@worldline/shared";
import { getMap, type FrontCounter, type FrontsOverlay } from "../map/controller.ts";
import { useMap } from "../store.ts";
import { useGame } from "./store.ts";

export interface FrontsResult {
  fronts: Front[];
  forces: ForceEstimate;
}

const indexes = new WeakMap<MapMeta, MapIndex>();
export function mapIndexFor(meta: MapMeta) {
  let m = indexes.get(meta);
  if (!m) indexes.set(meta, (m = buildMapIndex(meta)));
  return m;
}

export function computeFrontsFor(
  world: { owners: ArrayLike<number>; controllers: ArrayLike<number>; countries: Country[]; wars: War[] },
  meta: MapMeta,
): FrontsResult {
  const input = { owners: world.owners, controllers: world.controllers, countries: world.countries, wars: world.wars, map: mapIndexFor(meta) };
  const fronts = computeFronts(input);
  return { fronts, forces: estimateForces(input, fronts) };
}

const byView = new WeakMap<GameView, FrontsResult>();
/** Fronts and forces for a view's current state, cached per view object. */
export function frontsForView(view: GameView, meta: MapMeta) {
  let r = byView.get(view);
  if (!r) byView.set(view, (r = computeFrontsFor(view, meta)));
  return r;
}

export function frontsOverlay({ fronts, forces }: FrontsResult, countries: Country[]): FrontsOverlay {
  const byTag = new Map(countries.map((c) => [c.tag, c]));
  const name = (tag: string) => byTag.get(tag)?.name ?? tag;
  const counters: FrontCounter[] = [];
  for (const f of fronts) {
    const ff = forces.fronts[f.id];
    if (!ff) continue;
    const sides = [[ff.a, ff.b, f.anchorA, f.anchorB], [ff.b, ff.a, f.anchorB, f.anchorA]] as const;
    sides.forEach(([mine, theirs, anchor, other], side) => {
      counters.push({
        frontId: f.id,
        warId: f.warId,
        side: side as 0 | 1,
        tag: mine.tag,
        enemyTag: theirs.tag,
        name: name(mine.tag),
        enemyName: name(theirs.tag),
        color: byTag.get(mine.tag)?.color ?? "#888888",
        by: [mine.tag, ...mine.by.map((b) => b.tag).filter((t) => t !== mine.tag)].map(name),
        label: frontName(theirs.tag, name(theirs.tag)),
        anchor: [...anchor],
        other: [...other],
        length: f.length,
      });
    });
  }
  return { pairs: fronts.flatMap((f) => f.pairs), counters };
}

/**
 * Recompute fronts for the map as currently drawn (so turn playback shows the line moving)
 * and push them; clears them when hidden, in the editor or outside a game.
 */
export function pushFronts() {
  const map = getMap();
  if (!map) return;
  const { view, showFronts } = useGame.getState();
  const { meta, editing } = useMap.getState();
  if (!showFronts || !view || !meta || editing || !view.wars.length) {
    map.setFronts(null);
    return;
  }
  const owners = map.owners(), controllers = map.controllers();
  const world = owners.length ? { owners, controllers, countries: view.countries, wars: view.wars } : view;
  map.setFronts(frontsOverlay(computeFrontsFor(world, meta), view.countries));
}
