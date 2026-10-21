import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { powerRanking, rankChange, recordRanking, tierFor, RANK_HISTORY, type NationRank } from "../src/game/ranking.ts";
import type { GameState } from "../src/game/state.ts";
import type { ScenarioSeed } from "../src/game/scenario.ts";
import { country, makeState } from "./fixtures.ts";

const seed = (id: string) =>
  JSON.parse(readFileSync(new URL(`../../scenarios/${id}/seed.json`, import.meta.url), "utf8")) as ScenarioSeed;
const top = (r: NationRank[], n: number) => r.slice(0, n).map((x) => x.tag);
const byTag = (r: NationRank[], tag: string) => r.find((x) => x.tag === tag)!;

describe("powerRanking", () => {
  test("ranks every living nation once, 1..N, strongest first", () => {
    const s = makeState();
    country(s, "FRA").alive = false;
    const r = powerRanking(s);
    expect(r.length).toBe(s.countries.length - 1);
    expect(r.map((x) => x.rank)).toEqual(r.map((_, i) => i + 1));
    expect(r.some((x) => x.tag === "FRA")).toBe(false);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
  });

  test("is deterministic and breaks ties by tag", () => {
    // The fixture gives every nation the same stats, so only territory, nukes and diplomacy differ.
    const a = powerRanking(makeState()), b = powerRanking(makeState());
    expect(a).toEqual(b);
    for (let i = 1; i < a.length; i++) if (a[i - 1].score === a[i].score) expect(a[i - 1].tag < a[i].tag).toBe(true);
  });

  test("each stat lifts the score", () => {
    // A clear leader, so Belgium's gains are measured against someone.
    const world = () => {
      const s = makeState();
      Object.assign(country(s, "USA"), { gdp: 1000, military: 90, population: 300 });
      return s;
    };
    const base = byTag(powerRanking(world()), "BEL").score;
    const bump = (f: (s: GameState) => void) => {
      const s = world();
      f(s);
      return byTag(powerRanking(s), "BEL").score;
    };
    expect(bump((s) => (country(s, "BEL").gdp = 400))).toBeGreaterThan(base);
    expect(bump((s) => (country(s, "BEL").military = 60))).toBeGreaterThan(base);
    expect(bump((s) => (country(s, "BEL").population = 40))).toBeGreaterThan(base);
    expect(bump((s) => (country(s, "BEL").stability = 90))).toBeGreaterThan(base);
    expect(bump((s) => (country(s, "BEL").nuclear = true))).toBeGreaterThan(base);
    expect(bump((s) => (country(s, "BEL").warExhaustion = 80))).toBeLessThan(base);
    expect(bump((s) => s.organizations[0].bodies[1].veto!.push("BEL"))).toBeGreaterThan(base);
  });

  test("a veto and leading a bloc count as diplomatic weight", () => {
    const r = powerRanking(makeState());
    expect(byTag(r, "USA").parts.diplomacy).toBeGreaterThan(byTag(r, "BRA").parts.diplomacy);
    expect(byTag(r, "BRA").parts.diplomacy).toBe(0);
  });

  test("tiers follow rank and the share of the leader's score", () => {
    expect(tierFor(1, 1)).toBe("great");
    expect(tierFor(8, 0.4)).toBe("great");
    expect(tierFor(9, 0.4)).toBe("major");
    expect(tierFor(5, 0.1)).toBe("regional"); // top 8, but far behind the leader
    expect(tierFor(30, 0.1)).toBe("regional");
    expect(tierFor(51, 0.5)).toBe("minor");
    expect(tierFor(3, 0.01)).toBe("minor");
  });
});

describe("scenario starts", () => {
  test("Modern Day (2026): the US and China lead; Russia, India and the big Europeans are great powers", () => {
    const r = powerRanking(seed("modern-2026"));
    expect(top(r, 2)).toEqual(["USA", "CHN"]);
    const great = r.filter((x) => x.tier === "great").map((x) => x.tag);
    expect(great.length).toBe(8);
    for (const t of ["USA", "CHN", "RUS", "IND", "GBR", "FRA", "DEU", "JPN"]) expect(great).toContain(t);
    for (const t of ["ITA", "CAN", "BRA", "KOR", "TUR", "AUS"]) expect(byTag(r, t).tier).toBe("major");
    for (const t of ["LUX", "TUV", "ISL"]) expect(byTag(r, t).tier).toBe("minor");
  });

  test("Cold War (1962): the US and the USSR lead, Britain and France follow", () => {
    const r = powerRanking(seed("cold-war-1962"));
    expect(top(r, 2)).toEqual(["USA", "SOV"]);
    expect(top(r, 4).slice(2).sort()).toEqual(["FRA", "GBR"]);
    const great = r.filter((x) => x.tier === "great").map((x) => x.tag);
    expect(great.length).toBeGreaterThanOrEqual(6);
    expect(great.length).toBeLessThanOrEqual(8);
    for (const t of ["CHN", "DEU"]) expect(great).toContain(t);
    for (const t of ["ITA", "JPN", "CAN"]) expect(["great", "major"]).toContain(byTag(r, t).tier);
    expect(byTag(r, "LUX").tier).toBe("minor");
  });

  test("every tier is used in both scenarios", () => {
    for (const id of ["modern-2026", "cold-war-1962"]) {
      const tiers = new Set(powerRanking(seed(id)).map((x) => x.tier));
      expect([...tiers].sort()).toEqual(["great", "major", "minor", "regional"]);
    }
  });
});

describe("rank history", () => {
  test("records each turn's order and reports places gained since last turn", () => {
    const s = makeState();
    recordRanking(s);
    const before = powerRanking(s);
    const tag = before[before.length - 1].tag;
    expect(rankChange(s, tag, before.length)).toBeNull(); // turn 1 has no previous turn

    s.turn = 2;
    const c = country(s, tag);
    Object.assign(c, { gdp: 5000, military: 90, nuclear: true });
    const after = powerRanking(s);
    const now = after.find((x) => x.tag === tag)!.rank;
    expect(now).toBeLessThan(before.length);
    expect(rankChange(s, tag, now)).toBe(before.length - now);
  });

  test("keeps a bounded history and replaces a re-recorded turn", () => {
    const s = makeState();
    for (let t = 1; t <= RANK_HISTORY + 5; t++) {
      s.turn = t;
      recordRanking(s);
    }
    recordRanking(s);
    expect(s.rankHistory!.length).toBe(RANK_HISTORY);
    expect(s.rankHistory!.at(-1)!.turn).toBe(RANK_HISTORY + 5);
    expect(new Set(s.rankHistory!.map((h) => h.turn)).size).toBe(RANK_HISTORY);
  });
});
