// Dev-only: drive the HUD without a server. In the browser console:
//   __worldline.mock("orders")   // or "lobby" / "resolving"; second arg "coldwar" for the era theme
//   __worldline.mockTurn()       // fire a fake turn result with map changes
//   __worldline.mockRewind()     // pretend the host rewound to turn 2
// Loaded from main.tsx only when import.meta.env.DEV.
import type { Country, EraTheme, GameView, ScenarioStart, TurnResult } from "@worldline/shared";
import { DEFAULT_SETTINGS } from "@worldline/shared";
import start from "@worldline/scenarios/modern-2026/start.json";
import { applyView, useGame } from "../game/store.ts";

const scenario = start as ScenarioStart;

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

function mockView(phase: GameView["phase"] = "orders", theme: EraTheme = "modern"): GameView {
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
    memory: [
      { upToTurn: 1, text: "January 2026 opened with Bulgaria joining the euro and fresh talks over a Ukrainian ceasefire. Washington and Beijing traded tariff threats while the Gulf stayed tense." },
      { upToTurn: 2, text: "France and Germany agreed to pool air-defence procurement in Paris. The EU extended its sanctions on Russia, and typhoons struck the Philippines unusually early." },
    ],
    chats: [{ id: "c1", members: ["FRA", "DEU"], lastTurn: 3, messages: [
      { id: "m1", from: "DEU", text: "Chancellor's office here. We welcome your proposal in principle.", at: "2026-02-20" },
      { id: "m2", from: "DEU", text: "", at: "2026-02-21", proposal: { id: "p1", kind: "treaty", treatyType: "defensive", members: ["FRA", "DEU"], terms: "Mutual defence of each other's territory for ten years.", status: "open", awaiting: ["FRA"] } },
    ] }],
    formed: [],
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
    formables: [{
      id: "european-federation", name: "United States of Europe", concept: "A federal Europe with a common army and treasury.", countries: ["FRA", "DEU", "ITA", "ESP", "BEL", "NLD"],
      provinces: [], formers: ["FRA", "DEU"], color: "#2f4a8a", flag: "gen:canton:#2f4a8a,#f4d03f",
    }],
    calendar: [
      { date: "2026-03-15", title: "Slovenian parliamentary election", kind: "election", countries: ["SVN"] },
      { date: "2026-04-12", title: "Hungarian parliamentary election", kind: "election", countries: ["HUN"], note: "Fidesz faces its strongest challenge in years." },
      { date: "2026-06-14", title: "G7 summit in Évian", kind: "summit", countries: ["FRA", "USA", "DEU", "GBR", "ITA", "JPN", "CAN"] },
      { date: "2026-07-09", title: "US tariff pause expires", kind: "deadline", countries: ["USA"] },
      { date: "2026-06-11", title: "FIFA World Cup opens", kind: "event", countries: ["USA", "CAN", "MEX"] },
    ],
    theme,
    snapshots: [
      { turn: 1, date: "2026-01-01" },
      { turn: 2, date: "2026-02-01" },
      { turn: 3, date: "2026-03-01" },
    ],
    intervenable: ["e1", "e2"],
    allyOperations: [],
    ai: { provider: "mock", usedToday: 140, dailyLimit: 1000 },
  };
}

function mock(phase: GameView["phase"] = "orders", theme: EraTheme = "modern") {
  useGame.setState({ status: "open", gameId: "demo", playerId: "me" });
  applyView(mockView(phase, theme));
}

/** As if the host rewound to the start of turn 2: date and turn go backwards. */
function mockRewind() {
  const v = useGame.getState().view ?? mockView();
  applyView({ ...mockView("orders", v.theme), turn: 2, date: "2026-02-01", snapshots: [{ turn: 1, date: "2026-01-01" }, { turn: 2, date: "2026-02-01" }], intervenable: [] });
}

function mockTurn() {
  const s = useGame.getState();
  if (!s.view) mock();
  const v = useGame.getState().view!;
  const fra = v.countries.findIndex((c) => c.tag === "FRA");
  const bel = v.countries.findIndex((c) => c.tag === "BEL");
  const belProvs: number[] = [];
  v.owners.forEach((o, id) => o === bel && belProvs.push(id));
  const f = v.countries[fra];
  const owned = v.owners.filter((o) => o === fra).length;
  const result: TurnResult = {
    turn: v.turn,
    fromDate: v.date,
    toDate: "2026-04-01",
    verdicts: [{ orderId: "o1", outcome: "success", reason: "Germany and Belgium signed on." }],
    votes: [{ resolutionId: "r1", orgAbbrev: "EU", status: "passed", summary: "Energy sanctions on Russia extended.", text: "" }],
    events: [
      {
        id: "x1", turn: v.turn, date: "2026-03-09", headline: "Brussels votes to join a union with France", body: "In a surprise referendum Belgium opts for union.", countries: ["BEL", "FRA"], causes: ["o1"],
        effects: [
          { type: "transferProvinces", provinces: belProvs, from: "BEL", to: "FRA" },
          { type: "statDelta", country: "FRA", stat: "stability", delta: -2 },
          { type: "relationDelta", a: "FRA", b: "DEU", delta: -6 },
        ],
        scope: "player", mapDiff: belProvs.map((p) => ({ province: p, owner: fra, controller: fra })),
      },
      {
        id: "x2", turn: v.turn, date: "2026-03-20", headline: "Oil prices spike after Gulf incident", body: "Brent tops $110.", countries: ["IRN", "SAU"], causes: [],
        effects: [{ type: "statDelta", country: "SAU", stat: "gdp", delta: 0.8 }, { type: "imposeSanctions", target: "IRN", by: ["USA", "GBR"] }],
        scope: "world",
      },
    ],
    nations: [{
      tag: "FRA",
      stats: {
        gdp: [f.gdp, f.gdp * 1.012], population: [f.population, f.population * 1.0004], stability: [f.stability, f.stability - 2],
        military: [f.military, f.military + 1.5], warExhaustion: [f.warExhaustion, f.warExhaustion],
      },
      regions: { owned: [owned, owned + belProvs.length], occupied: [0, 0], occupying: [0, 0] },
      relations: [{ tag: "BEL", from: 22, to: 48 }, { tag: "DEU", from: 31, to: 25 }],
    }],
  };
  useGame.setState({ lastResult: result, resultOpen: true, mapHold: true, playback: null, turnBase: null });
  const owners = v.owners.slice();
  belProvs.forEach((p) => (owners[p] = fra));
  applyView({
    ...v,
    turn: v.turn + 1,
    date: "2026-04-01",
    owners,
    controllers: owners,
    lastVerdicts: result.verdicts,
    snapshots: [...v.snapshots, { turn: v.turn + 1, date: "2026-04-01" }],
    intervenable: result.events.map((e) => e.id),
  });
}

(window as unknown as { __worldline: unknown }).__worldline = { mock, mockTurn, mockRewind, useGame };
