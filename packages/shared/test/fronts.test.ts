import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { computeFronts, estimateForces, frontName, type FrontsInput } from "../src/game/fronts.ts";
import type { GameState } from "../src/game/state.ts";
import type { ScenarioSeed } from "../src/game/scenario.ts";
import { idx, MAP, makeState, prov, war } from "./fixtures.ts";

const SEED = JSON.parse(readFileSync(new URL("../../scenarios/modern-2026/seed.json", import.meta.url), "utf8")) as ScenarioSeed;

const input = (s: GameState): FrontsInput => ({ owners: s.owners, controllers: s.controllers, countries: s.countries, wars: s.wars, map: MAP });

/** Test state with the real modern-start stats (military, population, GDP, exhaustion, wars). */
function realState() {
  const s = makeState();
  s.countries = structuredClone(SEED.countries);
  s.wars = structuredClone(SEED.wars);
  return s;
}

function checkSums(s: GameState) {
  const fronts = computeFronts(input(s));
  const forces = estimateForces(input(s), fronts);
  const perFront = new Map<string, Map<string, number>>();
  for (const c of Object.values(forces.countries)) {
    expect(c.reserve).toBeGreaterThanOrEqual(0);
    expect(c.reserve + c.fronts.reduce((sum, f) => sum + f.divisions, 0)).toBe(c.total);
    for (const f of c.fronts) {
      if (!perFront.has(f.frontId)) perFront.set(f.frontId, new Map());
      perFront.get(f.frontId)!.set(c.tag, f.divisions);
    }
  }
  for (const f of fronts) {
    const ff = forces.fronts[f.id];
    for (const side of [ff.a, ff.b]) expect(side.divisions).toBe(side.by.reduce((sum, b) => sum + b.divisions, 0));
    const all = [...ff.a.by, ...ff.b.by];
    expect(all.length).toBe(perFront.get(f.id)?.size ?? 0);
    for (const b of all) expect(perFront.get(f.id)!.get(b.tag)).toBe(b.divisions);
  }
  return { fronts, forces };
}

describe("computeFronts", () => {
  test("no wars, no fronts", () => {
    expect(computeFronts(input(makeState()))).toEqual([]);
  });

  test("Russia–Ukraine front runs along the Donetsk/Luhansk occupation line", () => {
    const s = makeState();
    const w = war(s, ["RUS"], ["UKR"]);
    const fronts = computeFronts(input(s));
    expect(fronts.length).toBe(1);
    const f = fronts[0];
    expect(f.warId).toBe(w);
    expect(f.sideA).toBe("RUS");
    expect(f.sideB).toBe("UKR");
    const donetsk = prov("Donets'k"), luhansk = prov("Luhans'k"), kharkiv = prov("Kharkiv");
    // Occupied oblasts are on Russia's side of the line.
    expect(s.controllers[donetsk]).toBe(idx(s, "RUS"));
    const sideA = new Set(f.pairs.map((p) => p[0])), sideB = new Set(f.pairs.map((p) => p[1]));
    expect(sideA.has(donetsk)).toBe(true);
    expect(sideA.has(luhansk)).toBe(true);
    expect(sideB.has(kharkiv)).toBe(true);
    expect(f.pairs.some(([a, b]) => a === donetsk && b === kharkiv)).toBe(true);
    for (const [a, b] of f.pairs) {
      expect(MAP.neighbors[a]).toContain(b);
      expect(s.controllers[a]).toBe(idx(s, "RUS"));
      expect(s.controllers[b]).toBe(idx(s, "UKR"));
    }
    expect(f.length).toBeGreaterThan(500);
    // Russian counter sits east of the Ukrainian one.
    expect(f.anchorA[0]).toBeGreaterThan(f.anchorB[0]);
  });

  test("the line moves with occupation", () => {
    const s = makeState();
    war(s, ["RUS"], ["UKR"]);
    const kharkiv = prov("Kharkiv");
    s.controllers[kharkiv] = idx(s, "RUS");
    const f = computeFronts(input(s))[0];
    expect(f.pairs.some(([a]) => a === kharkiv)).toBe(true);
    expect(f.pairs.some(([, b]) => b === kharkiv)).toBe(false);
  });

  test("a war between non-adjacent countries has no land front", () => {
    const s = makeState();
    war(s, ["USA"], ["CHN"]);
    expect(computeFronts(input(s))).toEqual([]);
    const forces = estimateForces(input(s));
    expect(forces.countries.USA.atWar).toBe(true);
    expect(forces.countries.USA.fronts).toEqual([]);
    expect(forces.countries.USA.reserve).toBe(forces.countries.USA.total);
  });

  test("co-belligerents hold and reinforce the line", () => {
    const s = makeState();
    war(s, ["RUS", "BLR"], ["UKR", "USA"]);
    const { fronts, forces } = checkSums(s);
    const main = fronts.find((f) => f.sideB === "UKR")!;
    expect(main.holdersA.RUS).toBeGreaterThan(0);
    expect(main.holdersA.BLR).toBeGreaterThan(0);
    // Belarus–Ukraine border joins the Russian line into one contiguous front.
    expect(fronts.filter((f) => f.holdersB.UKR).length).toBe(1);
    // The US has no front of its own, so it sends an expedition.
    const ff = forces.fronts[main.id];
    expect(ff.b.by.some((b) => b.tag === "USA")).toBe(true);
    expect(ff.a.by.map((b) => b.tag)).toEqual(expect.arrayContaining(["RUS", "BLR"]));
  });

  test("separate wars make separate fronts", () => {
    const s = makeState();
    war(s, ["RUS"], ["UKR"]);
    war(s, ["IND"], ["PAK"]);
    const fronts = computeFronts(input(s));
    expect(new Set(fronts.map((f) => f.warId)).size).toBe(2);
    expect(fronts.find((f) => f.sideA === "IND")?.sideB).toBe("PAK");
  });
});

describe("estimateForces", () => {
  test("plausible totals for the modern start", () => {
    const s = realState();
    const { countries } = estimateForces(input(s));
    const total = (t: string) => countries[t].total;
    expect(total("USA")).toBeGreaterThanOrEqual(90);
    expect(total("USA")).toBeLessThanOrEqual(150);
    expect(total("RUS")).toBeGreaterThanOrEqual(110);
    expect(total("RUS")).toBeLessThanOrEqual(150);
    expect(total("UKR")).toBeGreaterThanOrEqual(60);
    expect(total("UKR")).toBeLessThanOrEqual(90);
    expect(total("VEN")).toBeGreaterThanOrEqual(10);
    expect(total("VEN")).toBeLessThanOrEqual(20);
    for (const t of ["VAT", "AND", "MCO", "LIE", "SMR"]) expect(total(t)).toBe(1);
    expect(countries.UKR.existential).toBe(true);
    expect(countries.RUS.existential).toBe(false);
  });

  test("war exhaustion reduces strength", () => {
    const s = realState();
    const before = estimateForces(input(s)).countries.RUS.total;
    s.countries[idx(s, "RUS")].warExhaustion = 90;
    expect(estimateForces(input(s)).countries.RUS.total).toBeLessThan(before);
  });

  test("allocations sum to each country's total and each front's sides", () => {
    const s = realState();
    war(s, ["CHN", "PRK"], ["IND", "KOR"]);
    war(s, ["VEN"], ["GUY", "BRA"]);
    const { fronts, forces } = checkSums(s);
    expect(fronts.length).toBeGreaterThanOrEqual(3);
    // Reserve shares: ~30% normally, ~10% when existentially threatened.
    const rus = forces.countries.RUS, ukr = forces.countries.UKR;
    expect(rus.reserve).toBe(rus.total - Math.round(rus.total * 0.7));
    expect(ukr.reserve).toBe(ukr.total - Math.round(ukr.total * 0.9));
  });

  test("front names", () => {
    expect(frontName("UKR")).toBe("the Ukrainian front");
    expect(frontName("XYZ", "Freedonia")).toBe("the Freedonia front");
  });
});

describe("counter placement", () => {
  test("each side's counter sits in territory its side holds, next to the line", () => {
    const s = realState();
    const nearest = (x: number, y: number) => {
      let best = 1, bd = Infinity;
      for (let id = 1; id <= MAP.count; id++) {
        const d = Math.hypot(MAP.cx[id] - x, MAP.cy[id] - y);
        if (d < bd) { bd = d; best = id; }
      }
      return best;
    };
    const fronts = computeFronts(input(s));
    expect(fronts.length).toBeGreaterThan(0);
    for (const f of fronts) {
      const holderA = s.countries[s.controllers[nearest(...f.anchorA)]].tag;
      const holderB = s.countries[s.controllers[nearest(...f.anchorB)]].tag;
      expect(Object.keys(f.holdersA)).toContain(holderA);
      expect(Object.keys(f.holdersB)).toContain(holderB);
      // Close to each other: both hug the same stretch of line.
      expect(Math.hypot(f.anchorA[0] - f.anchorB[0], f.anchorA[1] - f.anchorB[1])).toBeLessThan(90);
    }
  });
});
