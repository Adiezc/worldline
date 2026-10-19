import { describe, expect, test } from "bun:test";
import { expireCalls, simTick } from "../src/game/sim.ts";
import { callsToArms } from "../src/game/engine.ts";
import { computeTiers } from "../src/game/salience.ts";
import { getRelation } from "../src/game/state.ts";
import { addHuman, country, idx, MAP, makeState, prov, startProvinces, war } from "./fixtures.ts";

describe("simTick", () => {
  test("values stay finite and in range after 100 ticks of 30 days, even under heavy stress", () => {
    const s = makeState();
    war(s, ["RUS", "BLR"], ["UKR"]);
    for (const id of startProvinces("UKR")) s.controllers[id] = idx(s, "RUS"); // fully occupied
    // Pile on sanctions far beyond anything sensible.
    for (let i = 0; i < 20; i++) s.sanctions.push({ id: `s${i}`, target: "RUS", by: s.countries.slice(0, 40).map((c) => c.tag), source: "", since: s.date });
    country(s, "UKR").stability = 0;
    country(s, "UKR").warExhaustion = 100;
    country(s, "TUV").population = 0.011;
    s.relations["DEU|FRA"] = 100;
    s.relations["IND|PAK"] = -100;
    s.relations["RUS|UKR"] = -100;
    for (let i = 0; i < 100; i++) simTick(s, 30);
    for (const k of s.countries) {
      for (const key of ["gdp", "population", "stability", "military", "warExhaustion"] as const) {
        expect(Number.isFinite(k[key])).toBe(true);
      }
      expect(k.gdp).toBeGreaterThan(0);
      expect(k.population).toBeGreaterThan(0);
      for (const key of ["stability", "military", "warExhaustion"] as const) {
        expect(k[key]).toBeGreaterThanOrEqual(0);
        expect(k[key]).toBeLessThanOrEqual(100);
      }
    }
    for (const v of Object.values(s.relations)) {
      expect(Number.isFinite(v)).toBe(true);
      expect(Math.abs(v)).toBeLessThanOrEqual(100);
    }
    for (const o of s.organizations) expect(o.cohesion).toBeGreaterThanOrEqual(0);
    // Relations between belligerents do not thaw; others fade towards neutral.
    expect(getRelation(s, "RUS", "UKR")).toBe(-100);
    expect(Math.abs(getRelation(s, "IND", "PAK"))).toBeLessThan(10);
  });

  test("small relations fade too (no integer rounding lock-in)", () => {
    const s = makeState();
    s.relations["DEU|FRA"] = 12;
    s.relations["IND|PAK"] = -12;
    for (let i = 0; i < 12; i++) simTick(s, 30);
    expect(getRelation(s, "DEU", "FRA")).toBeLessThan(9);
    expect(getRelation(s, "IND", "PAK")).toBeGreaterThan(-9);
    for (let i = 0; i < 200; i++) simTick(s, 30);
    expect(s.relations["DEU|FRA"]).toBeUndefined();
  });

  test("war raises war exhaustion and wears militaries; peace lowers exhaustion", () => {
    const s = makeState();
    war(s, ["RUS"], ["UKR"]);
    country(s, "GEO").warExhaustion = 50;
    simTick(s, 30);
    expect(country(s, "RUS").warExhaustion).toBeCloseTo(1.5, 5);
    expect(country(s, "RUS").military).toBeLessThan(30);
    // Occupied Donetsk/Luhansk make Ukraine tire faster.
    expect(country(s, "UKR").warExhaustion).toBeGreaterThan(country(s, "RUS").warExhaustion);
    expect(country(s, "GEO").warExhaustion).toBe(45);
    expect(country(s, "FRA").warExhaustion).toBe(0);
  });

  test("sanctions reduce growth", () => {
    const a = makeState(), b = makeState();
    b.sanctions.push({ id: "s1", target: "IRN", by: ["USA", "GBR", "FRA", "DEU", "ITA", "JPN"], source: "", since: b.date });
    simTick(a, 365);
    simTick(b, 365);
    expect(country(b, "IRN").gdp).toBeLessThan(country(a, "IRN").gdp);
    expect(country(b, "IRN").stability).toBeLessThan(country(a, "IRN").stability);
    // Trade-bloc members grow a little faster than identical non-members.
    expect(country(a, "AUT").gdp).toBeGreaterThan(country(a, "CHE").gdp);
  });

  test("expireCalls applies refusals after 2 turns", () => {
    const s = makeState();
    war(s, ["RUS"], ["EST"]);
    s.wars[0].calls = callsToArms(s, ["EST"], ["RUS"], 1);
    const nato = s.organizations.find((o) => o.id === "nato")!;
    s.turn = 2;
    expect(expireCalls(s)).toEqual([]);
    expect(nato.cohesion).toBe(70);
    s.turn = 3;
    const refusals = expireCalls(s);
    expect(refusals).toHaveLength(31);
    expect(refusals[0]).toMatchObject({ via: "NATO", war: s.wars[0].name });
    expect(s.wars[0].calls).toEqual([]);
    expect(nato.cohesion).toBe(0); // 31 refusals × 6, clamped
    expect(getRelation(s, "EST", "POL")).toBe(-12);
  });
});

describe("computeTiers", () => {
  test("a human country, its neighbours and war enemies are engaged", () => {
    const s = makeState();
    addHuman(s, "UKR");
    war(s, ["ARG"], ["UKR"]);
    s.treaties.push({ id: "t1", type: "trade", members: ["UKR", "JPN"], since: s.date });
    const t = computeTiers(s, MAP);
    for (const tag of ["UKR", "RUS", "BLR", "POL", "MDA", "ROU", "HUN", "SVK", "ARG", "JPN"]) expect(t.engaged).toContain(tag);
    expect(t.engaged).not.toContain("BRA");
    expect(t.movers).not.toContain("RUS"); // tiers are disjoint
  });

  test("dead countries are never in any tier; chat partners are engaged", () => {
    const s = makeState();
    addHuman(s, "UKR");
    country(s, "BLR").alive = false;
    s.chats.push({ id: "c1", members: ["UKR", "NZL"], messages: [], lastTurn: 1 });
    const t = computeTiers(s, MAP);
    expect([...t.engaged, ...t.movers, ...t.background]).not.toContain("BLR");
    expect(t.engaged).toContain("NZL");
  });

  test("movers are capped", () => {
    const s = makeState();
    addHuman(s, "UKR");
    s.events.push({ id: "e", turn: 1, date: s.date, headline: "x", body: "", countries: ["CHL", "PER", "BOL"], causes: [], effects: [], scope: "world" });
    expect(computeTiers(s, MAP, { maxMovers: 5 }).movers).toEqual(["CHL", "PER", "BOL", "USA", "CHN"]);
    expect(computeTiers(s, MAP).movers.length).toBeLessThanOrEqual(20);
  });

  test("background rotation covers every remaining country within ceil(n/10) rotations", () => {
    const s = makeState();
    addHuman(s, "UKR");
    const first = computeTiers(s, MAP);
    const placed = new Set([...first.engaged, ...first.movers]);
    const rest = s.countries.filter((c) => c.alive && !placed.has(c.tag)).map((c) => c.tag);
    expect(rest.length).toBeGreaterThan(100);
    const seen = new Set<string>();
    for (let i = 0; i < Math.ceil(rest.length / 10); i++) {
      const t = computeTiers(s, MAP);
      expect(t.background).toHaveLength(10);
      for (const b of t.background) seen.add(b);
      s.rotation += 10;
    }
    expect([...seen].sort()).toEqual(rest.sort());
  });
});

void prov;
