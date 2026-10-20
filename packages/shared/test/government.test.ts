import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { governmentTraits, parseLeaders } from "../src/game/government.ts";

const labels = (g: string) => governmentTraits(g).traits.map((t) => t.label);

describe("governmentTraits", () => {
  test("reads form, system and federal from common labels", () => {
    expect(governmentTraits("Presidential republic")).toEqual({ form: "Republic", system: "Presidential", traits: [] });
    expect(governmentTraits("Federal parliamentary constitutional monarchy")).toMatchObject({ form: "Monarchy", system: "Parliamentary" });
    expect(labels("Federal parliamentary constitutional monarchy")).toEqual(["Federal"]);
    expect(governmentTraits("Semi-presidential republic (Fifth Republic)")).toMatchObject({ form: "Republic", system: "Semi-presidential" });
    expect(governmentTraits("Absolute monarchy (sultanate)")).toMatchObject({ form: "Monarchy", system: "Absolute" });
    expect(governmentTraits("Federal directorial republic (neutral)")).toMatchObject({ form: "Republic", system: "Directorial" });
  });

  test("names only what the label states", () => {
    expect(labels("Presidential republic (authoritarian)")).toEqual(["Authoritarian"]);
    expect(labels("Presidential republic (dominant party)")).toEqual(["Dominant power"]);
    expect(labels("Marxist-Leninist one-party state (pro-Chinese)")).toEqual(["Marxist-Leninist"]);
    expect(governmentTraits("Marxist-Leninist one-party state (pro-Chinese)").form).toBe("One-party state");
    expect(labels("Parliamentary republic under apartheid (white-minority rule)")).toEqual(["White-minority rule"]);
    expect(labels("Semi-presidential republic (martial law)")).toEqual(["Martial law"]);
    expect(governmentTraits("Military junta (civil war)")).toMatchObject({ form: "Military rule", traits: [{ label: "Civil war", tone: "danger" }] });
    expect(governmentTraits("Theocratic emirate").form).toBe("Theocracy");
    expect(governmentTraits("Interim caretaker government")).toEqual({ form: "Transitional", system: undefined, traits: [] });
    expect(governmentTraits("Constitutional monarchy (Provisional Government of National Union)")).toMatchObject({ form: "Monarchy", traits: [{ label: "Transitional" }] });
    expect(governmentTraits("Self-governing British federation under white-minority rule").form).toBe("Federation");
    expect(governmentTraits("Divided: rival governments in Tripoli and the east").form).toBe("Divided");
    expect(labels("Parliamentary republic (recognised only by Turkey)")).toEqual(["Unrecognised"]);
    expect(governmentTraits("Presidential 'Guided Democracy'")).toMatchObject({ form: "Republic", traits: [{ label: "Guided democracy" }] });
  });

  test("every scenario government gets a form", () => {
    const root = join(import.meta.dir, "..", "..", "scenarios");
    for (const id of ["modern-2026", "cold-war-1962"]) {
      const seed = JSON.parse(readFileSync(join(root, id, "seed.json"), "utf8")) as { countries: { government: string }[] };
      const unknown = seed.countries.map((c) => c.government).filter((g) => governmentTraits(g).form === "Government");
      expect(unknown).toEqual([]);
    }
  });
});

test("parseLeaders splits office-holders and titles", () => {
  expect(parseLeaders("Daniel Noboa (President)")).toEqual([{ name: "Daniel Noboa", title: "President" }]);
  expect(parseLeaders("King Hussein; Wasfi al-Tal (Prime Minister)")).toEqual([{ name: "King Hussein" }, { name: "Wasfi al-Tal", title: "Prime Minister" }]);
  expect(parseLeaders("Captains Regent")).toEqual([{ name: "Captains Regent" }]);
});
