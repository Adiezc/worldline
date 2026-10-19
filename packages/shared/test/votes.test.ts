import { describe, expect, test } from "bun:test";
import { bodyOf, enactResolution, heuristicVote, keyVoters, tally, voteScore, votersOf, type Vote } from "../src/game/votes.ts";
import { getRelation, type GameState, type Resolution } from "../src/game/state.ts";
import { country, EU27, makeState, NATO32, P5, SC_ELECTED } from "./fixtures.ts";

const org = (s: GameState, id: string) => s.organizations.find((o) => o.id === id)!;
const res = (over: Partial<Resolution> = {}): Resolution => ({
  id: "r1", orgId: "un", bodyId: "sc", type: "sanction", proposer: "USA", target: "PRK", text: "", turn: 1, status: "pending", ...over,
});
const all = (tags: string[], v: Vote) => Object.fromEntries(tags.map((t) => [t, v])) as Record<string, Vote>;

describe("UN Security Council (vetoMajority)", () => {
  const SC = [...P5, ...SC_ELECTED];

  test("one P5 no vetoes a resolution even with 14 yes", () => {
    const s = makeState();
    const un = org(s, "un"), sc = bodyOf(un, "sc");
    expect(votersOf(un, sc)).toHaveLength(15);
    const t = tally(s, un, sc, { ...all(SC, "yes"), RUS: "no" });
    expect(t).toMatchObject({ status: "vetoed", yes: 14, no: 1 });
    expect(t.summary).toContain("RUS");
  });

  test("9 yes with no veto passes (P5 abstentions are not vetoes); 8 fails", () => {
    const s = makeState();
    const un = org(s, "un"), sc = bodyOf(un, "sc");
    const nine = { ...all(SC_ELECTED.slice(0, 9), "yes" as Vote), RUS: "abstain" as Vote, CHN: "abstain" as Vote };
    expect(tally(s, un, sc, nine).status).toBe("passed");
    const nineWithElectedNo = { ...all(SC_ELECTED.slice(0, 9), "yes" as Vote), [SC_ELECTED[9]]: "no" as Vote };
    expect(tally(s, un, sc, nineWithElectedNo).status).toBe("passed");
    expect(tally(s, un, sc, all(SC_ELECTED.slice(0, 8), "yes")).status).toBe("failed");
    // A P5 "no" on a resolution that fails anyway is a plain failure, not a veto.
    expect(tally(s, un, sc, { ...all(SC_ELECTED.slice(0, 8), "yes" as Vote), USA: "no" as Vote }).status).toBe("failed");
  });

  test("a suspended veto holder cannot veto", () => {
    const s = makeState();
    const un = org(s, "un"), sc = bodyOf(un, "sc");
    un.suspended.push("RUS");
    expect(tally(s, un, sc, { ...all(SC, "yes"), RUS: "no" }).status).toBe("passed");
  });

  test("General Assembly is a simple majority of all members", () => {
    const s = makeState();
    const un = org(s, "un"), ga = bodyOf(un, "ga");
    expect(votersOf(un, ga).length).toBe(s.countries.length);
    expect(tally(s, un, ga, { USA: "yes", RUS: "no", CHN: "no" }).status).toBe("failed");
    expect(tally(s, un, ga, { USA: "yes", GBR: "yes", RUS: "no" }).status).toBe("passed");
    expect(tally(s, un, ga, {}).status).toBe("failed");
  });
});

describe("EU qualified majority", () => {
  // 15 "yes" states vs 12 others: 55% of 27 = 14.85 → 15 states needed.
  const YES = EU27.slice(0, 15), NO = EU27.slice(15);
  const setPops = (s: GameState, yesPop: number[], noPop: number[]) => {
    YES.forEach((t, i) => (country(s, t).population = yesPop[i]));
    NO.forEach((t, i) => (country(s, t).population = noPop[i]));
  };
  // Total 100: yes = 14×2 + 37 = 65, others = 11×3 + 2 = 35.
  const yesPop = [...Array(14).fill(2), 37], noPop = [...Array(11).fill(3), 2];

  test("exactly 55% of states and exactly 65% of population passes", () => {
    const s = makeState();
    setPops(s, yesPop, noPop);
    const eu = org(s, "eu");
    const t = tally(s, eu, eu.bodies[0], { ...all(YES, "yes"), ...all(NO, "no") });
    expect(t.status).toBe("passed");
    expect(t.summary).toContain("56% of states, 65% of population");
  });

  test("65% of population fails with only 14 states", () => {
    const s = makeState();
    setPops(s, yesPop, noPop);
    const eu = org(s, "eu");
    const votes = { ...all(YES, "yes"), ...all(NO, "no"), [YES[0]]: "abstain" as Vote };
    country(s, YES[14]).population = 60; // 86 of 123 = 70% of population, but only 14 states
    expect(tally(s, eu, eu.bodies[0], votes).status).toBe("failed");
  });

  test("15 states but just under 65% of population fails", () => {
    const s = makeState();
    setPops(s, [...Array(14).fill(2), 36.9], [...Array(11).fill(3), 2.1]); // 64.9 of 100
    const eu = org(s, "eu");
    expect(tally(s, eu, eu.bodies[0], { ...all(YES, "yes"), ...all(NO, "no") }).status).toBe("failed");
  });

  test("tolerates floating point at the 65% threshold", () => {
    const s = makeState();
    // 6.5 + 0.1×... built from decimals that do not sum exactly in binary.
    const yp = [...Array(14).fill(0.1), 6.5 - 1.4], np = [...Array(12).fill(3.5 / 12)];
    setPops(s, yp, np);
    const eu = org(s, "eu");
    expect(tally(s, eu, eu.bodies[0], { ...all(YES, "yes"), ...all(NO, "no") }).status).toBe("passed");
  });

  test("abstentions count against (they are not yes votes)", () => {
    const s = makeState();
    setPops(s, yesPop, noPop);
    const eu = org(s, "eu");
    expect(tally(s, eu, eu.bodies[0], all(YES, "yes")).status).toBe("passed");
    expect(tally(s, eu, eu.bodies[0], all(YES.slice(1), "yes")).status).toBe("failed");
  });
});

describe("NATO consensus", () => {
  test("fails on a single no; passes with abstentions; fails with nobody in favour", () => {
    const s = makeState();
    const nato = org(s, "nato"), nac = nato.bodies[0];
    const t = tally(s, nato, nac, { ...all(NATO32, "yes"), TUR: "no" });
    expect(t.status).toBe("failed");
    expect(t.summary).toContain("blocked by TUR");
    expect(tally(s, nato, nac, { ...all(NATO32, "yes"), HUN: "abstain", TUR: "abstain" }).status).toBe("passed");
    expect(tally(s, nato, nac, { USA: "yes" }).status).toBe("passed"); // missing = abstain
    expect(tally(s, nato, nac, {}).status).toBe("failed");
  });

  test("twoThirds counts yes against yes+no", () => {
    const s = makeState();
    const nato = org(s, "nato");
    const body = { ...nato.bodies[0], rule: "twoThirds" as const };
    expect(tally(s, nato, body, { USA: "yes", GBR: "yes", FRA: "no" }).status).toBe("passed");
    expect(tally(s, nato, body, { USA: "yes", GBR: "no", FRA: "no" }).status).toBe("failed");
  });
});

describe("keyVoters", () => {
  test("includes every veto holder (minus humans), plus swing voters, up to max", () => {
    const s = makeState();
    const un = org(s, "un"), sc = bodyOf(un, "sc");
    const humans = new Set(["GBR"]);
    const kv = keyVoters(s, un, sc, res(), humans);
    for (const t of P5.filter((x) => x !== "GBR")) expect(kv).toContain(t);
    expect(kv).not.toContain("GBR");
    expect(kv.every((t) => [...P5, ...SC_ELECTED].includes(t))).toBe(true);
    expect(keyVoters(s, un, bodyOf(un, "ga"), res({ bodyId: "ga" }), new Set(), 5).length).toBeLessThanOrEqual(5);
  });

  test("includes all consensus members (every one of them can block)", () => {
    const s = makeState();
    const nato = org(s, "nato");
    const kv = keyVoters(s, nato, nato.bodies[0], res({ orgId: "nato", bodyId: "nac", type: "admitMember", target: "UKR" }), new Set(["USA"]));
    expect(kv.sort()).toEqual(NATO32.filter((t) => t !== "USA").sort());
  });
});

describe("enactResolution", () => {
  test("sanction creates a Sanction from all members but the target, without stacking", () => {
    const s = makeState();
    const eu = org(s, "eu");
    enactResolution(s, eu, res({ orgId: "eu", bodyId: "council", target: "HUN" }), {}, "2026-02-01");
    expect(s.sanctions).toHaveLength(1);
    expect(s.sanctions[0]).toMatchObject({ target: "HUN", source: "EU resolution", since: "2026-02-01" });
    expect(s.sanctions[0].by.sort()).toEqual(EU27.filter((t) => t !== "HUN").sort());
    enactResolution(s, eu, res({ orgId: "eu", bodyId: "council", target: "HUN" }), {}, "2026-03-01");
    expect(s.sanctions).toHaveLength(1);
  });

  test("admitMember adds the member and clears the candidacy", () => {
    const s = makeState();
    const nato = org(s, "nato");
    nato.candidates.push({ tag: "UKR", since: s.date });
    enactResolution(s, nato, res({ orgId: "nato", type: "admitMember", target: "UKR" }), {}, s.date);
    expect(nato.members).toContain("UKR");
    expect(nato.candidates).toHaveLength(0);
    expect(getRelation(s, "UKR", "POL")).toBe(6);
  });

  test("condemn, suspend, expel and narrative-only types", () => {
    const s = makeState();
    const un = org(s, "un");
    enactResolution(s, un, res({ type: "condemn", target: "RUS" }), { USA: "yes", FRA: "yes", CHN: "no" }, s.date);
    expect(getRelation(s, "USA", "RUS")).toBe(-8);
    expect(getRelation(s, "CHN", "RUS")).toBe(0);
    enactResolution(s, un, res({ type: "suspendMember", target: "RUS" }), {}, s.date);
    expect(un.suspended).toEqual(["RUS"]);
    enactResolution(s, un, res({ type: "expelMember", target: "RUS" }), {}, s.date);
    expect(un.members).not.toContain("RUS");
    const before = JSON.stringify(s);
    enactResolution(s, un, res({ type: "peacekeeping", target: "SDN" }), {}, s.date);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("heuristicVote", () => {
  test("proposer yes, target no, ally of the target no", () => {
    const s = makeState();
    s.treaties.push({ id: "t1", type: "alliance", members: ["RUS", "BLR"], since: s.date });
    const r = res({ type: "sanction", proposer: "USA", target: "RUS" });
    expect(heuristicVote(s, "USA", r)).toBe("yes");
    expect(heuristicVote(s, "RUS", r)).toBe("no");
    expect(heuristicVote(s, "BLR", r)).toBe("no");
    // A neutral stranger abstains; a close friend of the proposer votes yes.
    expect(heuristicVote(s, "BRA", r)).toBe("abstain");
    s.relations["GBR|USA"] = 80;
    expect(heuristicVote(s, "GBR", r)).toBe("yes");
  });

  test("enlargement is welcomed by friends of the candidate", () => {
    const s = makeState();
    s.relations["POL|UKR"] = 40;
    const r = res({ orgId: "nato", type: "admitMember", proposer: "LTU", target: "UKR" });
    expect(voteScore(s, "POL", r)).toBeGreaterThan(10);
    expect(heuristicVote(s, "POL", r)).toBe("yes");
  });
});
