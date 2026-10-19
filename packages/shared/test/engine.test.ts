import { describe, expect, test } from "bun:test";
import { applyEvent, callsToArms, removeCountry, uniqueTag } from "../src/game/engine.ts";
import { atWar, getRelation, relKey, type GameState } from "../src/game/state.ts";
import { addHuman, country, ctx, ev, frontOrder, idx, MAP, makeState, NATO32, prov, startProvinces, war } from "./fixtures.ts";

const DONETSK = prov("Donets'k", "UKR");
const LUHANSK = prov("Luhans'k", "UKR");
const KHARKIV = prov("Kharkiv", "UKR");
const SUMY = prov("Sumy", "UKR");
const BELGOROD = prov("Belgorod", "RUS");
const ROSTOV = prov("Rostov", "RUS");
const NOVGOROD = prov("Novgorod", "RUS");
const KAMCHATKA = prov("Kamchatka", "RUS");
const reasons = (r: { reason: string }[]) => r.map((x) => x.reason).join(" | ");

describe("fixtures", () => {
  test("start state is consistent with the map", () => {
    const s = makeState();
    expect(s.owners.length).toBe(MAP.count + 1);
    expect(s.countries.length).toBeGreaterThan(190);
    expect(s.owners[DONETSK]).toBe(idx(s, "UKR"));
    expect(s.controllers[DONETSK]).toBe(idx(s, "RUS")); // occupied at scenario start
    expect(MAP.neighbors[KHARKIV]).toContain(BELGOROD);
  });
});

describe("transferProvinces", () => {
  test("rejected without peace, treaty, secession or consent", () => {
    const s = makeState();
    const e = ev([{ type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "RUS" }]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("peace deal");
    expect(s.owners[DONETSK]).toBe(idx(s, "UKR"));
    expect(e.mapDiff).toBeUndefined();
  });

  test("allowed together with makePeace in the same event (in either order)", () => {
    const s = makeState();
    const w = war(s, ["RUS"], ["UKR"]);
    const e = ev([
      { type: "transferProvinces", provinces: [DONETSK, DONETSK, 99999, KHARKIV], from: "UKR", to: "RUS" },
      { type: "makePeace", warId: w, terms: "ceasefire" },
    ]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.rejected).toHaveLength(0);
    expect(s.owners[DONETSK]).toBe(idx(s, "RUS"));
    expect(s.controllers[DONETSK]).toBe(idx(s, "RUS"));
    expect(s.wars).toHaveLength(0);
    // Only the provinces that actually moved are recorded (deduplicated, invalid ids dropped).
    expect(r.applied[0]).toMatchObject({ type: "transferProvinces", provinces: [DONETSK, KHARKIV] });
  });

  test("allowed with a treaty between the two countries in the same event", () => {
    const s = makeState();
    const r = applyEvent(s, MAP, ev([
      { type: "createTreaty", treatyType: "trade", members: ["UKR", "RUS"] },
      { type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "RUS" },
    ]), ctx());
    expect(r.applied).toHaveLength(2);
    expect(s.owners[DONETSK]).toBe(idx(s, "RUS"));
  });

  test("rejects provinces the ceding country does not own, unknown and dead countries", () => {
    const s = makeState();
    const w = war(s, ["RUS"], ["UKR"]);
    const peace = { type: "makePeace" as const, warId: w, terms: "" };
    let r = applyEvent(s, MAP, ev([peace, { type: "transferProvinces", provinces: [ROSTOV], from: "UKR", to: "RUS" }]), ctx());
    expect(reasons(r.rejected)).toContain("belong to the ceding country");
    const s2 = makeState();
    r = applyEvent(s2, MAP, ev([{ type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "ZZZ" }]), ctx());
    expect(reasons(r.rejected)).toContain("unknown country");
    // A dead country cannot receive land even with a legitimising treaty.
    const s3 = makeState();
    country(s3, "BLR").alive = false;
    r = applyEvent(s3, MAP, ev([
      { type: "createTreaty", treatyType: "trade", members: ["UKR", "BLR"] },
      { type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "BLR" },
    ]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(s3.owners[DONETSK]).toBe(idx(s3, "UKR"));
  });

  test("a peace blocked by a player does not legitimise a transfer between NPCs", () => {
    const s = makeState();
    addHuman(s, "USA");
    const w = war(s, ["RUS"], ["UKR", "USA"]);
    const r = applyEvent(s, MAP, ev([
      { type: "makePeace", warId: w, terms: "" },
      { type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "RUS" },
    ]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(s.owners[DONETSK]).toBe(idx(s, "UKR"));
    expect(s.wars).toHaveLength(1);
  });
});

describe("setController", () => {
  test("rejected when not at war with the current controller", () => {
    const s = makeState();
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [KHARKIV], controller: "RUS" }]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("not at war");
    expect(s.controllers[KHARKIV]).toBe(idx(s, "UKR"));
  });

  test("allowed for an adjacent enemy province; declareWar earlier in the event legitimises it", () => {
    const s = makeState();
    const e = ev([
      { type: "declareWar", attackers: ["RUS"], defenders: ["UKR"], goal: "conquest" },
      { type: "setController", provinces: [KHARKIV], controller: "RUS" },
    ]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.rejected).toHaveLength(0);
    expect(s.controllers[KHARKIV]).toBe(idx(s, "RUS"));
    expect(s.owners[KHARKIV]).toBe(idx(s, "UKR"));
    expect(e.mapDiff).toEqual([{ province: KHARKIV, owner: idx(s, "UKR"), controller: idx(s, "RUS") }]);
  });

  test("rejected when not adjacent (inland province far from the front)", () => {
    const s = makeState();
    war(s, ["UKR"], ["RUS"]);
    expect(MAP.coastal[NOVGOROD]).toBe(false);
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [NOVGOROD], controller: "UKR" }]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("not adjacent");
    expect(s.controllers[NOVGOROD]).toBe(idx(s, "RUS"));
  });

  test("liberation of one's own province needs no adjacency; partial success records only moved ids", () => {
    const s = makeState();
    war(s, ["UKR"], ["RUS"]);
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [DONETSK, NOVGOROD], controller: "UKR" }]), ctx());
    expect(s.controllers[DONETSK]).toBe(idx(s, "UKR"));
    expect(r.applied).toEqual([{ type: "setController", provinces: [DONETSK], controller: "UKR" }]);
    expect(reasons(r.rejected)).toContain("not adjacent");
  });

  test("naval reach is limited to coasts near ports the coalition holds", () => {
    const s = makeState();
    war(s, ["UKR"], ["RUS"]);
    expect(MAP.coastal[KAMCHATKA]).toBe(true);
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [KAMCHATKA], controller: "UKR" }]), ctx());
    expect(s.controllers[KAMCHATKA]).toBe(idx(s, "RUS"));
    expect(reasons(r.rejected)).toContain("not adjacent");
    // A Black Sea coast within range of Ukrainian ports is reachable by sea.
    const krasnodar = MAP.names.findIndex((n, id) => n === "Krasnodar" && s.owners[id] === idx(s, "RUS"));
    expect(krasnodar).toBeGreaterThan(0);
    applyEvent(s, MAP, ev([{ type: "setController", provinces: [krasnodar], controller: "UKR" }]), ctx());
    expect(s.controllers[krasnodar]).toBe(idx(s, "UKR"));
  });

  test("a player's forces never move without the player's order", () => {
    const s = makeState();
    war(s, ["UKR"], ["RUS"]);
    s.players.push({ id: "p1", name: "P", country: "UKR", isHost: true, connected: true, ready: false });
    const target = frontOrder(s, "RUS", "UKR")[0];
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [target], controller: "UKR" }]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("player-controlled");
  });

  test("capped by the per-turn occupation pace, and the cap carries across events", () => {
    const s = makeState();
    war(s, ["RUS"], ["UKR"]);
    const c = ctx(30); // normal, 30 days → ceil(3 + 2) = 5 per turn
    const targets = frontOrder(s, "UKR", "RUS");
    const before = s.controllers.filter((x) => x === idx(s, "RUS")).length;
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: targets, controller: "RUS" }]), c);
    const after = s.controllers.filter((x) => x === idx(s, "RUS")).length;
    expect(after - before).toBe(5);
    expect(reasons(r.rejected)).toContain("capped at 5");
    expect(c.occupyUsed.get("RUS")).toBe(5);
    const r2 = applyEvent(s, MAP, ev([{ type: "setController", provinces: frontOrder(s, "UKR", "RUS"), controller: "RUS" }]), c);
    expect(r2.applied).toHaveLength(0);
    expect(reasons(r2.rejected)).toContain("capped");
    // Harder difficulty and shorter turns shrink the pace.
    const s2 = makeState();
    s2.settings.difficulty = "realistic";
    war(s2, ["RUS"], ["UKR"]);
    const b2 = s2.controllers.filter((x) => x === idx(s2, "RUS")).length;
    applyEvent(s2, MAP, ev([{ type: "setController", provinces: frontOrder(s2, "UKR", "RUS"), controller: "RUS" }]), ctx(7));
    expect(s2.controllers.filter((x) => x === idx(s2, "RUS")).length - b2).toBe(Math.ceil((3 + 2 * (7 / 30)) * 0.5));
  });

  test("coalition members' territory counts for adjacency", () => {
    const s = makeState();
    war(s, ["RUS", "BLR"], ["UKR"]);
    // Chernihiv borders Belarus's Gomel; Belarus's control makes it adjacent for Russia's coalition.
    const chernihiv = prov("Chernihiv", "UKR");
    const r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [chernihiv], controller: "BLR" }]), ctx());
    expect(r.rejected).toHaveLength(0);
    expect(s.controllers[chernihiv]).toBe(idx(s, "BLR"));
  });

  test("rejects unknown controllers and province ids", () => {
    const s = makeState();
    war(s, ["RUS"], ["UKR"]);
    let r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [KHARKIV], controller: "ZZZ" }]), ctx());
    expect(reasons(r.rejected)).toContain("unknown country");
    r = applyEvent(s, MAP, ev([{ type: "setController", provinces: [0, 999999], controller: "RUS" }]), ctx());
    expect(reasons(r.rejected)).toContain("unknown province");
  });
});

describe("statDelta", () => {
  test("applies percentage changes to gdp and absolute ones to stability", () => {
    const s = makeState();
    const r = applyEvent(s, MAP, ev([
      { type: "statDelta", country: "UKR", stat: "gdp", delta: 2 },
      { type: "statDelta", country: "UKR", stat: "stability", delta: -5 },
    ]), ctx());
    expect(r.rejected).toHaveLength(0);
    expect(country(s, "UKR").gdp).toBe(102);
    expect(country(s, "UKR").stability).toBe(55);
  });

  test("clamped to the per-turn cap; the cap accumulates across events in one TurnContext", () => {
    const s = makeState();
    const c = ctx(30); // stability cap: 6 + 3 = 9
    const e1 = ev([{ type: "statDelta", country: "UKR", stat: "stability", delta: 30 }]);
    const r1 = applyEvent(s, MAP, e1, c);
    expect(country(s, "UKR").stability).toBe(69);
    // Scaled-down effects are applied, so they're reported as clamps, not rejections.
    expect(reasons(r1.clamped)).toContain("clamped from 30 to 9");
    expect(r1.rejected.some((x) => x.reason.includes("clamped"))).toBe(false);
    expect(r1.applied[0]).toMatchObject({ delta: 9 }); // the log shows what was applied
    const r2 = applyEvent(s, MAP, ev([{ type: "statDelta", country: "UKR", stat: "stability", delta: 5 }]), c);
    expect(r2.applied).toHaveLength(0);
    expect(reasons(r2.rejected)).toContain("already at this turn's cap");
    // Going the other way is allowed down to -cap net.
    const r3 = applyEvent(s, MAP, ev([{ type: "statDelta", country: "UKR", stat: "stability", delta: -50 }]), c);
    expect(r3.applied[0]).toMatchObject({ delta: -18 });
    expect(country(s, "UKR").stability).toBe(51);
    // Another country has its own budget; a new context resets it.
    applyEvent(s, MAP, ev([{ type: "statDelta", country: "RUS", stat: "stability", delta: 9 }]), c);
    expect(country(s, "RUS").stability).toBe(69);
    applyEvent(s, MAP, ev([{ type: "statDelta", country: "UKR", stat: "stability", delta: 9 }]), ctx(30));
    expect(country(s, "UKR").stability).toBe(60);
  });

  test("respects absolute ranges", () => {
    const s = makeState();
    country(s, "UKR").stability = 3;
    country(s, "UKR").warExhaustion = 95;
    applyEvent(s, MAP, ev([
      { type: "statDelta", country: "UKR", stat: "stability", delta: -9 },
      { type: "statDelta", country: "UKR", stat: "warExhaustion", delta: 16 },
    ]), ctx());
    expect(country(s, "UKR").stability).toBe(0);
    expect(country(s, "UKR").warExhaustion).toBe(100);
  });

  test("rejects unknown/dead countries and non-finite deltas", () => {
    const s = makeState();
    country(s, "BLR").alive = false;
    const r = applyEvent(s, MAP, ev([
      { type: "statDelta", country: "ZZZ", stat: "gdp", delta: 1 },
      { type: "statDelta", country: "BLR", stat: "gdp", delta: 1 },
      { type: "statDelta", country: "UKR", stat: "gdp", delta: Number.NaN },
      { type: "statDelta", country: "UKR", stat: "gdp", delta: Number.POSITIVE_INFINITY },
    ]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(4);
    expect(country(s, "UKR").gdp).toBe(100);
  });
});

describe("relationDelta", () => {
  test("valid, capped, invalid", () => {
    const s = makeState();
    const c = ctx(30); // cap 31
    let r = applyEvent(s, MAP, ev([{ type: "relationDelta", a: "UKR", b: "POL", delta: 20 }]), c);
    expect(getRelation(s, "POL", "UKR")).toBe(20);
    r = applyEvent(s, MAP, ev([{ type: "relationDelta", a: "POL", b: "UKR", delta: 20 }]), c);
    expect(getRelation(s, "POL", "UKR")).toBe(31);
    expect(r.applied[0]).toMatchObject({ delta: 11 });
    r = applyEvent(s, MAP, ev([{ type: "relationDelta", a: "POL", b: "UKR", delta: 5 }]), c);
    expect(reasons(r.rejected)).toContain("cap");
    r = applyEvent(s, MAP, ev([
      { type: "relationDelta", a: "POL", b: "POL", delta: 5 },
      { type: "relationDelta", a: "POL", b: "ZZZ", delta: 5 },
      { type: "relationDelta", a: "POL", b: "DEU", delta: Number.NaN },
    ]), c);
    expect(r.applied).toHaveLength(0);
    expect(getRelation(s, "POL", "DEU")).toBe(0);
  });
});

describe("treaties", () => {
  test("createTreaty valid, duplicate, too few members, at war", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "createTreaty", treatyType: "alliance", members: ["POL", "UKR", "POL"], name: "Lublin" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.treaties[0]).toMatchObject({ type: "alliance", members: ["POL", "UKR"], name: "Lublin", since: "2026-01-15" });
    r = applyEvent(s, MAP, ev([{ type: "createTreaty", treatyType: "alliance", members: ["UKR", "POL"] }]), ctx());
    expect(reasons(r.rejected)).toContain("already exists");
    r = applyEvent(s, MAP, ev([{ type: "createTreaty", treatyType: "trade", members: ["UKR"] }]), ctx());
    expect(reasons(r.rejected)).toContain("invalid members");
    war(s, ["RUS"], ["UKR"]);
    r = applyEvent(s, MAP, ev([{ type: "createTreaty", treatyType: "trade", members: ["UKR", "RUS"] }]), ctx());
    expect(reasons(r.rejected)).toContain("at war");
  });

  test("endTreaty valid and unknown", () => {
    const s = makeState();
    s.treaties.push({ id: "t1", type: "trade", members: ["POL", "UKR"], since: s.date });
    let r = applyEvent(s, MAP, ev([{ type: "endTreaty", treatyId: "t1" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.treaties).toHaveLength(0);
    r = applyEvent(s, MAP, ev([{ type: "endTreaty", treatyId: "t1" }]), ctx());
    expect(reasons(r.rejected)).toContain("no such treaty");
  });
});

describe("wars", () => {
  test("declareWar valid; sets relations hostile; rejects invalid sides and duplicates", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["RUS"], defenders: ["UKR"], goal: "regime change" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.wars[0]).toMatchObject({ attackers: ["RUS"], defenders: ["UKR"], goal: "regime change" });
    expect(getRelation(s, "RUS", "UKR")).toBe(-40);
    r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["RUS"], defenders: ["UKR"], goal: "" }]), ctx());
    expect(reasons(r.rejected)).toContain("already at war");
    r = applyEvent(s, MAP, ev([
      { type: "declareWar", attackers: ["RUS"], defenders: ["RUS"], goal: "" },
      { type: "declareWar", attackers: ["RUS"], defenders: ["ZZZ"], goal: "" },
    ]), ctx());
    expect(r.rejected.map((x) => x.reason)).toEqual(["invalid sides", "invalid sides"]);
  });

  test("declareWar creates calls to arms for mutual-defence org members and defensive treaties", () => {
    const s = makeState();
    s.treaties.push({ id: "t1", type: "defensive", members: ["EST", "UKR"], name: "Baltic-Black Sea pact", since: s.date });
    applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["RUS"], defenders: ["EST"], goal: "" }], { turn: 3 }), ctx());
    const calls = s.wars[0].calls!;
    const natoCalls = calls.filter((c) => c.via === "NATO").map((c) => c.tag).sort();
    expect(natoCalls).toEqual(NATO32.filter((t) => t !== "EST").sort());
    expect(calls.find((c) => c.tag === "UKR")).toMatchObject({ via: "Baltic-Black Sea pact", since: 3 });
    expect(calls.some((c) => c.tag === "RUS" || c.tag === "EST")).toBe(false);
    // Attacking a non-member triggers no NATO calls.
    expect(callsToArms(s, ["GEO"], ["RUS"], 1)).toEqual([]);
  });

  test("NPC new-war limit per turn; player-ordered wars don't count", () => {
    const s = makeState();
    addHuman(s, "POL");
    const c = ctx(30, [{ id: "o1", country: "POL" }]);
    const limit = 2; // normal
    const pairs = [["RUS", "GEO"], ["ARM", "AZE"], ["IND", "PAK"]];
    const results = pairs.map(([a, d]) => applyEvent(s, MAP, ev([{ type: "declareWar", attackers: [a], defenders: [d], goal: "" }]), c));
    expect(results.filter((r) => r.applied.length).length).toBe(limit);
    expect(reasons(results[2].rejected)).toContain("too many new wars");
    const human = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["POL"], defenders: ["BLR"], goal: "" }], { causes: ["o1"] }), c);
    expect(human.applied).toHaveLength(1);
  });

  test("joinWar valid, already belligerent, unknown war; clears the call to arms", () => {
    const s = makeState();
    applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["RUS"], defenders: ["EST"], goal: "" }]), ctx());
    const w = s.wars[0];
    let r = applyEvent(s, MAP, ev([{ type: "joinWar", warId: w.id, country: "POL", side: "defenders" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(w.defenders).toContain("POL");
    expect(w.calls!.some((c) => c.tag === "POL")).toBe(false);
    r = applyEvent(s, MAP, ev([{ type: "joinWar", warId: w.id, country: "POL", side: "attackers" }]), ctx());
    expect(reasons(r.rejected)).toContain("already a belligerent");
    r = applyEvent(s, MAP, ev([{ type: "joinWar", warId: "nope", country: "DEU", side: "defenders" }]), ctx());
    expect(reasons(r.rejected)).toContain("no such war");
  });

  test("makePeace reverts occupied provinces that were not transferred", () => {
    const s = makeState();
    const w = war(s, ["RUS"], ["UKR"]);
    s.controllers[KHARKIV] = idx(s, "RUS");
    s.controllers[BELGOROD] = idx(s, "UKR");
    // Start-state Luhansk is also Russian-held.
    expect(s.controllers[LUHANSK]).toBe(idx(s, "RUS"));
    const e = ev([
      { type: "makePeace", warId: w, terms: "Donetsk ceded" },
      { type: "transferProvinces", provinces: [DONETSK], from: "UKR", to: "RUS" },
    ]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.rejected).toHaveLength(0);
    expect(s.owners[DONETSK]).toBe(idx(s, "RUS"));
    expect(s.controllers[DONETSK]).toBe(idx(s, "RUS"));
    expect(s.controllers[KHARKIV]).toBe(idx(s, "UKR"));
    expect(s.controllers[LUHANSK]).toBe(idx(s, "UKR"));
    expect(s.controllers[BELGOROD]).toBe(idx(s, "RUS"));
    const changed = new Map(e.mapDiff!.map((d) => [d.province, d]));
    expect([...changed.keys()].sort()).toEqual([BELGOROD, KHARKIV, DONETSK, LUHANSK].sort((a, b) => a - b));
    expect(changed.get(DONETSK)).toEqual({ province: DONETSK, owner: idx(s, "RUS"), controller: idx(s, "RUS") });
    expect(changed.get(KHARKIV)).toEqual({ province: KHARKIV, owner: idx(s, "UKR"), controller: idx(s, "UKR") });
  });

  test("makePeace keeps occupations while the two are still at war in another war", () => {
    const s = makeState();
    const w1 = war(s, ["RUS"], ["UKR"], "w1");
    war(s, ["UKR"], ["RUS"], "w2");
    s.controllers[KHARKIV] = idx(s, "RUS");
    applyEvent(s, MAP, ev([{ type: "makePeace", warId: w1, terms: "" }]), ctx());
    expect(s.controllers[KHARKIV]).toBe(idx(s, "RUS"));
    expect(atWar(s, "RUS", "UKR")).toBe(true);
  });

  test("makePeace rejects unknown war", () => {
    const s = makeState();
    const r = applyEvent(s, MAP, ev([{ type: "makePeace", warId: "nope", terms: "" }]), ctx());
    expect(reasons(r.rejected)).toContain("no such war");
  });
});

describe("player protection", () => {
  const setup = () => {
    const s = makeState();
    addHuman(s, "UKR");
    const c = ctx(30, [{ id: "o-ukr", country: "UKR" }, { id: "o-pol", country: "POL" }]);
    return { s, c };
  };

  test("cannot be made to declare war unless the event is caused by that player's order", () => {
    let { s, c } = setup();
    let r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["UKR"], defenders: ["BLR"], goal: "" }]), c);
    expect(reasons(r.rejected)).toContain("player-controlled");
    // Another player's order does not count.
    r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["UKR"], defenders: ["BLR"], goal: "" }], { causes: ["o-pol"] }), c);
    expect(r.applied).toHaveLength(0);
    r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["UKR"], defenders: ["BLR"], goal: "" }], { causes: ["o-ukr"] }), c);
    expect(r.applied).toHaveLength(1);
    // Being attacked needs no consent.
    ({ s, c } = setup());
    r = applyEvent(s, MAP, ev([{ type: "declareWar", attackers: ["BLR"], defenders: ["UKR"], goal: "" }]), c);
    expect(r.applied).toHaveLength(1);
  });

  test("cannot be made to make peace or cede land", () => {
    const { s, c } = setup();
    const w = war(s, ["RUS"], ["UKR"]);
    const effects = [
      { type: "makePeace" as const, warId: w, terms: "" },
      { type: "transferProvinces" as const, provinces: [DONETSK], from: "UKR", to: "RUS" },
    ];
    let r = applyEvent(s, MAP, ev(structuredClone(effects)), c);
    expect(r.applied).toHaveLength(0);
    expect(s.wars).toHaveLength(1);
    expect(s.owners[DONETSK]).toBe(idx(s, "UKR"));
    r = applyEvent(s, MAP, ev(structuredClone(effects), { causes: ["o-ukr"] }), c);
    expect(r.applied).toHaveLength(2);
    expect(s.owners[DONETSK]).toBe(idx(s, "RUS"));
  });

  test("a player may cede voluntarily by order, without a peace or treaty", () => {
    const { s, c } = setup();
    const r = applyEvent(s, MAP, ev([{ type: "transferProvinces", provinces: [SUMY], from: "UKR", to: "POL" }], { causes: ["o-ukr"] }), c);
    expect(r.applied).toHaveLength(1);
    expect(s.owners[SUMY]).toBe(idx(s, "POL"));
  });

  test("cannot be made to join a treaty, war, organisation or sanctions regime", () => {
    const { s, c } = setup();
    const w = war(s, ["RUS"], ["GEO"]);
    const r = applyEvent(s, MAP, ev([
      { type: "createTreaty", treatyType: "alliance", members: ["UKR", "POL"] },
      { type: "joinWar", warId: w, country: "UKR", side: "defenders" },
      { type: "applyToOrg", orgId: "eu", country: "UKR" },
      { type: "imposeSanctions", target: "RUS", by: ["UKR", "POL"] },
      { type: "createOrg", abbrev: "LT", name: "Lublin Triangle", kind: "forum", members: ["UKR", "POL", "LTU"], rule: "consensus" },
      { type: "updateAgenda", country: "UKR", goals: ["x"] },
    ]), c);
    expect(r.applied).toHaveLength(0);
    expect(r.rejected).toHaveLength(6);
    const ok = applyEvent(s, MAP, ev([{ type: "createTreaty", treatyType: "alliance", members: ["UKR", "POL"] }], { causes: ["o-ukr"] }), c);
    expect(ok.applied).toHaveLength(1);
  });

  test("stable player countries resist secession and leader changes", () => {
    const { s, c } = setup();
    let r = applyEvent(s, MAP, ev([
      { type: "spawnCountry", name: "Donetsk Republic", government: "Junta", leader: "X", provinces: [DONETSK] },
      { type: "changeLeader", country: "UKR", leader: "Puppet" },
    ]), c);
    expect(r.applied).toHaveLength(0);
    country(s, "UKR").stability = 10;
    r = applyEvent(s, MAP, ev([
      { type: "spawnCountry", name: "Donetsk Republic", government: "Junta", leader: "X", provinces: [DONETSK] },
      { type: "changeLeader", country: "UKR", leader: "Puppet" },
    ]), c);
    expect(r.applied).toHaveLength(2);
  });
});

describe("spawnCountry", () => {
  test("splits GDP and population by area and assigns a distinct colour and unique tag", () => {
    const s = makeState();
    const ukr = country(s, "UKR");
    const ukrProvs = startProvinces("UKR");
    const total = ukrProvs.reduce((a, id) => a + MAP.area[id], 0);
    const share = (MAP.area[DONETSK] + MAP.area[LUHANSK]) / total;
    const e = ev([{ type: "spawnCountry", tag: "DON", name: "Donbas Republic", government: "Junta", leader: "X", provinces: [DONETSK, LUHANSK, LUHANSK] }]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.rejected).toHaveLength(0);
    const k = s.countries[s.countries.length - 1];
    expect(k.tag).toBe("DON");
    expect(k.alive).toBe(true);
    expect(k.population).toBeCloseTo(10 * share, 1);
    expect(k.gdp).toBeCloseTo(100 * share * 0.8, 1);
    expect(ukr.population).toBeCloseTo(10 * (1 - share), 1);
    expect(ukr.gdp).toBeCloseTo(100 * (1 - share), 1);
    expect(k.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(k.color).not.toBe(ukr.color);
    expect(k.color).not.toBe(country(s, "RUS").color);
    const kIdx = s.countries.length - 1;
    expect(s.owners[DONETSK]).toBe(kIdx);
    expect(s.controllers[DONETSK]).toBe(kIdx);
    expect(r.applied[0]).toMatchObject({ tag: "DON", provinces: [DONETSK, LUHANSK] });
    expect(e.mapDiff!.map((d) => d.province).sort()).toEqual([DONETSK, LUHANSK]);
    // Same seed again yields a different tag.
    applyEvent(s, MAP, ev([{ type: "spawnCountry", tag: "DON", name: "Kharkiv Republic", government: "", leader: "", provinces: [KHARKIV] }]), ctx());
    expect(s.countries[s.countries.length - 1].tag).not.toBe("DON");
  });

  test("a spawned country can receive land in the same event; max two per turn; no valid provinces", () => {
    const s = makeState();
    const c = ctx();
    const r = applyEvent(s, MAP, ev([
      { type: "spawnCountry", tag: "NRS", name: "Novorossiya", government: "", leader: "", provinces: [DONETSK] },
      { type: "transferProvinces", provinces: [LUHANSK], from: "UKR", to: "NRS" },
    ]), c);
    expect(r.rejected).toHaveLength(0);
    expect(s.owners[LUHANSK]).toBe(idx(s, "NRS"));
    applyEvent(s, MAP, ev([{ type: "spawnCountry", name: "Two", government: "", leader: "", provinces: [KHARKIV] }]), c);
    const r3 = applyEvent(s, MAP, ev([{ type: "spawnCountry", name: "Three", government: "", leader: "", provinces: [SUMY] }]), c);
    expect(reasons(r3.rejected)).toContain("too many new countries");
    const r4 = applyEvent(s, MAP, ev([{ type: "spawnCountry", name: "None", government: "", leader: "", provinces: [0, 999999] }]), ctx());
    expect(reasons(r4.rejected)).toContain("no valid provinces");
  });

  test("uniqueTag pads short seeds and avoids collisions", () => {
    const s = makeState();
    expect(uniqueTag(s, "Q")).toBe("QXX");
    expect(uniqueTag(s, "Ukraine")).not.toBe("UKR");
    expect(uniqueTag(s, "Ukraine")).toMatch(/^[A-Z]{3}/);
  });
});

describe("annexCountry", () => {
  const MDA = () => startProvinces("MDA"); // 3 provinces

  test("rejected without vassalage, voluntary union or 60% occupation", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "MDA", by: "ROU" }]), ctx());
    expect(reasons(r.rejected)).toContain("annexation needs");
    war(s, ["ROU"], ["MDA"]);
    s.controllers[MDA()[0]] = idx(s, "ROU"); // 1/3 < 60%
    r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "MDA", by: "ROU" }]), ctx());
    expect(r.applied).toHaveLength(0);
    r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "MDA", by: "MDA" }]), ctx());
    expect(reasons(r.rejected)).toContain("invalid countries");
  });

  test("allowed with 60% occupation during a war", () => {
    const s = makeState();
    war(s, ["ROU"], ["MDA"]);
    for (const id of MDA().slice(0, 2)) s.controllers[id] = idx(s, "ROU");
    country(s, "MDA").gdp = 20;
    const e = ev([{ type: "annexCountry", target: "MDA", by: "ROU" }]);
    const r = applyEvent(s, MAP, e, ctx());
    expect(r.rejected).toHaveLength(0);
    expect(country(s, "MDA").alive).toBe(false);
    for (const id of MDA()) {
      expect(s.owners[id]).toBe(idx(s, "ROU"));
      expect(s.controllers[id]).toBe(idx(s, "ROU"));
    }
    expect(country(s, "ROU").gdp).toBe(117);
    expect(country(s, "ROU").population).toBe(20);
    expect(s.wars).toHaveLength(0);
    expect(s.organizations.find((o) => o.id === "un")!.members).not.toContain("MDA");
    expect(e.mapDiff).toHaveLength(3);
  });

  test("allowed with a vassal treaty (overlord first) or a voluntary union", () => {
    const s = makeState();
    s.treaties.push({ id: "t1", type: "vassal", members: ["RUS", "BLR"], since: s.date });
    let r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "BLR", by: "RUS" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.treaties).toHaveLength(0); // the vassal treaty died with the vassal
    // Vassal treaty in the wrong direction does not count.
    s.treaties.push({ id: "t2", type: "vassal", members: ["ARM", "RUS"], since: s.date });
    r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "ARM", by: "RUS" }]), ctx());
    expect(r.applied).toHaveLength(0);
    // A human target that orders the union.
    addHuman(s, "MDA");
    const c = ctx(30, [{ id: "o1", country: "MDA" }]);
    r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "MDA", by: "ROU" }]), c);
    expect(reasons(r.rejected)).toContain("player-controlled");
    r = applyEvent(s, MAP, ev([{ type: "annexCountry", target: "MDA", by: "ROU" }], { causes: ["o1"] }), c);
    expect(r.applied).toHaveLength(1);
  });

  test("provinces the annexed country occupied abroad return to their owners", () => {
    const s = makeState();
    war(s, ["UKR"], ["MDA"]);
    war(s, ["MDA"], ["ROU"], "w2");
    const braila = prov("Braila", "ROU");
    s.controllers[braila] = idx(s, "MDA");
    for (const id of MDA().slice(0, 2)) s.controllers[id] = idx(s, "UKR");
    const e = ev([{ type: "annexCountry", target: "MDA", by: "UKR" }]);
    applyEvent(s, MAP, e, ctx());
    expect(s.controllers[braila]).toBe(idx(s, "ROU"));
    expect(e.mapDiff!.some((d) => d.province === braila && d.controller === idx(s, "ROU"))).toBe(true);
  });
});

describe("organisations", () => {
  test("joinOrg for an org with admitMember power becomes a candidacy", () => {
    const s = makeState();
    const eu = s.organizations.find((o) => o.id === "eu")!;
    const r = applyEvent(s, MAP, ev([{ type: "joinOrg", orgId: "eu", country: "UKR" }]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("requires a vote");
    expect(eu.members).not.toContain("UKR");
    expect(eu.candidates).toEqual([{ tag: "UKR", since: "2026-01-15" }]);
    applyEvent(s, MAP, ev([{ type: "joinOrg", orgId: "eu", country: "UKR" }]), ctx());
    expect(eu.candidates).toHaveLength(1);
  });

  test("joinOrg for an open org adds the member; invalid cases", () => {
    const s = makeState();
    s.organizations.push({
      id: "g20", abbrev: "G20", name: "Group of Twenty", kind: "forum", members: ["USA", "CHN"], observers: [], candidates: [],
      suspended: [], bodies: [{ id: "summit", name: "Summit", seats: [], rule: "consensus" }], powers: ["custom"], effects: { forum: true }, cohesion: 60,
    });
    let r = applyEvent(s, MAP, ev([{ type: "joinOrg", orgId: "g20", country: "IND" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.organizations.find((o) => o.id === "g20")!.members).toContain("IND");
    r = applyEvent(s, MAP, ev([
      { type: "joinOrg", orgId: "g20", country: "IND" },
      { type: "joinOrg", orgId: "nope", country: "IND" },
    ]), ctx());
    expect(r.rejected.map((x) => x.reason)).toEqual(["already a member", "unknown organisation or country"]);
  });

  test("leaveOrg drops relations, cohesion and (for trade blocs) GDP", () => {
    const s = makeState();
    const eu = s.organizations.find((o) => o.id === "eu")!;
    const r = applyEvent(s, MAP, ev([{ type: "leaveOrg", orgId: "eu", country: "HUN" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(eu.members).not.toContain("HUN");
    expect(country(s, "HUN").gdp).toBe(98);
    expect(eu.cohesion).toBe(62);
    expect(getRelation(s, "HUN", "AUT")).toBe(-12);
    const r2 = applyEvent(s, MAP, ev([{ type: "leaveOrg", orgId: "eu", country: "HUN" }]), ctx());
    expect(reasons(r2.rejected)).toContain("not a member");
  });

  test("createOrg valid and invalid", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "createOrg", abbrev: "BSU", name: "Black Sea Union", kind: "regional", members: ["UKR", "GEO", "ZZZ"], rule: "twoThirds", tradeBloc: true }]), ctx());
    expect(r.applied).toHaveLength(1);
    const o = s.organizations.at(-1)!;
    expect(o).toMatchObject({ abbrev: "BSU", members: ["UKR", "GEO"], effects: { tradeBloc: true } });
    expect(o.bodies[0].rule).toBe("twoThirds");
    r = applyEvent(s, MAP, ev([{ type: "createOrg", abbrev: "X", name: "X", kind: "forum", members: ["UKR", "ZZZ"], rule: "consensus" }]), ctx());
    expect(reasons(r.rejected)).toContain("two founding members");
  });

  test("proposeResolution valid and invalid", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "proposeResolution", orgId: "un", resolutionType: "sanction", proposer: "USA", target: "PRK", text: "Sanction" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.resolutions[0]).toMatchObject({ orgId: "un", bodyId: "sc", status: "pending", turn: 2, target: "PRK" });
    r = applyEvent(s, MAP, ev([{ type: "proposeResolution", orgId: "un", resolutionType: "condemn", proposer: "USA", target: "PRK", text: "" }]), ctx());
    expect(s.resolutions[1].bodyId).toBe("ga"); // unlisted types go to the first body
    r = applyEvent(s, MAP, ev([
      { type: "proposeResolution", orgId: "nato", resolutionType: "condemn", proposer: "RUS", target: "USA", text: "" },
      { type: "proposeResolution", orgId: "nato", resolutionType: "sanction", proposer: "USA", target: "RUS", text: "" },
      { type: "proposeResolution", orgId: "un", resolutionType: "sanction", proposer: "USA", text: "" },
      { type: "proposeResolution", orgId: "un", resolutionType: "sanction", proposer: "USA", target: "ZZZ", text: "" },
    ]), ctx());
    expect(r.rejected.map((x) => x.reason)).toEqual([
      "proposer is not a member", "NATO cannot pass sanction resolutions", "sanction needs a target", "unknown target",
    ]);
  });

  test("applyToOrg valid and invalid", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "applyToOrg", orgId: "nato", country: "UKR" }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.organizations.find((o) => o.id === "nato")!.candidates[0].tag).toBe("UKR");
    r = applyEvent(s, MAP, ev([{ type: "applyToOrg", orgId: "nato", country: "USA" }]), ctx());
    expect(reasons(r.rejected)).toContain("cannot apply");
  });
});

describe("sanctions, leaders, agendas, formations", () => {
  test("imposeSanctions valid, invalid and not stacked", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([{ type: "imposeSanctions", target: "RUS", by: ["USA", "GBR", "RUS", "ZZZ"] }], { headline: "Sanctions!" }), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.sanctions[0]).toMatchObject({ target: "RUS", by: ["USA", "GBR"], source: "Sanctions!" });
    expect(getRelation(s, "USA", "RUS")).toBe(-10);
    r = applyEvent(s, MAP, ev([{ type: "imposeSanctions", target: "RUS", by: ["USA"] }]), ctx());
    expect(reasons(r.rejected)).toContain("already sanctioning");
    expect(s.sanctions).toHaveLength(1);
    r = applyEvent(s, MAP, ev([{ type: "imposeSanctions", target: "RUS", by: ["USA", "FRA"] }]), ctx());
    expect(s.sanctions[1].by).toEqual(["FRA"]);
    r = applyEvent(s, MAP, ev([{ type: "imposeSanctions", target: "ZZZ", by: ["USA"] }]), ctx());
    expect(reasons(r.rejected)).toContain("invalid sanction");
  });

  test("liftSanctions valid and nothing to lift", () => {
    const s = makeState();
    s.sanctions.push({ id: "s1", target: "IRN", by: ["USA", "GBR"], source: "", since: s.date });
    let r = applyEvent(s, MAP, ev([{ type: "liftSanctions", target: "IRN", by: ["USA"] }]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.sanctions[0].by).toEqual(["GBR"]);
    r = applyEvent(s, MAP, ev([{ type: "liftSanctions", target: "IRN", by: ["GBR"] }]), ctx());
    expect(s.sanctions).toHaveLength(0);
    r = applyEvent(s, MAP, ev([{ type: "liftSanctions", target: "IRN", by: ["GBR"] }]), ctx());
    expect(r.applied).toHaveLength(0);
    expect(reasons(r.rejected)).toContain("nothing to lift");
  });

  test("a player's sanctions cannot be lifted without its order", () => {
    const s = makeState();
    addHuman(s, "USA");
    s.sanctions.push({ id: "s1", target: "IRN", by: ["USA", "GBR"], source: "", since: s.date });
    const r = applyEvent(s, MAP, ev([{ type: "liftSanctions", target: "IRN", by: ["USA", "GBR"] }]), ctx());
    expect(s.sanctions[0].by).toEqual(["USA"]);
    expect(r.applied).toHaveLength(1);
    expect(reasons(r.rejected)).toContain("USA");
  });

  test("changeLeader, updateAgenda, updateFormation", () => {
    const s = makeState();
    let r = applyEvent(s, MAP, ev([
      { type: "changeLeader", country: "FRA", leader: "New PM", government: "Fifth Republic" },
      { type: "changeLeader", country: "ZZZ", leader: "x" },
      { type: "updateAgenda", country: "FRA", goals: ["a", "b", "c", "d", "e"] },
    ]), ctx());
    expect(r.applied).toHaveLength(2);
    expect(country(s, "FRA")).toMatchObject({ leader: "New PM", government: "Fifth Republic" });
    expect(country(s, "FRA").agenda.goals).toEqual(["a", "b", "c", "d"]);
    s.formations.push({
      id: "f1", founder: "POL", name: "Commonwealth", concept: "", color: "#aa0000", government: "", countries: ["LTU"], provinces: [],
      verdict: "notYet", requirements: [{ text: "Treaty", met: false, why: "" }], consent: [], suggestedPath: "", lastChecked: 1, status: "active",
    });
    r = applyEvent(s, MAP, ev([
      { type: "updateFormation", country: "POL", index: 0, met: true, text: "Treaty signed" },
      { type: "updateFormation", country: "POL", index: 3, met: true },
    ]), ctx());
    expect(r.applied).toHaveLength(1);
    expect(s.formations[0].requirements[0]).toMatchObject({ met: true, text: "Treaty signed" });
    expect(reasons(r.rejected)).toContain("no such formation requirement");
  });
});

describe("removeCountry", () => {
  test("cleans every reference", () => {
    const s: GameState = makeState();
    s.sanctions.push({ id: "s1", target: "IRN", by: ["BLR"], source: "", since: s.date });
    s.sanctions.push({ id: "s2", target: "BLR", by: ["USA"], source: "", since: s.date });
    s.treaties.push({ id: "t1", type: "alliance", members: ["RUS", "BLR"], since: s.date });
    s.organizations[0].candidates.push({ tag: "BLR", since: s.date });
    removeCountry(s, "BLR");
    expect(country(s, "BLR").alive).toBe(false);
    expect(s.sanctions).toHaveLength(0);
    expect(s.treaties).toHaveLength(0);
    expect(s.organizations[0].members).not.toContain("BLR");
    expect(s.organizations[0].candidates).toHaveLength(0);
    expect(relKey("A", "B")).toBe("A|B");
  });
});
