import { describe, expect, test } from "bun:test";
import { formableStatus, formablesFor, proclaimNation } from "../src/game/formation.ts";
import type { Formable } from "../src/game/scenario.ts";
import { country, idx, makeState, startProvinces } from "./fixtures.ts";

/** United Korea over the start territory of both Koreas. */
const korea = (): Formable => ({
  id: "united-korea", name: "United Korea", concept: "", countries: ["KOR", "PRK"],
  provinces: [...startProvinces("KOR"), ...startProvinces("PRK")], formers: ["KOR", "PRK"],
  color: "#3a6ea5", flag: "hist:united-korea",
});

describe("forming a nation", () => {
  test("only listed formers see it, and only until it exists", () => {
    const s = makeState();
    expect(formablesFor(s, [korea()], "KOR")).toHaveLength(1);
    expect(formablesFor(s, [korea()], "JPN")).toHaveLength(0);
    s.formed = ["united-korea"];
    expect(formablesFor(s, [korea()], "KOR")).toHaveLength(0);
  });

  test("needs control of every region", () => {
    const s = makeState();
    const f = korea();
    expect(formableStatus(s, f, "KOR").missing).toEqual(startProvinces("PRK"));
    const r = proclaimNation(s, f, "KOR");
    expect(r.ok).toBe(false);
    expect(r.problems.join(" ")).toContain("not under KOR's control");
    expect(country(s, "KOR").name).not.toBe("United Korea");
  });

  test("proclaiming takes the fixed identity and absorbs the countries left without land", () => {
    const s = makeState();
    const f = korea();
    for (const id of startProvinces("PRK")) s.controllers[id] = idx(s, "KOR");
    s.claims = [{ id: "c1", claimant: "PRK", provinces: [1], note: "x", since: s.date }];
    const pop = country(s, "KOR").population + country(s, "PRK").population;
    const r = proclaimNation(s, f, "KOR");
    expect(r.ok).toBe(true);
    const k = country(s, "KOR");
    expect(k).toMatchObject({ name: "United Korea", color: "#3a6ea5", flag: "hist:united-korea" });
    expect(k.population).toBeCloseTo(pop);
    expect(country(s, "PRK").alive).toBe(false);
    for (const id of f.provinces) expect(s.owners[id]).toBe(idx(s, "KOR"));
    expect(s.formed).toEqual(["united-korea"]);
    expect(s.claims?.[0]?.claimant).toBe("KOR");
    expect(proclaimNation(s, f, "KOR").ok).toBe(false);
  });
});
