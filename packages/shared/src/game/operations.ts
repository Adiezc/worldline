// Battle plans (HOI4-style): players draw an offensive arrow or a hold line on the map. The plan
// travels with an order; the resolver judges how it goes from the situation, shaded by a
// "fortune of war" the engine rolls, and the rules engine keeps the result inside the plan
// (only regions along the axis, at a pace set by the stance and that roll). There is no
// division arithmetic: how strong each side is, is the narrator's judgement.
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
 * The fortune of war: how a plan's period goes beyond what the situation alone would suggest.
 * The engine rolls it (seeded, so replaying a turn rolls the same); the narrator must honour it.
 * `pace` scales an offensive's ceiling; `hold` is how many regions a hold line can lose.
 */
export type Fortune = "disastrous" | "poor" | "even" | "good" | "exceptional";
export const FORTUNES: Record<Fortune, { p: number; pace: number; hold: number; text: string }> = {
  disastrous: { p: 0.1, pace: 0.3, hold: 3, text: "things go badly wrong: a blunder, a collapse in supply, a defence or attack that surprises everyone" },
  poor: { p: 0.2, pace: 0.65, hold: 2, text: "friction wins: weather, poor intelligence or stubborn resistance make it go worse than expected" },
  even: { p: 0.4, pace: 1, hold: 1, text: "events follow the situation; no great luck either way" },
  good: { p: 0.2, pace: 1.3, hold: 1, text: "things break your way: a weak point found, the enemy slow to react" },
  exceptional: { p: 0.1, pace: 1.7, hold: 0, text: "a rare success: a breakthrough, a rout or an unbreakable defence" },
};
const FORTUNE_ORDER: Fortune[] = ["disastrous", "poor", "even", "good", "exceptional"];

/** A uniform number in [0, 1) from a string (FNV-1a hash into a mulberry32 step). */
function seeded(key: string) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let t = (h += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** The fortune for one plan in one turn: the same game, turn and order always roll the same. */
export function rollFortune(key: string): Fortune {
  let u = seeded(key);
  for (const f of FORTUNE_ORDER) {
    if (u < FORTUNES[f].p) return f;
    u -= FORTUNES[f].p;
  }
  return "even";
}

/**
 * Most regions an offensive can take this turn. `occupy` is the engine's per-country cap; a
 * balanced push with even fortune gets about 60% of it. Only a disastrous roll can mean none.
 */
export function offensivePace(occupy: number, stance: OperationStance, fortune: Fortune) {
  const pace = Math.round(occupy * 0.6 * STANCE_PACE[stance] * FORTUNES[fortune].pace);
  return fortune === "disastrous" ? Math.max(0, pace) : Math.max(1, pace);
}

/** A battle plan resolved against the current map. */
export interface OperationPlan {
  orderId: string;
  country: string;
  kind: OperationKind;
  name: string;
  stance: OperationStance;
  /** The main country on the other side ("" when there is none). */
  enemyTag: string;
  /** Offensive: the route (jump-off first). Hold: the held regions. */
  route: number[];
  /** Regions the plan may take (offensive) or protects (hold). */
  allowed: number[];
  /** Offensive: most regions it may take this turn. Hold: most regions the enemy may take. */
  cap: number;
  fortune: Fortune;
}

/** Country indices at war with `tag`. */
function enemiesOf(state: GameState, tag: string) {
  const out = new Set<number>();
  for (const w of state.wars) {
    const other = w.attackers.includes(tag) ? w.defenders : w.defenders.includes(tag) ? w.attackers : null;
    for (const t of other ?? []) out.add(state.countries.findIndex((c) => c.tag === t));
  }
  return out;
}

/** The enemy most of `regions` (or their neighbours) is held by. */
function mainEnemy(state: GameState, map: MapIndex, tag: string, regions: number[], neighbours: boolean) {
  const enemies = enemiesOf(state, tag);
  const count = new Map<number, number>();
  for (const id of regions) {
    for (const r of neighbours ? (map.neighbors[id] ?? []) : [id]) {
      const c = state.controllers[r];
      if (enemies.has(c)) count.set(c, (count.get(c) ?? 0) + 1);
    }
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0];
  return best ? state.countries[best[0]]?.tag ?? "" : "";
}

/** Turn this turn's orders with battle plans into enforceable plans, rolling each one's fortune. */
export function planOperations(state: GameState, map: MapIndex, orders: Order[], occupy: number): OperationPlan[] {
  const plans: OperationPlan[] = [];
  for (const o of orders) {
    const op = o.operation;
    if (!op) continue;
    const name = op.name?.trim() || (op.kind === "hold" ? "Hold line" : "Offensive");
    const fortune = rollFortune(`${state.id}:${state.turn}:${o.id}`);
    if (op.kind === "offensive") {
      const route = operationRoute(map, op.regions);
      if (route.length < 2) continue;
      const enemyTag = mainEnemy(state, map, o.country, route.slice(1), false) || (state.countries[state.controllers[route[1]]]?.tag ?? "");
      plans.push({
        orderId: o.id, country: o.country, kind: "offensive", name, stance: op.stance, enemyTag, route,
        allowed: operationAxis(map, route), cap: offensivePace(occupy, op.stance, fortune), fortune,
      });
    } else {
      const route = [...new Set(op.regions)].filter((id) => id >= 1 && id <= map.count);
      if (!route.length) continue;
      plans.push({
        orderId: o.id, country: o.country, kind: "hold", name, stance: op.stance,
        enemyTag: mainEnemy(state, map, o.country, route, true), route, allowed: route, cap: FORTUNES[fortune].hold, fortune,
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
  const name = typeof r.name === "string" ? r.name.trim().slice(0, 40) || undefined : undefined;
  return { kind, regions, stance, name };
}
