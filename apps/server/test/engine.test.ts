// Engine tests against the offline MockProvider. The whole suite runs on the fixture seed and,
// when it exists and parses, again on the generated modern-2026 seed.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  addDays, buildMapIndex, countryByTag, countryIndex, relKey,
  type GameState, type MapMeta, type ScenarioSeed,
} from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import type { AiProvider, AiRequest, EngineDeps } from "../src/engine/api.ts";
import { engine, extractJson } from "../src/engine/index.ts";
import { buildFixtureSeed, ROOT } from "./fixtures/seed.ts";

const meta = (await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta;
const map = buildMapIndex(meta);

const seeds: [string, ScenarioSeed][] = [["fixture", await buildFixtureSeed()]];
const seedPath = join(ROOT, "packages", "scenarios", "modern-2026", "seed.json");
if (existsSync(seedPath)) {
  try {
    seeds.push(["modern-2026 seed.json", (await Bun.file(seedPath).json()) as ScenarioSeed]);
  } catch (err) {
    console.warn(`seed.json present but unreadable, testing the fixture only: ${err}`);
  }
}

/** Records request kinds so tests can assert which calls were made. */
class SpyProvider extends MockProvider {
  kinds: AiRequest["kind"][] = [];
  override async complete(req: AiRequest) {
    this.kinds.push(req.kind);
    return super.complete(req);
  }
}

const failing: AiProvider = {
  name: "mock",
  quota: () => ({ usedToday: 0, dailyLimit: 0 }),
  complete: async () => { throw new Error("provider down"); },
};

function newGame(seed: ScenarioSeed, players: [string, string][] = []) {
  const state = engine.createGame({ id: "g1", name: "Test", seed });
  state.phase = "orders";
  state.players = players.map(([id, country], i) => ({ id, name: id, country, isHost: i === 0, connected: true, ready: false }));
  return state;
}

const depsFor = (seed: ScenarioSeed, ai: AiProvider = new MockProvider()): EngineDeps => ({ map, seed, ai });

function expectSaneStats(state: GameState) {
  for (const c of state.countries) {
    if (!c.alive) continue;
    for (const k of ["gdp", "population", "stability", "military", "warExhaustion"] as const) expect(Number.isFinite(c[k])).toBe(true);
    expect(c.gdp).toBeGreaterThan(0);
    expect(c.population).toBeGreaterThan(0);
    for (const k of ["stability", "military", "warExhaustion"] as const) {
      expect(c[k]).toBeGreaterThanOrEqual(0);
      expect(c[k]).toBeLessThanOrEqual(100);
    }
  }
  for (const v of Object.values(state.relations)) expect(Math.abs(v)).toBeLessThanOrEqual(100);
}

test("extractJson handles fences, prose and trailing commas", () => {
  expect(extractJson("Sure! ```json\n{\"a\":1}\n``` done")).toEqual({ a: 1 });
  expect(extractJson("<think>{no}</think>Here: {\"a\":{\"b\":\"}\"}} trailing")).toEqual({ a: { b: "}" } });
  expect(extractJson("{\"a\":[1,2,],}")).toEqual({ a: [1, 2] });
  expect(extractJson("I will fill {orderVerdicts} first. {\"a\":1}")).toEqual({ a: 1 });
});

for (const [label, seed] of seeds) {
  describe(label, () => {
    test("createGame deep-clones the seed", () => {
      const state = newGame(seed);
      expect(state.turn).toBe(1);
      expect(state.date).toBe(seed.date);
      expect(state.seq).toBe(0);
      state.owners[1] = -5;
      state.countries[0].gdp = -1;
      expect(seed.owners[1]).not.toBe(-5);
      expect(seed.countries[0].gdp).not.toBe(-1);
    });

    test("10 turns without orders advance the world", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      const deps = depsFor(seed);
      let date = state.date;
      for (let i = 0; i < 10; i++) {
        const res = await engine.runTurn(state, deps);
        expect(res.fromDate).toBe(date);
        expect(res.toDate).toBe(addDays(date, 30));
        expect(res.events.length).toBeGreaterThan(0);
        date = res.toDate;
      }
      expect(state.turn).toBe(11);
      expect(state.date).toBe(addDays(seed.date, 300));
      expect(state.events.length).toBeGreaterThan(20);
      expect(state.memory.length).toBeGreaterThanOrEqual(2);
      expect(state.usage.requests).toBeGreaterThan(10);
      expectSaneStats(state);
    });

    test("a player order gets a verdict and an event", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      state.orders = { p1: [{ id: "o1", playerId: "p1", country: "FRA", text: "Fund a new generation of nuclear reactors." }] };
      const res = await engine.runTurn(state, depsFor(seed));
      expect(res.verdicts.find((v) => v.orderId === "o1")).toBeDefined();
      expect(state.lastVerdicts.map((v) => v.orderId)).toContain("o1");
      expect(res.events.some((e) => e.causes.includes("o1") && e.scope === "player")).toBe(true);
      expect(state.orders).toEqual({});
    });

    test("economy mode skips the director", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      state.settings.economyMode = true;
      const spy = new SpyProvider();
      await engine.runTurn(state, depsFor(seed, spy));
      expect(spy.kinds).not.toContain("director");
      expect(spy.kinds).toContain("resolver");
    });

    test("open-ended jumps stop at the resolver's stopDate", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      state.settings.jumpDays = 0;
      const res = await engine.runTurn(state, depsFor(seed));
      expect(res.toDate).toBe(addDays(seed.date, 30));
      expect(res.events.every((e) => e.date <= res.toDate)).toBe(true);
    });

    test("chat proposal accepted by the AI creates a treaty", async () => {
      const state = newGame(seed, [["p1", "GBR"]]);
      state.relations[relKey("GBR", "DEU")] = 60;
      state.treaties = state.treaties.filter((t) => !(t.type === "trade" && t.members.includes("GBR") && t.members.includes("DEU")));
      const chatId = engine.openChat(state, { from: "GBR", with: ["DEU"] });
      expect(engine.openChat(state, { from: "DEU", with: ["GBR"] })).toBe(chatId);
      await engine.sendChat(state, depsFor(seed), {
        chatId, playerId: "p1", text: "Let us cut tariffs.",
        proposal: { kind: "treaty", treatyType: "trade", members: ["GBR", "DEU"], terms: "Zero tariffs on industrial goods." },
      });
      const chat = state.chats.find((c) => c.id === chatId)!;
      expect(chat.messages.length).toBe(2);
      expect(chat.messages[1].from).toBe("DEU");
      expect(chat.messages[0].proposal?.status).toBe("accepted");
      expect(state.treaties.some((t) => t.type === "trade" && t.members.includes("GBR") && t.members.includes("DEU"))).toBe(true);
      expect(state.events.at(-1)?.causes).toContain(`chat:${chatId}`);
    });

    test("a hostile AI rejects the proposal", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      const chatId = engine.openChat(state, { from: "UKR", with: ["RUS"] });
      const before = state.treaties.length;
      await engine.sendChat(state, depsFor(seed), {
        chatId, playerId: "p1", text: "Sign this.", proposal: { kind: "treaty", treatyType: "nonaggression", members: ["UKR", "RUS"], terms: "No more attacks." },
      });
      expect(state.chats[0].messages[0].proposal?.status).toBe("rejected");
      expect(state.treaties.length).toBe(before);
    });

    test("accepting an AI peace proposal ends the war", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      const war = state.wars.find((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))!;
      expect(war).toBeDefined();
      const chatId = engine.openChat(state, { from: "UKR", with: ["RUS"] });
      state.chats[0].messages.push({
        id: "m-x", from: "RUS", text: "We propose a ceasefire.", at: state.date,
        proposal: { id: "p-x", kind: "endWar", members: ["RUS", "UKR"], terms: "Ceasefire on current lines.", status: "open", awaiting: ["UKR"] },
      });
      const res = engine.respondProposal(state, { chatId, proposalId: "p-x", byTag: "UKR", accept: true });
      expect(res.ok).toBe(true);
      expect(state.wars.some((w) => w.id === war.id)).toBe(false);
      // Occupied regions return to their owners when peace is made without a transfer.
      const rus = countryIndex(state, "RUS"), ukr = countryIndex(state, "UKR");
      expect(state.owners.some((o, id) => o === ukr && state.controllers[id] === rus)).toBe(false);
      expect(engine.respondProposal(state, { chatId, proposalId: "p-x", byTag: "UKR", accept: true }).ok).toBe(false);
    });

    test("a player's resolution is voted on", async () => {
      const state = newGame(seed, [["p1", "USA"]]);
      const un = state.organizations.find((o) => o.abbrev === "UN")!;
      const res = engine.proposeResolution(state, { orgId: un.id, proposer: "USA", resolutionType: "condemn", target: "RUS", text: "Condemns the invasion of Ukraine." });
      expect(res.ok).toBe(true);
      const r = state.resolutions.at(-1)!;
      expect(engine.castVote(state, { resolutionId: r.id, country: "USA", vote: "yes" }).ok).toBe(true);
      expect(engine.proposeResolution(state, { orgId: un.id, proposer: "USA", resolutionType: "condemn", target: "RUS", text: "Again." }).ok).toBe(false);
      const turn = await engine.runTurn(state, depsFor(seed));
      const done = state.resolutions.find((x) => x.id === r.id)!;
      expect(done.status).not.toBe("pending");
      expect(done.votes?.USA).toBe("yes");
      expect(Object.keys(done.votes ?? {}).length).toBeGreaterThan(10);
      expect(turn.votes.map((v) => v.resolutionId)).toContain(r.id);
      expect(turn.events.some((e) => e.countries.includes("USA") && e.countries.includes("RUS") && e.scope === "player")).toBe(true);
      expect(engine.castVote(state, { resolutionId: r.id, country: "USA", vote: "no" }).ok).toBe(false);
    });

    test("formation: assess, consent and proclaim merges territory", async () => {
      const state = newGame(seed, [["p1", "DEU"]]);
      state.relations[relKey("DEU", "AUT")] = 80;
      countryByTag(state, "DEU")!.stability = 62;
      const deps = depsFor(seed);
      const goal = await engine.assessFormation(state, deps, {
        founder: "DEU",
        request: { name: "Danubian Union", concept: "A federal union of German-speaking states.", countries: ["AUT"], color: "#445566", government: "Federal republic" },
      });
      expect(goal.verdict).toBe("achievable");
      expect(goal.requirements.every((r) => r.met)).toBe(true);
      expect(goal.consent).toEqual([{ country: "AUT", needed: true, willing: true, human: false }]);
      const again = await engine.assessFormation(state, deps, { formationId: goal.id });
      expect(again).toBe(goal);

      const aut = countryIndex(state, "AUT"), deu = countryIndex(state, "DEU");
      const autRegions = state.owners.map((o, id) => (o === aut ? id : 0)).filter(Boolean);
      const res = await engine.proclaimFormation(state, deps, { formationId: goal.id });
      expect(res.problems).toEqual([]);
      expect(res.ok).toBe(true);
      expect(res.event?.mapDiff?.length).toBeGreaterThan(0);
      expect(autRegions.every((id) => state.owners[id] === deu)).toBe(true);
      expect(countryByTag(state, "AUT")!.alive).toBe(false);
      expect(countryByTag(state, "DEU")!.name).toBe("Danubian Union");
      expect(state.formations[0].status).toBe("proclaimed");
    });

    test("formation with unmet requirements cannot be proclaimed", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      state.relations[relKey("FRA", "BEL")] = 0;
      const deps = depsFor(seed);
      const goal = await engine.assessFormation(state, deps, {
        founder: "FRA", request: { name: "Francia", concept: "Union", countries: ["BEL"], color: "#112233", government: "Republic" },
      });
      expect(goal.verdict).toBe("notYet");
      const res = await engine.proclaimFormation(state, deps, { formationId: goal.id });
      expect(res.ok).toBe(false);
      expect(res.problems.length).toBeGreaterThan(0);
      engine.abandonFormation(state, { formationId: goal.id });
      expect(state.formations[0].status).toBe("abandoned");
    });

    test("advisor, polish and brainstorm return text", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      const deps = depsFor(seed);
      expect((await engine.advisor(state, deps, { country: "UKR" })).length).toBeGreaterThan(50);
      expect(await engine.polish(state, deps, { country: "UKR", text: "  build   more drones" })).toBe("Build more drones.");
      const ideas = await engine.brainstorm(state, deps, { country: "UKR" });
      expect(ideas.length).toBeGreaterThanOrEqual(4);
      expect(ideas.length).toBeLessThanOrEqual(6);
    });

    test("a failing provider leaves the game untouched", async () => {
      const state = newGame(seed, [["p1", "FRA"]]);
      state.orders = { p1: [{ id: "o1", playerId: "p1", country: "FRA", text: "Raise taxes." }] };
      const snapshot = structuredClone(state);
      await expect(engine.runTurn(state, depsFor(seed, failing))).rejects.toThrow(/provider down/);
      expect(state).toEqual(snapshot);

      const chatId = engine.openChat(state, { from: "FRA", with: ["DEU"] });
      await expect(engine.sendChat(state, depsFor(seed, failing), { chatId, playerId: "p1", text: "Hello" })).rejects.toThrow();
      expect(state.chats.find((c) => c.id === chatId)!.messages).toEqual([]);
    });
  });
}

test("callJson repairs invalid output once", async () => {
  const seed = seeds[0][1];
  const state = newGame(seed, [["p1", "FRA"]]);
  const mock = new MockProvider();
  let calls = 0;
  const flaky: AiProvider = {
    name: "mock",
    quota: () => mock.quota(),
    complete: async (req, s) => (++calls === 1 ? { text: "I think the answer is {broken", usage: { model: "x", promptTokens: 1, completionTokens: 1 } } : mock.complete(req)),
  };
  expect(await engine.polish(state, depsFor(seed, flaky), { country: "FRA", text: "do it" })).toBe("Do it.");
  expect(calls).toBe(2);
  expect(state.usage.failures).toBe(1);
  expect(state.usage.requests).toBe(2);
});
