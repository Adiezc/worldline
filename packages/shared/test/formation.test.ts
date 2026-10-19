import { describe, expect, test } from "bun:test";
import { checkFormation, formNation } from "../src/game/formation.ts";
import type { FormationGoal, GameState } from "../src/game/state.ts";
import { addHuman, country, idx, MAP, makeState, prov, startProvinces } from "./fixtures.ts";

// Poland and Lithuania re-form the Commonwealth.
function goal(over: Partial<FormationGoal> = {}): FormationGoal {
  return {
    id: "f1", founder: "POL", name: "Polish-Lithuanian Commonwealth", concept: "", color: "#c02040", government: "Elective monarchy",
    countries: ["LTU"], provinces: [...startProvinces("POL"), ...startProvinces("LTU")],
    verdict: "achievable",
    requirements: [{ text: "Union treaty ratified", met: true, why: "" }],
    consent: [{ country: "LTU", needed: true, willing: true, human: false }],
    suggestedPath: "", lastChecked: 1, status: "active",
    plan: { name: "Commonwealth of Two Nations", orgHandling: "", reactions: [{ a: "POL", b: "RUS", delta: -20 }] },
    ...over,
  };
}
const snapshot = (s: GameState) => JSON.stringify(s);

describe("checkFormation", () => {
  test("ok when everything is in place", () => {
    const s = makeState();
    expect(checkFormation(s, goal())).toEqual({ ok: true, problems: [] });
  });

  test("reports missing consent", () => {
    const s = makeState();
    const c = checkFormation(s, goal({ consent: [{ country: "LTU", needed: true, willing: false, human: false }] }));
    expect(c.ok).toBe(false);
    expect(c.problems).toContain("LTU has not agreed");
  });

  test("reports an unconsenting human (AI willingness is not enough)", () => {
    const s = makeState();
    addHuman(s, "LTU");
    const c = checkFormation(s, goal());
    expect(c.problems).toContain("LTU has not agreed");
    expect(c.problems).toContain("LTU is player-controlled and has not accepted");
    const accepted = checkFormation(s, goal({ consent: [{ country: "LTU", needed: true, willing: true, human: true, accepted: true }] }));
    expect(accepted.ok).toBe(true);
  });

  test("reports non-participant provinces, unmet requirements, verdict and dead founder", () => {
    const s = makeState();
    const grodno = prov("Grodno", "BLR");
    const c = checkFormation(s, goal({
      provinces: [...startProvinces("LTU"), grodno],
      verdict: "notYet",
      requirements: [{ text: "Union treaty ratified", met: false, why: "" }, { text: "Referendum", met: true, why: "" }],
    }));
    expect(c.problems).toContain(`region ${grodno} belongs to BLR, who is not part of the union`);
    expect(c.problems).toContain("unmet requirements: Union treaty ratified");
    expect(c.problems).toContain("the assessment does not consider this achievable yet");
    country(s, "POL").alive = false;
    expect(checkFormation(s, goal()).problems).toContain("the founding country no longer exists");
  });
});

describe("formNation", () => {
  test("changes nothing on failure", () => {
    const s = makeState();
    const before = snapshot(s);
    const r = formNation(s, MAP, goal({ provinces: [...startProvinces("LTU"), prov("Grodno", "BLR")] }));
    expect(r.ok).toBe(false);
    expect(r.mapDiff).toEqual([]);
    expect(snapshot(s)).toBe(before);
  });

  test("merges provinces, absorbs fully merged countries, renames and recolours the founder", () => {
    const s = makeState();
    s.treaties.push({ id: "t1", type: "trade", members: ["LTU", "LVA"], since: s.date });
    s.treaties.push({ id: "t2", type: "alliance", members: ["LTU", "LVA", "EST"], since: s.date });
    country(s, "LTU").population = 3;
    country(s, "LTU").stability = 40;
    country(s, "POL").population = 37;
    const g = goal();
    const r = formNation(s, MAP, g);
    expect(r.ok).toBe(true);
    const pol = country(s, "POL"), ltu = country(s, "LTU");
    for (const id of startProvinces("LTU")) {
      expect(s.owners[id]).toBe(idx(s, "POL"));
      expect(s.controllers[id]).toBe(idx(s, "POL"));
    }
    expect(r.mapDiff.length).toBe(g.provinces.length);
    expect(ltu.alive).toBe(false);
    for (const o of s.organizations) expect(o.members).not.toContain("LTU");
    expect(s.treaties.map((t) => [t.id, t.members])).toEqual([["t2", ["LVA", "EST"]]]);
    expect(pol).toMatchObject({ name: "Commonwealth of Two Nations", color: "#c02040", government: "Elective monarchy", gdp: 200, population: 40 });
    expect(pol.stability).toBe(Math.round((60 * 37 + 40 * 3) / 40 - 10));
    expect(s.relations["POL|RUS"]).toBe(-20);
    expect(g.status).toBe("proclaimed");
  });

  test("stability of a small union is a true weighted mean", () => {
    const s = makeState();
    country(s, "POL").population = 0.3;
    country(s, "LTU").population = 0.2;
    country(s, "LTU").stability = 60;
    formNation(s, MAP, goal());
    expect(country(s, "POL").stability).toBe(50);
  });

  test("partial union keeps the rest of the donor alive; enemy-held provinces stay occupied", () => {
    const s = makeState();
    const klaipeda = prov("Klaipedos", "LTU");
    const vilnius = prov("Vilniaus", "LTU");
    s.controllers[vilnius] = idx(s, "BLR");
    const r = formNation(s, MAP, goal({ provinces: [klaipeda, vilnius] }));
    expect(r.ok).toBe(true);
    expect(country(s, "LTU").alive).toBe(true);
    expect(s.owners[klaipeda]).toBe(idx(s, "POL"));
    expect(s.owners[vilnius]).toBe(idx(s, "POL"));
    expect(s.controllers[vilnius]).toBe(idx(s, "BLR"));
    expect(s.organizations.find((o) => o.id === "eu")!.members).toContain("LTU");
  });

  test("an absorbed country's foreign occupations return to their owners", () => {
    const s = makeState();
    const grodno = prov("Grodno", "BLR");
    s.controllers[grodno] = idx(s, "LTU");
    const r = formNation(s, MAP, goal());
    expect(r.ok).toBe(true);
    expect(s.controllers[grodno]).toBe(idx(s, "BLR"));
    expect(r.mapDiff).toContainEqual({ province: grodno, owner: idx(s, "BLR"), controller: idx(s, "BLR") });
  });
});
