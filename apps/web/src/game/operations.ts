// Client glue for battle plans: builds the map overlay (arrows + hold lines) from your orders,
// the plan being drawn, allies' plans and last turn's results.
import { operationRoute, STANCE_LABELS, type GameView, type MapIndex, type Operation } from "@worldline/shared";
import { getMap, type OperationArrow } from "../map/controller.ts";
import { provinceName, useMap } from "../store.ts";
import { mapIndexFor } from "./fronts.ts";
import { useGame } from "./store.ts";

/** Country indices fighting on `tag`'s side in any war (including itself). */
export function sideOf(view: GameView, tag: string): Set<number> {
  const out = new Set<number>([view.countries.findIndex((c) => c.tag === tag)]);
  for (const w of view.wars) {
    const side = w.attackers.includes(tag) ? w.attackers : w.defenders.includes(tag) ? w.defenders : null;
    for (const t of side ?? []) out.add(view.countries.findIndex((c) => c.tag === t));
  }
  return out;
}

/** Country indices at war with `tag`. */
export function enemiesOf(view: GameView, tag: string): Set<number> {
  const out = new Set<number>();
  for (const w of view.wars) {
    const other = w.attackers.includes(tag) ? w.defenders : w.defenders.includes(tag) ? w.attackers : null;
    for (const t of other ?? []) out.add(view.countries.findIndex((c) => c.tag === t));
  }
  return out;
}

/** Map points (px) along a route, unwrapped so the arrow never jumps across the date line. */
function routePoints(map: MapIndex, route: number[]): [number, number][] {
  const pts: [number, number][] = [];
  for (const id of route) {
    let x = map.cx[id];
    const prev = pts[pts.length - 1];
    if (prev) x = prev[0] + ((((x - prev[0] + map.width / 2) % map.width) + map.width) % map.width) - map.width / 2;
    pts.push([x, map.cy[id]]);
  }
  return pts;
}

/** Border pairs a hold line covers: each held region against neighbours the enemy controls. */
function holdPairs(view: GameView, map: MapIndex, tag: string, regions: number[]): [number, number][] {
  const enemies = enemiesOf(view, tag);
  const pairs: [number, number][] = [];
  for (const id of regions) {
    const facing = (map.neighbors[id] ?? []).filter((n) => enemies.has(view.controllers[n]));
    // A line behind the front still shows: fall back to borders with anyone else.
    const list = facing.length ? facing : (map.neighbors[id] ?? []).filter((n) => view.controllers[n] !== view.controllers[id] && view.controllers[n] >= 0);
    for (const n of list) pairs.push([id, n]);
  }
  return pairs;
}

/** Push the battle-plan overlay for the current view (cleared outside a game and in the editor). */
export function pushOperations() {
  const map = getMap();
  if (!map) return;
  const { view, orders, opDraft } = useGame.getState();
  const { meta, editing } = useMap.getState();
  const me = view?.you.country;
  if (!view || !meta || editing || !me) {
    map.setOperations([], null);
    return;
  }
  const idx = mapIndexFor(meta);
  const arrows: OperationArrow[] = [];
  const holds: [number, number][] = [];
  const colorOf = (tag: string) => view.countries.find((c) => c.tag === tag)?.color ?? "";
  const nameOf = (op: Operation) => op.name?.trim() || "Offensive";
  const add = (id: string, tag: string, op: Operation, style: OperationArrow["style"]) => {
    if (op.kind === "hold") {
      holds.push(...holdPairs(view, idx, tag, op.regions));
      return;
    }
    if (op.regions.length < 2) return;
    const route = operationRoute(idx, op.regions);
    arrows.push({
      id, points: routePoints(idx, route), style, color: colorOf(tag),
      ...(style === "draft" ? {} : { name: nameOf(op), detail: STANCE_LABELS[op.stance] }),
    });
  };

  for (const o of orders) if (o.operation && o.id !== opDraft?.orderId) add(o.id, me, o.operation, "plan");
  if (opDraft) add("draft", me, { ...opDraft }, "draft");
  for (const a of view.allyOperations ?? []) add(`ally:${a.orderId}`, a.country, a.operation, "ally");

  // Last turn's offensives: how far each got along its route.
  if (view.phase === "orders") {
    const side = sideOf(view, me);
    for (const v of view.lastVerdicts) {
      const op = v.operation;
      if (!op || op.kind !== "offensive" || orders.some((o) => o.id === v.orderId)) continue;
      const route = operationRoute(idx, op.regions);
      let reached = 0;
      for (let i = 1; i < route.length && side.has(view.controllers[route[i]]); i++) reached = i;
      arrows.push({
        id: `done:${v.orderId}`, points: routePoints(idx, route), style: "result", color: colorOf(me),
        reached, name: nameOf(op), detail: reached ? `+${reached}` : "no gain",
      });
    }
  }
  map.setOperations(arrows, holds.length ? holds : null);
}

/** Plain-words order text for a plan (players can add notes after it). */
export function describeOperation(op: Operation) {
  const names = op.regions.map(provinceName);
  if (op.kind === "hold") return `${op.name?.trim() || "Hold line"}: hold the line at ${names.join(", ")}.`;
  const [from, ...to] = names;
  return `${op.name?.trim() || "Offensive"}: attack from ${from} toward ${to.join(", then ")} (${STANCE_LABELS[op.stance].toLowerCase()}).`;
}
