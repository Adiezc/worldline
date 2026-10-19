// Dev-only: drive the HUD without a server. In the browser console:
//   __worldline.mock("orders")   // or "lobby" / "resolving"
//   __worldline.mockTurn()       // fire a fake turn result with map changes
// Loaded from main.tsx only when import.meta.env.DEV.
import type { Country, GameView, ScenarioStart, TurnResult } from "@worldline/shared";
import { DEFAULT_SETTINGS } from "@worldline/shared";
import start from "@worldline/scenarios/modern-2026/start.json";
import { applyView, useGame } from "../game/store.ts";

const scenario = start as ScenarioStart;

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function mockView(phase: GameView["phase"] = "orders"): GameView {
  const countries: Country[] = scenario.countries.map((c, i) => ({
    ...c,
    government: "Republic",
    leader: `Leader of ${c.name}`,
    gdp: Math.round(5 + rand(i) ** 3 * 25000),
    population: Math.round(1 + rand(i + 7) ** 3 * 1400),
    stability: Math.round(20 + rand(i + 3) * 75),
    military: Math.round(rand(i + 11) * 90),
    warExhaustion: Math.round(rand(i + 13) * 40),
    agenda: { persona: "A cautious pragmatist who values regional stability.", goals: ["Grow the economy", "Avoid entanglement in foreign wars"] },
    alive: true,
    nuclear: ["USA", "RUS", "CHN", "FRA", "GBR", "IND", "PAK", "ISR", "PRK"].includes(c.tag),
  }));
  const tags = countries.map((c) => c.tag);
  const relations: Record<string, number> = {};
  tags.forEach((t, i) => {
    if (t !== "FRA") relations[t < "FRA" ? `${t}|FRA` : `FRA|${t}`] = Math.round((rand(i + 21) - 0.45) * 180);
  });
  return {
    id: "demo",
    scenarioId: "modern-2026",
    name: "Demo World",
    date: "2026-03-01",
    turn: 3,
    phase,
    settings: { ...DEFAULT_SETTINGS },
    countries,
    owners: scenario.owners,
    controllers: scenario.controllers,
    relations,
    treaties: [{ id: "t1", type: "alliance", members: ["FRA", "DEU", "GBR"], name: "Entente Nouvelle", since: "2026-01-15" }],
    wars: [{ id: "w1", name: "Russo-Ukrainian War", attackers: ["RUS"], defenders: ["UKR"], goal: "Territorial conquest", since: "2022-02-24", calls: [{ tag: "BLR", via: "CSTO", since: 2 }] }],
    sanctions: [{ id: "s1", target: "RUS", by: ["USA", "FRA", "DEU", "GBR", "JPN"], source: "EU / G7", since: "2022-03-01" }],
    organizations: [
      {
        id: "un", abbrev: "UN", name: "United Nations", kind: "global", members: tags.slice(0, 190), observers: ["PSE"], candidates: [], suspended: [],
        bodies: [
          { id: "ga", name: "General Assembly", seats: [], rule: "twoThirds" },
          { id: "sc", name: "Security Council", seats: ["USA", "RUS", "CHN", "FRA", "GBR", "BRA", "IND", "JPN", "DEU", "ZAF"], veto: ["USA", "RUS", "CHN", "FRA", "GBR"], rule: "vetoMajority", handles: ["sanction", "peacekeeping", "authorizeForce"] },
        ],
        powers: ["sanction", "condemn", "peacekeeping", "admitMember", "authorizeForce", "custom"], effects: { forum: true }, cohesion: 48, founded: "1945-10-24",
      },
      {
        id: "eu", abbrev: "EU", name: "European Union", kind: "economic", members: ["FRA", "DEU", "ITA", "ESP", "POL", "NLD", "BEL", "AUT", "SWE", "PRT", "GRC"], observers: [], candidates: [{ tag: "UKR", since: "2022-06-23" }, { tag: "SRB", since: "2012-03-01", note: "Stalled" }], suspended: ["HUN"],
        bodies: [{ id: "council", name: "European Council", seats: [], rule: "qualifiedMajority" }],
        powers: ["sanction", "tradePolicy", "admitMember", "suspendMember", "custom"], effects: { tradeBloc: true }, cohesion: 71,
      },
    ],
    resolutions: [
      { id: "r1", orgId: "eu", bodyId: "council", type: "sanction", proposer: "POL", target: "RUS", text: "Extend energy sanctions for twelve months.", turn: 3, status: "pending", votes: { DEU: "yes" } },
      { id: "r0", orgId: "un", bodyId: "sc", type: "condemn", proposer: "USA", target: "RUS", text: "Condemns the continued occupation of Ukrainian territory.", turn: 2, status: "vetoed", votes: { USA: "yes", FRA: "yes", GBR: "yes", RUS: "no", CHN: "abstain" }, reasons: { RUS: "Interference in internal affairs", CHN: "Calls for dialogue" } },
    ],
    events: [
      { id: "e1", turn: 2, date: "2026-02-03", headline: "Paris summit agrees on joint defence procurement", body: "European leaders agreed to pool spending on air defence.", countries: ["FRA", "DEU"], causes: [], effects: [], scope: "player" },
      { id: "e2", turn: 2, date: "2026-02-11", headline: "Typhoon season begins early in the Philippines", body: "Thousands evacuated.", countries: ["PHL"], causes: [], effects: [], scope: "world" },
    ],
    eventCount: 2,
    memory: [],
    chats: [{ id: "c1", members: ["FRA", "DEU"], lastTurn: 3, messages: [
      { id: "m1", from: "DEU", text: "Chancellor's office here. We welcome your proposal in principle.", at: "2026-02-20" },
      { id: "m2", from: "DEU", text: "", at: "2026-02-21", proposal: { id: "p1", kind: "treaty", treatyType: "defensive", members: ["FRA", "DEU"], terms: "Mutual defence of each other's territory for ten years.", status: "open", awaiting: ["FRA"] } },
    ] }],
    formations: [],
    players: [
      { id: "me", name: "Talleyrand", country: phase === "lobby" ? null : "FRA", isHost: true, connected: true, ready: false },
      { id: "p2", name: "Bismarck", country: "DEU", isHost: false, connected: true, ready: true },
    ],
    orders: [{ id: "o1", playerId: "me", country: "FRA", text: "Propose a European rapid-reaction force headquartered in Strasbourg." }],
    jumpVotes: {},
    lastVerdicts: [{ orderId: "old1", outcome: "partial", reason: "Germany agreed, Italy hesitated." }],
    usage: { requests: 12, promptTokens: 0, completionTokens: 0, failures: 0 },
    rotation: 0,
    seq: 0,
    you: { playerId: "me", country: phase === "lobby" ? null : "FRA", isHost: true },
    formables: [{ name: "United States of Europe", concept: "A federal Europe with a common army and treasury.", countries: ["FRA", "DEU", "ITA", "ESP", "BEL", "NLD"] }],
    calendar: [],
    ai: { provider: "mock", usedToday: 140, dailyLimit: 1000 },
  } as GameView;
}

function mock(phase: GameView["phase"] = "orders") {
  useGame.setState({ status: "open", gameId: "demo", playerId: "me" });
  applyView(mockView(phase));
}

function mockTurn() {
  const s = useGame.getState();
  if (!s.view) mock();
  const v = useGame.getState().view!;
  const fra = v.countries.findIndex((c) => c.tag === "FRA");
  const bel = v.countries.findIndex((c) => c.tag === "BEL");
  const belProvs: number[] = [];
  v.owners.forEach((o, id) => o === bel && belProvs.push(id));
  const result: TurnResult = {
    turn: v.turn,
    fromDate: v.date,
    toDate: "2026-04-01",
    verdicts: [{ orderId: "o1", outcome: "success", reason: "Germany and Belgium signed on." }],
    votes: [{ resolutionId: "r1", orgAbbrev: "EU", status: "passed", summary: "Energy sanctions on Russia extended.", text: "" }],
    events: [
      { id: "x1", turn: v.turn, date: "2026-03-09", headline: "Brussels votes to join a union with France", body: "In a surprise referendum Belgium opts for union.", countries: ["BEL", "FRA"], causes: ["o1"], effects: [], scope: "player", mapDiff: belProvs.map((p) => ({ province: p, owner: fra, controller: fra })) },
      { id: "x2", turn: v.turn, date: "2026-03-20", headline: "Oil prices spike after Gulf incident", body: "Brent tops $110.", countries: ["IRN", "SAU"], causes: [], effects: [], scope: "world" },
    ],
  };
  useGame.setState({ lastResult: result, resultOpen: true, mapHold: true, playback: null, turnBase: null, viewAdvanced: false });
  const owners = v.owners.slice();
  belProvs.forEach((p) => (owners[p] = fra));
  applyView({ ...v, turn: v.turn + 1, date: "2026-04-01", owners, controllers: owners, lastVerdicts: result.verdicts });
}

(window as unknown as { __worldline: unknown }).__worldline = { mock, mockTurn, useGame };
