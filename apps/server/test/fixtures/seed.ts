// Minimal ScenarioSeed built from start.json, so engine tests never depend on the generated
// modern-2026 seed: plausible default stats, a NATO-like alliance, a UN with GA and SC, and the
// Russia–Ukraine war using the occupation already encoded in start.json.

import { join } from "node:path";
import type { Country, Organization, ScenarioSeed, ScenarioStart } from "@worldline/shared";

export const ROOT = join(import.meta.dir, "..", "..", "..", "..");

// tag → [gdp $bn, population m, military 0-100, nuclear]
const STATS: Record<string, [number, number, number, boolean?]> = {
  USA: [29000, 340, 95, true], CHN: [18700, 1410, 85, true], DEU: [4700, 84, 55], JPN: [4100, 124, 60],
  IND: [3900, 1440, 75, true], GBR: [3600, 68, 65, true], FRA: [3200, 68, 68, true], ITA: [2300, 59, 55],
  CAN: [2200, 41, 45], BRA: [2200, 212, 50], RUS: [2100, 144, 80, true], KOR: [1800, 52, 65],
  AUS: [1800, 27, 50], ESP: [1700, 48, 50], MEX: [1800, 130, 40], IDN: [1400, 280, 50],
  TUR: [1300, 86, 65], NLD: [1200, 18, 45], SAU: [1100, 36, 55], CHE: [950, 9, 35],
  POL: [900, 37, 55], TWN: [800, 23, 55], BEL: [650, 12, 35], SWE: [600, 11, 45],
  IRN: [400, 90, 60], ISR: [550, 10, 70, true], AUT: [520, 9, 35], NOR: [500, 6, 45],
  UKR: [190, 37, 60], PAK: [370, 245, 65, true], EGY: [380, 115, 55], NGA: [250, 230, 45],
  ZAF: [400, 63, 40], PRK: [30, 26, 60, true], PRT: [300, 10, 35], ROU: [350, 19, 40],
};

const NATO = [
  "USA", "CAN", "GBR", "FRA", "DEU", "ITA", "ESP", "PRT", "NLD", "BEL", "LUX", "DNK", "NOR", "ISL", "POL", "CZE",
  "SVK", "HUN", "ROU", "BGR", "GRC", "TUR", "EST", "LVA", "LTU", "SVN", "HRV", "ALB", "MNE", "MKD", "FIN", "SWE",
];
const P5 = ["USA", "CHN", "RUS", "GBR", "FRA"];
const SC_ELECTED = ["DNK", "GRC", "PAK", "PAN", "SOM", "BHR", "COL", "COD", "LVA", "LBR"];

export async function buildFixtureSeed(): Promise<ScenarioSeed> {
  const start = (await Bun.file(join(ROOT, "packages", "scenarios", "modern-2026", "start.json")).json()) as ScenarioStart;
  const tags = new Set(start.countries.map((c) => c.tag));
  const has = (t: string) => tags.has(t);

  const countries: Country[] = start.countries.map((c) => {
    const [gdp, population, military, nuclear] = STATS[c.tag] ?? [25, 8, 20];
    const war = c.tag === "RUS" || c.tag === "UKR";
    return {
      tag: c.tag, name: c.name, color: c.color,
      government: "Republic", leader: `Leader of ${c.name}`,
      gdp, population, stability: war ? 45 : 55, military, warExhaustion: war ? 35 : 0,
      agenda: { persona: `${c.name} pursues prosperity and security.`, goals: ["Grow the economy", "Keep the country secure"] },
      alive: true, nuclear: nuclear || undefined,
    };
  });

  const all = start.countries.map((c) => c.tag);
  const organizations: Organization[] = [
    {
      id: "org-nato", abbrev: "NATO", name: "North Atlantic Treaty Organization", kind: "military",
      members: NATO.filter(has), observers: [], candidates: [], suspended: [],
      bodies: [{ id: "nac", name: "North Atlantic Council", seats: [], rule: "consensus" }],
      powers: ["admitMember", "condemn", "custom"], effects: { mutualDefense: true }, cohesion: 70, founded: "1949-04-04",
    },
    {
      id: "org-un", abbrev: "UN", name: "United Nations", kind: "global",
      members: all, observers: [], candidates: [], suspended: [],
      bodies: [
        { id: "ga", name: "General Assembly", seats: [], rule: "simpleMajority", handles: ["condemn", "custom", "tradePolicy", "suspendMember", "expelMember"] },
        {
          id: "sc", name: "Security Council", seats: [...P5, ...SC_ELECTED].filter(has), veto: P5, rule: "vetoMajority",
          handles: ["sanction", "peacekeeping", "authorizeForce", "admitMember"],
        },
      ],
      powers: ["sanction", "condemn", "peacekeeping", "admitMember", "suspendMember", "expelMember", "tradePolicy", "authorizeForce", "custom"],
      effects: { forum: true }, cohesion: 55, founded: "1945-10-24",
    },
  ];

  return {
    id: start.id,
    name: start.name,
    date: start.date,
    countries,
    owners: start.owners,
    controllers: start.controllers,
    relations: { "RUS|UKR": -90, "RUS|USA": -60, "UKR|USA": 55, "CHN|USA": -35, "CHN|RUS": 50, "FRA|DEU": 70, "DEU|GBR": 60 },
    treaties: [{ id: "t-aukus", type: "defensive", members: ["AUS", "GBR", "USA"], name: "AUKUS", since: "2021-09-15" }],
    wars: [{
      id: "war-rus-ukr", name: "Russo-Ukrainian War", attackers: ["RUS"], defenders: ["UKR"],
      goal: "Russia seeks to annex eastern Ukraine; Ukraine seeks to restore its borders.", since: "2022-02-24",
    }],
    sanctions: [{ id: "s-rus", target: "RUS", by: ["USA", "GBR", "CAN", "JPN"], source: "Western sanctions", since: "2022-02-28" }],
    organizations,
    calendar: [{ date: "2026-01-20", title: "Portuguese presidential election", kind: "election", countries: ["PRT"] }],
    worldBrief: "January 2026. Russia's war in Ukraine grinds on along a static front. US–China rivalry shapes trade. Europe is rearming.",
    rules: "Wars are slow and costly. Economies change gradually. Elections follow the calendar.",
    formables: [],
  };
}
