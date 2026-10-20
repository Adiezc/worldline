import { describe, expect, test } from "bun:test";
import { applyEvent, occupyCap } from "../src/game/engine.ts";
import {
  holdCap, offensivePace, operationAxis, operationRoute, planOperations, sanitizeOperation, type OperationPlan,
} from "../src/game/operations.ts";
import type { GameState, Order } from "../src/game/state.ts";
import { addHuman, ctx, ev, idx, MAP, makeState, prov, war } from "./fixtures.ts";

const KHARKIV = prov("Kharkiv", "UKR");
const SUMY = prov("Sumy", "UKR");
const LVIV = prov("L'viv", "UKR");
const DONETSK = prov("Donets'k", "UKR");
const BELGOROD = prov("Belgorod", "RUS");
const KURSK = prov("Kursk", "RUS");
const ROSTOV = prov("Rostov", "RUS");
const VORONEZH = prov("Voronezh", "RUS");
const reasons = (r: { reason: string }[]) => r.map((x) => x.reason).join(" | ");

/** Ukraine (human) at war with Russia, with the given battle plan as order o1. */
function setup(operation: Order["operation"]) {
  const s = makeState();
  addHuman(s, "UKR");
  war(s, ["RUS"], ["UKR"]);
  const order: Order = { id: "o1", playerId: "p_UKR", country: "UKR", text: "Offensive", operation };
  return { s, order };
}

function enforce(s: GameState, plans: OperationPlan[], orders: Order[]) {
  const c = ctx(30, orders.map((o) => ({ id: o.id, country: o.country })));
  c.operations = plans.map((p) => ({ orderId: p.orderId, country: p.country, kind: p.kind, allowed: new Set(p.allowed), cap: p.cap, used: 0 }));
  return c;
}

describe("routes and axes", () => {
  test("the route chains neighbours from the jump-off through each objective", () => {
    const route = operationRoute(MAP, [KHARKIV, KURSK]);
    expect(route[0]).toBe(KHARKIV);
    expect(route.at(-1)).toBe(KURSK);
    for (let i = 1; i < route.length; i++) expect(MAP.neighbors[route[i - 1]]).toContain(route[i]);
  });

  test("the axis covers the route past the jump-off and its flanks, not the jump-off itself", () => {
    const route = operationRoute(MAP, [KHARKIV, BELGOROD]);
    const axis = operationAxis(MAP, route);
    expect(axis).toContain(BELGOROD);
    expect(axis).not.toContain(KHARKIV);
    expect(axis).not.toContain(LVIV);
  });

  test("pace grows with the odds and the stance; hold lines give at most one or two regions", () => {
    expect(offensivePace(5, 40, 80, "balanced")).toBeLessThan(offensivePace(5, 80, 40, "balanced"));
    expect(offensivePace(5, 60, 60, "cautious")).toBeLessThan(offensivePace(5, 60, 60, "allout"));
    expect(offensivePace(5, 1, 500, "cautious")).toBe(1);
    expect(holdCap(60, 80)).toBe(1);
    expect(holdCap(20, 80)).toBe(2);
  });
});

describe("sanitizing plans", () => {
  test("an offensive must jump off from land its side controls", () => {
    const { s } = setup(undefined);
    expect(sanitizeOperation({ kind: "offensive", regions: [KHARKIV, BELGOROD], divisions: 30, stance: "allout" }, s, MAP, "UKR"))
      .toEqual({ kind: "offensive", regions: [KHARKIV, BELGOROD], divisions: 30, stance: "allout", name: undefined });
    expect(sanitizeOperation({ kind: "offensive", regions: [BELGOROD, KURSK], divisions: 30, stance: "balanced" }, s, MAP, "UKR")).toBeUndefined();
    expect(sanitizeOperation({ kind: "bombard", regions: [KHARKIV, BELGOROD] }, s, MAP, "UKR")).toBeUndefined();
  });

  test("a hold line keeps only regions the player controls", () => {
    const { s } = setup(undefined);
    const op = sanitizeOperation({ kind: "hold", regions: [KHARKIV, BELGOROD, SUMY], divisions: 5, stance: "balanced" }, s, MAP, "UKR");
    expect(op?.regions).toEqual([KHARKIV, SUMY]);
  });
});

describe("enforcing plans", () => {
  test("an offensive's gains stay on its axis", () => {
    const { s, order } = setup({ kind: "offensive", regions: [KHARKIV, BELGOROD], divisions: 60, stance: "balanced" });
    const plans = planOperations(s, MAP, [order], occupyCap(s, 30));
    expect(plans).toHaveLength(1);
    const c = enforce(s, plans, [order]);
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [BELGOROD, ROSTOV], controller: "UKR" }], { causes: ["o1"] }), c);
    expect(s.controllers[BELGOROD]).toBe(idx(s, "UKR"));
    expect(s.controllers[ROSTOV]).toBe(idx(s, "RUS"));
    expect(reasons(r.rejected)).toContain("outside the offensive's axis");
  });

  test("an offensive stops at its pace", () => {
    const { s, order } = setup({ kind: "offensive", regions: [KHARKIV, VORONEZH], divisions: 5, stance: "cautious" });
    const [plan] = planOperations(s, MAP, [order], occupyCap(s, 30));
    expect(plan.cap).toBe(1);
    const c = enforce(s, [plan], [order]);
    const targets = plan.route.slice(1);
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: targets, controller: "UKR" }], { causes: ["o1"] }), c);
    expect(targets.filter((id) => s.controllers[id] === idx(s, "UKR"))).toHaveLength(1);
    expect(reasons(r.rejected)).toContain("pace");
  });

  test("a hold line limits how much the enemy can take of it", () => {
    const { s, order } = setup({ kind: "hold", regions: [KHARKIV, SUMY], divisions: 0, stance: "balanced" });
    const plans = planOperations(s, MAP, [order], occupyCap(s, 30));
    expect(plans[0].cap).toBeGreaterThanOrEqual(1);
    const c = enforce(s, plans, [order]);
    c.operations![0].cap = 1;
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [KHARKIV, SUMY, DONETSK], controller: "RUS" }]), c);
    const lost = [KHARKIV, SUMY].filter((id) => s.controllers[id] === idx(s, "RUS"));
    expect(lost).toHaveLength(1);
    expect(reasons(r.rejected)).toContain("hold line held");
  });

  test("orders without a plan keep the usual occupation rules", () => {
    const { s } = setup(undefined);
    const plain: Order = { id: "o2", playerId: "p_UKR", country: "UKR", text: "Push into Belgorod" };
    const c = enforce(s, [], [plain]);
    applyEvent(s, MAP, ev([{ type: "setController", provinces: [BELGOROD], controller: "UKR" }], { causes: ["o2"] }), c);
    expect(s.controllers[BELGOROD]).toBe(idx(s, "UKR"));
  });
});
