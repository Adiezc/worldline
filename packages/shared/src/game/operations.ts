// Battle plans (HOI4-style): players draw an offensive arrow or a hold line on the map. The plan
// travels with an order; the resolver adjudicates it, and the rules engine keeps the result
// inside the plan (only regions along the axis, at a pace set by the odds and the stance).
// Military stays abstract: divisions are the display estimates from fronts.ts.
import { computeFronts, estimateForces, type Front, type ForceEstimate } from "./fronts.ts";
import type { MapIndex } from "./mapIndex.ts";
import type { GameState, Order } from "./state.ts";

export type OperationKind = "offensive" | "hold";
export type OperationStance = "cautious" | "balanced" | "allout";

export interface Operation {
  kind: OperationKind;
  /**
   * Offensive: the jump-off region (held by your side), then objectives in order.
   * Hold: the regions your forces dig in on.
   */
  regions: number[];
  /** Divisions committed to an offensive (a hold line uses the front's garrison). */
  divisions: number;
  stance: OperationStance;
  name?: string;
}

export const MAX_OFFENSIVE_POINTS = 8;
export const MAX_HOLD_REGIONS = 24;
export const STANCE_LABELS: Record<OperationStance, string> = { cautious: "Cautious", balanced: "Balanced", allout: "All-out" };
const STANCE_PACE: Record<OperationStance, number> = { cautious: 0.6, balanced: 1, allout: 1.5 };

/** Wrap-aware centroid distance in map px. */
function dist(map: MapIndex, a: number, b: number) {
  let dx = Math.abs((map.cx[a] ?? 0) - (map.cx[b] ?? 0));
  dx = Math.min(dx, map.width - dx);
  return Math.hypot(dx, (map.cy[a] ?? 0) - (map.cy[b] ?? 0));
}

/** Shortest chain of neighbouring regions from a to b (Dijkstra on centroid distance), or null. */
function shortestPath(map: MapIndex, a: number, b: number): number[] | null {
  if (a === b) return [a];
  const best = new Float64Array(map.count + 1).fill(Infinity);
  const prev = new Int32Array(map.count + 1).fill(-1);
  const done = new Uint8Array(map.count + 1);
  best[a] = 0;
  // ~2,300 regions: a linear scan for the next node is fast enough and allocation-free.
  const open = new Set<number>([a]);
  while (open.size) {
    let u = -1;
    for (const x of open) if (u < 0 || best[x] < best[u]) u = x;
    open.delete(u);
    if (u === b) break;
    done[u] = 1;
    for (const v of map.neighbors[u] ?? []) {
      if (done[v]) continue;
      const d = best[u] + dist(map, u, v);
      if (d < best[v]) {
        best[v] = d;
        prev[v] = u;
        open.add(v);
      }
    }
  }
  if (!Number.isFinite(best[b])) return null;
  const path = [b];
  for (let x = prev[b]; x >= 0; x = prev[x]) path.push(x);
  return path.reverse();
}

/**
 * The regions an offensive passes through: the jump-off region, then the shortest chain of
 * neighbours to each objective in turn (straight on when there is no land link).
 */
export function operationRoute(map: MapIndex, waypoints: number[]): number[] {
  const pts = waypoints.filter((id) => id >= 1 && id <= map.count);
  if (pts.length < 2) return pts;
  const route = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const leg = shortestPath(map, route[route.length - 1], pts[i]) ?? [route[route.length - 1], pts[i]];
    for (const id of leg.slice(1)) if (!route.includes(id)) route.push(id);
  }
  return route;
}

/** Regions an offensive may take: the route past its jump-off point and the regions flanking it. */
export function operationAxis(map: MapIndex, route: number[]): number[] {
  const axis = new Set<number>();
  for (const id of route.slice(1)) {
    axis.add(id);
    for (const n of map.neighbors[id] ?? []) axis.add(n);
  }
  axis.delete(route[0]);
  return [...axis];
}

/**
 * Most regions an offensive can take this turn. `occupy` is the engine's per-country cap; a
 * balanced push at even odds gets about 60% of it, better odds and an all-out stance more.
 */
export function offensivePace(occupy: number, divisions: number, enemyDivisions: number, stance: OperationStance) {
  const ratio = divisions / Math.max(1, enemyDivisions);
  const pace = occupy * 0.6 * Math.min(2, Math.max(0.2, ratio)) ** 0.8 * STANCE_PACE[stance];
  return Math.max(1, Math.round(pace));
}

/** Most hold-line regions the enemy can take this turn: one, two when it outnumbers you 2.5:1. */
export function holdCap(ownDivisions: number, enemyDivisions: number) {
  return enemyDivisions >= 2.5 * Math.max(1, ownDivisions) ? 2 : 1;
}

/** A battle plan resolved against the current map and force estimates. */
export interface OperationPlan {
  orderId: string;
  country: string;
  kind: OperationKind;
  name: string;
  stance: OperationStance;
  /** Divisions committed (offensive) or holding the line (hold). */
  divisions: number;
  enemyTag: string;
  enemyDivisions: number;
  /** Offensive: the route (jump-off first). Hold: the held regions. */
  route: number[];
  /** Regions the plan may take (offensive) or protects (hold). */
  allowed: number[];
  /** Offensive: most regions it may take this turn. Hold: most regions the enemy may take. */
  cap: number;
}

type ForcesWorld = Pick<GameState, "owners" | "controllers" | "countries" | "wars">;

/** Fronts and forces for a world; pass them in when already computed. */
function forcesOf(world: ForcesWorld, map: MapIndex) {
  const input = { owners: world.owners, controllers: world.controllers, countries: world.countries, wars: world.wars, map };
  const fronts = computeFronts(input);
  return { fronts, forces: estimateForces(input, fronts) };
}

/** The front a region sits on for `tag`'s side, with that side's and the enemy's divisions. */
export function frontAt(
  world: ForcesWorld, fronts: Front[], forces: ForceEstimate, tag: string, regions: number[],
): { front: Front; own: number; enemy: number; enemyTag: string } | null {
  for (const id of regions) {
    for (const f of fronts) {
      const war = world.wars.find((w) => w.id === f.warId);
      if (!war) continue;
      const mySide = war.attackers.includes(tag) ? 0 : war.defenders.includes(tag) ? 1 : -1;
      if (mySide < 0) continue;
      if (!f.pairs.some(([a, b]) => (mySide === 0 ? a : b) === id || (mySide === 0 ? b : a) === id)) continue;
      const ff = forces.fronts[f.id];
      if (!ff) continue;
      const [own, enemy] = mySide === 0 ? [ff.a, ff.b] : [ff.b, ff.a];
      return { front: f, own: own.divisions, enemy: enemy.divisions, enemyTag: enemy.tag };
    }
  }
  return null;
}

/** Turn this turn's orders with battle plans into enforceable plans. */
export function planOperations(state: GameState, map: MapIndex, orders: Order[], occupy: number): OperationPlan[] {
  const withOps = orders.filter((o) => o.operation);
  if (!withOps.length) return [];
  const { fronts, forces } = forcesOf(state, map);
  const plans: OperationPlan[] = [];
  for (const o of withOps) {
    const op = o.operation!;
    const total = forces.countries[o.country]?.total ?? 0;
    const name = op.name?.trim() || (op.kind === "hold" ? "Hold line" : "Offensive");
    if (op.kind === "offensive") {
      const route = operationRoute(map, op.regions);
      if (route.length < 2) continue;
      const at = frontAt(state, fronts, forces, o.country, route);
      const target = state.countries[state.controllers[route[1]]]?.tag ?? "";
      const enemyTag = at?.enemyTag ?? target;
      // Without a front of their own, the defenders are whatever the target holds back home.
      const enemyDivisions = at?.enemy ?? Math.max(1, Math.round(forces.countries[target]?.reserve ?? 1));
      const divisions = Math.max(1, Math.min(Math.round(op.divisions), Math.max(1, total)));
      plans.push({
        orderId: o.id, country: o.country, kind: "offensive", name, stance: op.stance,
        divisions, enemyTag, enemyDivisions, route,
        allowed: operationAxis(map, route),
        cap: offensivePace(occupy, divisions, enemyDivisions, op.stance),
      });
    } else {
      const route = [...new Set(op.regions)].filter((id) => id >= 1 && id <= map.count);
      if (!route.length) continue;
      const at = frontAt(state, fronts, forces, o.country, route);
      const own = at?.own ?? Math.round(total * 0.5);
      const enemy = at?.enemy ?? 0;
      plans.push({
        orderId: o.id, country: o.country, kind: "hold", name, stance: op.stance,
        divisions: own, enemyTag: at?.enemyTag ?? "", enemyDivisions: enemy, route,
        allowed: route, cap: holdCap(own, enemy),
      });
    }
  }
  return plans;
}

/**
 * Clean a client-sent plan: known kinds and stances, real regions, an offensive that jumps off
 * from land the player's side controls, a hold line only on land the player controls.
 * Returns undefined when nothing usable is left.
 */
export function sanitizeOperation(raw: unknown, state: GameState, map: MapIndex, tag: string): Operation | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<Operation>;
  const kind = r.kind === "hold" ? "hold" : r.kind === "offensive" ? "offensive" : null;
  if (!kind || !Array.isArray(r.regions)) return undefined;
  const stance: OperationStance = r.stance === "cautious" || r.stance === "allout" ? r.stance : "balanced";
  const me = state.countries.findIndex((c) => c.tag === tag);
  if (me < 0) return undefined;
  const allies = new Set<number>([me]);
  for (const w of state.wars) {
    const side = w.attackers.includes(tag) ? w.attackers : w.defenders.includes(tag) ? w.defenders : null;
    for (const t of side ?? []) allies.add(state.countries.findIndex((c) => c.tag === t));
  }
  let regions = [...new Set(r.regions.map(Number))].filter((id) => Number.isInteger(id) && id >= 1 && id <= map.count);
  if (kind === "offensive") {
    regions = regions.slice(0, MAX_OFFENSIVE_POINTS);
    if (regions.length < 2 || !allies.has(state.controllers[regions[0]])) return undefined;
  } else {
    regions = regions.filter((id) => state.controllers[id] === me).slice(0, MAX_HOLD_REGIONS);
    if (!regions.length) return undefined;
  }
  const divisions = Math.max(1, Math.min(999, Math.round(Number(r.divisions) || 1)));
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) || undefined : undefined;
  return { kind, regions, divisions, stance, name };
}
