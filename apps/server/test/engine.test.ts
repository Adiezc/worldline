// Engine tests against the offline MockProvider. The whole suite runs on the fixture seed and,
// when it exists and parses, again on the generated modern-2026 seed.

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  addDays, applyEvent, buildMapIndex, countryByTag, countryIndex, EffectSchema, newTurnContext, projectPace, projectStatus, provincesOf, relKey,
  splitChartBlocks,
  type Effect, type GameState, type MapMeta, type ScenarioSeed,
} from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import type { AiProvider, AiRequest, EngineDeps } from "../src/engine/api.ts";
import { engine, extractJson, INTERRUPTED } from "../src/engine/index.ts";
import { effectReference } from "../src/engine/prompts.ts";
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
  prompts: Partial<Record<AiRequest["kind"], string>> = {};
  override async complete(req: AiRequest) {
    this.kinds.push(req.kind);
    this.prompts[req.kind] = req.user;
    return super.complete(req);
  }
}

/** The mock's replies, except that every resolver reply is edited by `patch` first. */
class ScriptedProvider extends MockProvider {
  calls: AiRequest["kind"][] = [];
  constructor(private patch: (out: any) => void) {
    super();
  }
  override async complete(req: AiRequest) {
    this.calls.push(req.kind);
    const res = await super.complete(req);
    if (req.kind !== "resolver") return res;
    const out = JSON.parse(res.text);
    this.patch(out);
    return { ...res, text: JSON.stringify(out) };
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

test("the effect reference in the prompts matches the effect schema both ways", () => {
  const ref = effectReference(newGame(seeds[0][1]), 30);
  const examples = (ref.match(/\{"type":[^{}]*\}/g) ?? []).map((s) => JSON.parse(s) as { type: string });
  // Every example the model is shown must parse; an effect the schema dropped would be discarded.
  for (const e of examples) expect([e.type, EffectSchema.safeParse(e).success]).toEqual([e.type, true]);
  // And every effect the rules engine accepts is documented.
  const documented = new Set(examples.map((e) => e.type));
  expect(EffectSchema.options.map((o) => o.shape.type.value).filter((t) => !documented.has(t))).toEqual([]);
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

    test("the turn report gives each player nation's stats, land and relations at the start and end", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      const before = structuredClone(state);
      const res = await engine.runTurn(state, depsFor(seed));
      expect(res.nations.map((n) => n.tag)).toEqual(["UKR"]);
      const [n] = res.nations;
      const b = countryByTag(before, "UKR")!, a = countryByTag(state, "UKR")!;
      for (const k of ["gdp", "population", "stability", "military", "warExhaustion"] as const) expect(n.stats[k]).toEqual([b[k], a[k]]);
      const ukr = countryIndex(state, "UKR");
      const count = (s: GameState, f: (o: number, c: number) => boolean) => s.owners.filter((o, id) => id > 0 && f(o, s.controllers[id])).length;
      expect(n.regions.owned).toEqual([count(before, (o) => o === ukr), count(state, (o) => o === ukr)]);
      expect(n.regions.occupied).toEqual([count(before, (o, c) => o === ukr && c !== ukr), count(state, (o, c) => o === ukr && c !== ukr)]);
      expect(n.regions.occupying[1]).toBe(count(state, (o, c) => o !== ukr && c === ukr));
      const moves = n.relations.map((r) => Math.abs(r.to - r.from));
      expect(moves.every((m) => m >= 3)).toBe(true);
      expect(moves).toEqual([...moves].sort((x, y) => y - x));
      for (const r of n.relations) expect(r.to).toBe(state.relations[relKey("UKR", r.tag)] ?? 0);
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

    test("a player's IMF loan request is voted by stake and pays out", async () => {
      const state = newGame(seed, [["p1", "ARG"]]);
      const imf = state.organizations.find((o) => o.id === "imf")!;
      expect(imf.bodies.every((b) => b.rule === "weighted")).toBe(true);
      const res = engine.proposeResolution(state, { orgId: "imf", proposer: "ARG", resolutionType: "loan", target: "ARG", text: "Argentina requests a loan." });
      expect(res.ok).toBe(true);
      expect(res.message).toContain("Executive Board");
      // Not twice, and not on another player's behalf.
      expect(engine.proposeResolution(state, { orgId: "imf", proposer: "ARG", resolutionType: "loan", target: "ARG", text: "Again." }).ok).toBe(false);
      const r = state.resolutions.at(-1)!;
      expect(r).toMatchObject({ type: "loan", bodyId: "board", target: "ARG" });

      const turn = await engine.runTurn(state, depsFor(seed));
      expect(state.resolutions.find((x) => x.id === r.id)!.status).toBe("passed");
      expect(state.loans?.map((l) => l.borrower)).toEqual(["ARG"]);
      expect(turn.votes.find((v) => v.resolutionId === r.id)?.summary).toContain("of voting power in favour");
      const news = turn.events.find((e) => e.headline.includes("approves loan"));
      expect(news?.body).toContain("The IMF lends $");
      // The programme blocks a second loan until it ends.
      expect(engine.proposeResolution(state, { orgId: "imf", proposer: "ARG", resolutionType: "loan", target: "ARG", text: "More." }).message).toContain("programme running");
    });

    test("AI governments in crisis ask the IMF for a loan, voted next turn", async () => {
      const state = newGame(seed, [["p1", "USA"]]);
      const sick = state.countries.find((c) => c.tag === "PAK")!;
      sick.stability = 12;
      const turn = await engine.runTurn(state, depsFor(seed));
      const asks = state.resolutions.filter((r) => r.type === "loan" && r.status === "pending");
      expect(asks.length).toBeGreaterThan(0);
      expect(asks.length).toBeLessThanOrEqual(2);
      for (const r of asks) {
        expect(r.turn).toBe(state.turn);
        expect(r.target).toBe(r.proposer);
        expect(r.target).not.toBe("USA");
        expect(turn.events.some((e) => e.headline.includes(`asks the IMF`) && e.countries.includes(r.target!))).toBe(true);
      }
    });

    test("formation: an order proclaims the nation once its whole territory is held", async () => {
      const state = newGame(seed, [["p1", "DEU"]]);
      const aut = countryIndex(state, "AUT"), deu = countryIndex(state, "DEU");
      const autRegions = state.owners.flatMap((o, id) => (o === aut ? [id] : []));
      const deuRegions = state.owners.flatMap((o, id) => (o === deu ? [id] : []));
      const formable = {
        id: "danubia", name: "Danubian Union", concept: "A union of the German-speaking lands.", countries: ["DEU", "AUT"],
        provinces: [...deuRegions, ...autRegions], formers: ["DEU"], color: "#445566", flag: "gen:horizontal:#000000,#dd0000,#ffcc00",
      };
      const deps = depsFor({ ...seed, formables: [formable] });
      const order = { id: "o1", playerId: "p1", country: "DEU", text: "Proclaim the Danubian Union.", formable: "danubia" };

      // Without control of Austria the proclamation fails, and nothing changes.
      state.orders = { p1: [order] };
      let res = await engine.runTurn(state, deps);
      expect(res.verdicts.find((v) => v.orderId === "o1")?.outcome).toBe("fail");
      expect(countryByTag(state, "DEU")!.name).not.toBe("Danubian Union");

      for (const id of autRegions) state.controllers[id] = deu;
      state.orders = { p1: [order] };
      res = await engine.runTurn(state, deps);
      expect(res.verdicts.find((v) => v.orderId === "o1")?.outcome).toBe("success");
      expect(res.events.some((e) => e.headline.includes("Danubian Union") && (e.mapDiff?.length ?? 0) > 0)).toBe(true);
      expect(autRegions.every((id) => state.owners[id] === deu)).toBe(true);
      expect(countryByTag(state, "AUT")!.alive).toBe(false);
      expect(countryByTag(state, "DEU")).toMatchObject({ name: "Danubian Union", color: "#445566" });
      expect(state.formed).toEqual(["danubia"]);
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

    test("advisor replies carry at most one chart block, and only a valid one", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      const deps = depsFor(seed);
      let charts = 0;
      for (const question of ["", "How strong are our neighbours?", "Can we afford a war?", "Who are our friends?", "What next?", "Trade?"]) {
        const reply = await engine.advisor(state, deps, { country: "UKR", question });
        const parts = splitChartBlocks(reply);
        const n = parts.filter((p) => p.kind === "chart").length;
        expect(n).toBeLessThanOrEqual(1);
        expect(reply.split("```chart").length - 1).toBe(n);
        charts += n;
      }
      expect(charts).toBeGreaterThan(0);

      // A messy model reply: invalid and extra blocks are stripped, the first valid one kept compact.
      const valid = { type: "line", title: "Relations", labels: ["POL", "RUS"], series: [{ name: "Relation", values: [60, -90] }] };
      const messy: AiProvider = {
        name: "mock",
        quota: () => ({ usedToday: 0, dailyLimit: 0 }),
        complete: async () => ({
          text: `Intro.\n\n\`\`\`chart\n{"type":"pie"}\n\`\`\`\n\n\`\`\`chart\n${JSON.stringify(valid, null, 2).replace("]", ",]")}\n\`\`\`\n\nMore.\n\n\`\`\`chart\n${JSON.stringify(valid)}\n\`\`\``,
          usage: { model: "mock", promptTokens: 1, completionTokens: 1 },
        }),
      };
      const reply = await engine.advisor(state, depsFor(seed, messy), { country: "UKR" });
      expect(reply).toBe(`Intro.\n\n\`\`\`chart\n${JSON.stringify(valid)}\n\`\`\`\n\nMore.`);
    });

    test("intervene stops the last turn at its 2nd event", async () => {
      const state = newGame(seed, [["p1", "UKR"]]);
      state.orders = { p1: [
        { id: "o1", playerId: "p1", country: "UKR", text: "Reinforce air defences around Kyiv." },
        { id: "o2", playerId: "p1", country: "UKR", text: "Seek new EU financing for reconstruction." },
      ] };
      // What the room saves when it starts resolving a turn.
      const snapshot = structuredClone(state);
      const deps = depsFor(seed);
      const res = await engine.runTurn(state, deps);
      expect(res.events.length).toBeGreaterThan(3);
      const [first, second] = res.events;
      const cut = res.events.slice(2);

      const out = engine.intervene(state, deps, { snapshot, eventId: second.id });
      expect(out.cut).toBe(cut.length);
      expect(state.date).toBe(second.date);
      expect(state.turn).toBe(2);
      expect(state.phase).toBe("orders");
      // Later events are gone; the kept ones keep their ids and effects.
      expect(state.events.map((e) => e.id)).toEqual([...snapshot.events.map((e) => e.id), first.id, second.id]);
      expect(state.events.slice(-2).map((e) => e.effects)).toEqual([first.effects, second.effects]);
      // Map = snapshot + the kept events' diffs.
      const owners = [...snapshot.owners], controllers = [...snapshot.controllers];
      for (const e of [first, second]) for (const d of e.mapDiff ?? []) {
        owners[d.province] = d.owner;
        controllers[d.province] = d.controller;
      }
      expect(state.owners).toEqual(owners);
      expect(state.controllers).toEqual(controllers);
      // Orders whose events were cut are downgraded.
      const cutOrders = new Set(cut.flatMap((e) => e.causes));
      for (const v of state.lastVerdicts) {
        if (cutOrders.has(v.orderId)) expect(v).toMatchObject({ outcome: "partial", reason: INTERRUPTED });
      }
      expect(state.lastVerdicts.length).toBe(2);
      expectSaneStats(state);
      // The world goes on from there.
      const next = await engine.runTurn(state, deps);
      expect(next.fromDate).toBe(second.date);
    });

    test("intervene just before a front advance undoes the occupation", async () => {
      // Run turns until the mock pushes the front, then stop time one event earlier.
      const state = newGame(seed, [["p1", "FRA"]]);
      const deps = depsFor(seed);
      for (let i = 0; i < 12; i++) {
        const snapshot = structuredClone(state);
        const res = await engine.runTurn(state, deps);
        const at = res.events.findIndex((e) => e.mapDiff?.length);
        if (at < 1) continue;
        const advance = res.events[at];
        for (const d of advance.mapDiff!) expect(state.controllers[d.province]).toBe(d.controller);
        engine.intervene(state, deps, { snapshot, eventId: res.events[at - 1].id });
        for (const d of advance.mapDiff!) expect(state.controllers[d.province]).toBe(snapshot.controllers[d.province]);
        expect(state.events.at(-1)!.id).toBe(res.events[at - 1].id);
        return;
      }
      throw new Error("the mock never advanced a front");
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

describe("turn latency and long-game upkeep", () => {
  const seed = seeds[0][1];

  test("a Director plan computed while players write orders is used instead of a second planning call", async () => {
    const ai = new SpyProvider();
    const state = newGame(seed, [["p1", "FRA"]]);
    const pre = engine.planDirector(state, depsFor(seed, ai));
    await pre.plan;
    expect(ai.kinds).toEqual(["director"]);
    await engine.runTurn(state, { ...depsFor(seed, ai), directorPlan: pre });
    expect(ai.kinds.filter((k) => k === "director")).toHaveLength(1);
    expect(ai.kinds).toContain("resolver");
  });

  test("a stale plan (different jump length) is ignored and the turn plans live", async () => {
    const ai = new SpyProvider();
    const state = newGame(seed, [["p1", "FRA"]]);
    const pre = engine.planDirector(state, depsFor(seed, ai));
    state.settings.jumpDays = 90;
    await engine.runTurn(state, { ...depsFor(seed, ai), directorPlan: pre });
    expect(ai.kinds.filter((k) => k === "director")).toHaveLength(2);
  });

  test("the verdict history keeps every turn's verdicts with turn, date and order text", async () => {
    const state = newGame(seed, [["p1", "FRA"]]);
    for (let t = 0; t < 3; t++) {
      state.orders = { p1: [{ id: `o${t}`, playerId: "p1", country: "FRA", text: `Order number ${t}` }] };
      await engine.runTurn(state, depsFor(seed));
    }
    expect(state.verdictLog?.map((v) => [v.orderId, v.turn])).toEqual([["o0", 1], ["o1", 2], ["o2", 3]]);
    expect(state.verdictLog?.[1].text).toBe("Order number 1");
    expect(state.verdictLog?.[1].date).toBe("2026-01-31");
  });

  test("memory compaction folds old chronicles into one entry, with or without the AI", async () => {
    const { compactMemory } = await import("../src/engine/consolidate.ts");
    const fill = (state: GameState) => {
      state.memory = Array.from({ length: 8 }, (_, i) => ({ upToTurn: (i + 1) * 5, text: `Chronicle ${i + 1}. Many things happened in this stretch.` }));
    };
    const state = newGame(seed);
    fill(state);
    await compactMemory(state, depsFor(seed));
    expect(state.memory).toHaveLength(4);
    expect(state.memory[0].text.startsWith("Earlier history:")).toBe(true);
    expect(state.memory[0].upToTurn).toBe(25);
    expect(state.memory.at(-1)!.upToTurn).toBe(40);

    const offline = newGame(seed);
    fill(offline);
    await compactMemory(offline, depsFor(seed, failing));
    expect(offline.memory).toHaveLength(4);
    expect(offline.memory[0].text).toContain("Chronicle 1.");
  });
});

describe("peace treaties from diplomacy", () => {
  const seed = seeds[0][1];
  const occupiedBy = (state: GameState, owner: string, holder: string) => {
    const o = state.countries.findIndex((c) => c.tag === owner), h = state.countries.findIndex((c) => c.tag === holder);
    return state.owners.flatMap((ow, id) => (id > 0 && ow === o && state.controllers[id] === h ? [id] : []));
  };

  test("'keep what we hold' cedes exactly the occupied regions to the occupier", async () => {
    const state = newGame(seed, [["p1", "RUS"]]);
    const held = occupiedBy(state, "UKR", "RUS");
    expect(held.length).toBeGreaterThan(0);
    const chatId = engine.openChat(state, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "Let us end this.",
      proposal: { kind: "endWar", peace: "keep_occupied", members: ["RUS", "UKR"], terms: "Each side keeps what it holds." },
    });
    expect(state.wars.some((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))).toBe(false);
    const rus = state.countries.findIndex((c) => c.tag === "RUS");
    for (const id of held) expect(state.owners[id]).toBe(rus);
    expect(occupiedBy(state, "UKR", "RUS")).toHaveLength(0);
  });

  /** A Ukrainian-held region on the front (borders Russian-controlled land) and one far from it. */
  const demandTargets = (state: GameState) => {
    const map = depsFor(seed).map;
    const ukr = state.countries.findIndex((c) => c.tag === "UKR"), rus = state.countries.findIndex((c) => c.tag === "RUS");
    const free = state.owners.flatMap((o, id) => (id > 0 && o === ukr && state.controllers[id] === ukr ? [id] : []));
    const front = free.find((id) => map.neighbors[id].some((n) => state.controllers[n] === rus))!;
    const far = free.filter((id) => !map.coastal[id]).sort((a, b) => map.cx[a] - map.cx[b])[0];
    return { front, far, rus, ukr };
  };

  test("a named demand for unoccupied land passes when the enemy is near collapse", async () => {
    const state = newGame(seed, [["p1", "RUS"]]);
    const { front, rus } = demandTargets(state);
    state.countries.find((c) => c.tag === "UKR")!.warExhaustion = 75;
    const chatId = engine.openChat(state, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "Sign, or lose more.",
      proposal: {
        kind: "endWar", peace: "keep_occupied", members: ["RUS", "UKR"], terms: "Ukraine cedes the named region.",
        cessions: [{ from: "UKR", to: "RUS", provinces: [front] }],
      },
    });
    const p = state.chats[0].messages.find((m) => m.proposal)!.proposal!;
    expect(p.status).toBe("accepted");
    expect(state.owners[front]).toBe(rus);
    expect(state.wars.some((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))).toBe(false);
  });

  test("the same demand is refused while the enemy can still fight", async () => {
    const state = newGame(seed, [["p1", "RUS"]]);
    const { front, ukr } = demandTargets(state);
    state.countries.find((c) => c.tag === "UKR")!.warExhaustion = 30;
    const chatId = engine.openChat(state, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "Sign.",
      proposal: { kind: "endWar", peace: "white", members: ["RUS", "UKR"], terms: "Ukraine cedes the named region.", cessions: [{ from: "UKR", to: "RUS", provinces: [front] }] },
    });
    expect(state.chats[0].messages.find((m) => m.proposal)!.proposal!.status).toBe("rejected");
    expect(state.owners[front]).toBe(ukr);
  });

  test("a demand that would leave a region cut off is refused before it is sent", async () => {
    const state = newGame(seed, [["p1", "RUS"]]);
    const { far } = demandTargets(state);
    const chatId = engine.openChat(state, { from: "RUS", with: ["UKR"] });
    await expect(engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "",
      proposal: { kind: "endWar", peace: "white", members: ["RUS", "UKR"], terms: "x", cessions: [{ from: "UKR", to: "RUS", provinces: [far] }] },
    })).rejects.toThrow(/cut off/);
    expect(state.chats[0].messages).toHaveLength(0);
  });

  test("a proposal cannot bind a government that is not in the conversation", async () => {
    const state = newGame(seed, [["p1", "RUS"], ["p2", "UKR"]]);
    const before = state.owners.slice();
    const chatId = engine.openChat(state, { from: "RUS", with: ["POL"] });
    await expect(engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "",
      proposal: { kind: "endWar", peace: "keep_occupied", members: ["UKR"], terms: "Ukraine yields." },
    })).rejects.toThrow(/Ukraine is not part of this conversation/);
    expect(state.owners).toEqual(before);
    expect(state.wars.some((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))).toBe(true);
  });

  test("in a conference only the human parties to a deal must sign it", async () => {
    const state = newGame(seed, [["p1", "USA"], ["p2", "GBR"]]);
    state.relations[relKey("USA", "FRA")] = 60;
    const chatId = engine.openChat(state, { from: "USA", with: ["GBR", "FRA"] });
    // GBR is present but not a party: the deal with France goes through on France's word.
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "A bilateral pact, if Paris agrees.", speaker: "FRA",
      proposal: { kind: "treaty", treatyType: "trade", members: ["USA", "FRA"], terms: "Lower tariffs." },
    });
    const first = state.chats[0].messages.find((m) => m.proposal)!.proposal!;
    expect(first.awaiting).toEqual([]);
    expect(first.status).toBe("accepted");
    // A deal naming GBR waits for GBR.
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "And one with London.", speaker: "FRA",
      proposal: { kind: "treaty", treatyType: "defensive", members: ["USA", "GBR"], terms: "Mutual defence." },
    });
    const second = state.chats[0].messages.filter((m) => m.proposal).at(-1)!.proposal!;
    expect(second.awaiting).toEqual(["GBR"]);
    expect(second.status).toBe("open");
  });

  test("a white peace returns occupied land to its owner", async () => {
    const state = newGame(seed, [["p1", "UKR"]]);
    const held = occupiedBy(state, "UKR", "RUS");
    const chatId = engine.openChat(state, { from: "UKR", with: ["RUS"] });
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "We propose a ceasefire.",
      proposal: { kind: "endWar", peace: "white", members: ["UKR", "RUS"], terms: "White peace." },
    });
    const ukr = state.countries.findIndex((c) => c.tag === "UKR");
    for (const id of held) {
      expect(state.owners[id]).toBe(ukr);
      expect(state.controllers[id]).toBe(ukr);
    }
  });
});

describe("battle plans", () => {
  const seed = seeds[0][1];

  test("an offensive drawn on the map takes ground along its axis and its verdict keeps the plan", async () => {
    const state = newGame(seed, [["p1", "UKR"]]);
    const map = depsFor(seed).map;
    const ukr = state.countries.findIndex((c) => c.tag === "UKR"), rus = state.countries.findIndex((c) => c.tag === "RUS");
    // A Ukrainian-held region on the front and the Russian-held region across from it.
    const from = state.controllers.findIndex((c, id) => id > 0 && c === ukr && map.neighbors[id].some((n) => state.controllers[n] === rus));
    const target = map.neighbors[from].find((n) => state.controllers[n] === rus)!;
    const operation = { kind: "offensive" as const, regions: [from, target], stance: "allout" as const, name: "Operation Test" };
    state.orders = { p1: [{ id: "o1", playerId: "p1", country: "UKR", text: "Operation Test", operation }] };
    const res = await engine.runTurn(state, depsFor(seed));
    expect(state.controllers[target]).toBe(ukr);
    expect(res.verdicts.find((v) => v.orderId === "o1")?.operation).toEqual(operation);
  });
});

describe("diplomacy and turns", () => {
  const seed = seeds[0][1];

  test("what governments said in talks reaches the director and the resolver", async () => {
    const state = newGame(seed, [["p1", "UKR"]]);
    const chatId = engine.openChat(state, { from: "UKR", with: ["RUS"] });
    await engine.sendChat(state, depsFor(seed), {
      chatId, playerId: "p1", text: "We will never cede Kharkiv.",
      proposal: { kind: "endWar", peace: "white", members: ["UKR", "RUS"], terms: "White peace." },
    });
    const spy = new SpyProvider();
    await engine.runTurn(state, depsFor(seed, spy));
    for (const kind of ["director", "resolver"] as const) {
      expect(spy.prompts[kind]).toContain("DIPLOMACY");
      expect(spy.prompts[kind]).toContain("We will never cede Kharkiv.");
    }
    expect(spy.prompts.resolver).toMatch(/PROPOSAL peace treaty \(white peace\) among UKR, RUS: (ACCEPTED|REJECTED)/);
  });

  test("players' earlier orders and verdicts reach the next resolver, and each adviser sees only its own", async () => {
    const state = newGame(seed, [["p1", "FRA"], ["p2", "DEU"]]);
    state.orders = {
      p1: [{ id: "o1", playerId: "p1", country: "FRA", text: "Fund a new generation of nuclear reactors." }],
      p2: [{ id: "o2", playerId: "p2", country: "DEU", text: "Rebuild ammunition stocks." }],
    };
    await engine.runTurn(state, depsFor(seed));
    const spy = new SpyProvider();
    await engine.runTurn(state, depsFor(seed, spy));
    expect(spy.prompts.resolver).toMatch(/PLAYERS' EARLIER ORDERS[^\n]*\n(- .*\n)*- 2026-01-01 FRA: "Fund a new generation of nuclear reactors\." → (SUCCESS|PARTIAL|FAIL): \S/);
    expect(spy.prompts.resolver).toContain(`DEU: "Rebuild ammunition stocks." →`);
    await engine.advisor(state, depsFor(seed, spy), { country: "FRA" });
    expect(spy.prompts.advisor).toContain(`YOUR RECENT ORDERS (last 2 turns and how they went):\n- 2026-01-01 FRA: "Fund a new generation`);
    expect(spy.prompts.advisor).not.toContain(`DEU: "Rebuild ammunition stocks."`);
  });

  test("effects the rules refused are reported to the next turn's resolver", async () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    const region = provincesOf(state, "UKR")[0];
    await engine.runTurn(state, depsFor(seed, new ScriptedProvider((out) => {
      out.events.push({
        date: state.date, headline: "Kyiv hands a region to Moscow", body: "", countries: ["UKR", "RUS"], causes: [],
        effects: [{ type: "transferProvinces", provinces: [region], from: "UKR", to: "RUS" }],
      });
    })));
    expect(state.owners[region]).toBe(countryIndex(state, "UKR"));
    const spy = new SpyProvider();
    await engine.runTurn(state, depsFor(seed, spy));
    expect(spy.prompts.resolver).toContain("ENGINE RECEIPT");
    expect(spy.prompts.resolver).toMatch(/REFUSED in "Kyiv hands a region to Moscow": \{"type":"transferProvinces"/);
    // Only last turn's refusals: a quiet turn after that reports nothing.
    await engine.runTurn(state, depsFor(seed, spy));
    expect(spy.prompts.resolver).not.toContain('REFUSED in "Kyiv hands a region to Moscow"');
  });

  test("AI governments reach out to players unprompted, with a deal the player can accept", async () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    state.treaties = state.treaties.filter((t) => !(t.type === "trade" && t.members.includes("GBR") && t.members.includes("DEU")));
    await engine.runTurn(state, depsFor(seed, new ScriptedProvider((out) => {
      out.outreach = [
        { from: "DEU", to: "GBR", message: "Berlin would like to talk trade.", proposal: { kind: "treaty", treatyType: "free trade", members: ["DEU", "GBR", "FRA"], terms: "Zero tariffs." } },
        { from: "DEU", to: "GBR", message: "A second note from the same sender is dropped." },
        { from: "FRA", to: "RUS", message: "Not addressed to a player." },
        { from: "GBR", to: "DEU", message: "Players speak for themselves." },
      ];
    })));
    const chat = state.chats.find((c) => c.members.includes("DEU") && c.members.includes("GBR"))!;
    expect(chat.messages.length).toBe(1);
    const msg = chat.messages[0];
    expect(msg).toMatchObject({ from: "DEU", unprompted: true, text: "Berlin would like to talk trade." });
    expect(msg.proposal).toMatchObject({ kind: "treaty", treatyType: "trade", status: "open", awaiting: ["GBR"] });
    // A third country the model named never agreed to anything: the deal is between the two in the channel.
    expect(msg.proposal!.members).toEqual(["DEU", "GBR"]);
    expect(chat.lastTurn).toBe(state.turn);
    expect(state.chats.some((c) => c.members.includes("RUS"))).toBe(false);
    const r = engine.respondProposal(state, { chatId: chat.id, proposalId: msg.proposal!.id, byTag: "GBR", accept: true, map });
    expect(r.ok).toBe(true);
    expect(state.treaties.some((t) => t.type === "trade" && t.members.includes("GBR") && t.members.includes("DEU"))).toBe(true);
  });

  test("a malformed outreach message is dropped without failing the turn", async () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    const spy = new ScriptedProvider((out) => { out.outreach = [{ from: "DEU" }]; });
    await engine.runTurn(state, depsFor(seed, spy));
    expect(state.turn).toBe(2);
    expect(spy.calls.filter((k) => k === "resolver").length).toBe(1);
  });

  test("each AI reply keeps a running record of the talks, which later prompts carry", async () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    const chatId = engine.openChat(state, { from: "GBR", with: ["DEU"] });
    await engine.sendChat(state, depsFor(seed), { chatId, playerId: "p1", text: "Shall we talk?" });
    const chat = state.chats.find((c) => c.id === chatId)!;
    expect(chat.summary).toBeTruthy();
    const spy = new SpyProvider();
    await engine.sendChat(state, depsFor(seed, spy), { chatId, playerId: "p1", text: "As promised, here we are." });
    expect(spy.prompts.chat).toContain(`EARLIER IN THIS CONVERSATION (your running record):\n${chat.summary}`);
    // Long after the talks went quiet, the turn prompts still see the record.
    state.turn += 6;
    await engine.runTurn(state, depsFor(seed, spy));
    expect(spy.prompts.resolver).toContain("EARLIER TALKS (running records)");
    expect(spy.prompts.resolver).toContain(chat.summary!);
  });
});

describe("projects", () => {
  const seed = seeds[0][1];
  const event = (state: GameState, effects: Effect[], causes: string[] = []) =>
    ({ id: "x", turn: state.turn, date: state.date, headline: "h", body: "", countries: [], causes, effects, scope: "world" as const });

  test("an order launches a project that later turns advance, complete and report to the prompts", async () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    state.orders.p1 = [{ id: "o1", playerId: "p1", country: "GBR", text: "Build a national high-speed rail network" }];
    await engine.runTurn(state, depsFor(seed));
    // runTurn commits a fresh copy of the state, so look the project up again after each turn.
    const id = state.projects?.find((x) => x.country === "GBR")?.id;
    const project = () => state.projects!.find((x) => x.id === id)!;
    let p = project();
    expect(p).toMatchObject({ status: "active", progress: 0 });
    expect(state.events.find((e) => e.causes.includes("o1"))?.date).toBe(p!.started);
    expect(p!.milestones.length).toBe(3);
    const spy = new SpyProvider();
    await engine.runTurn(state, depsFor(seed, spy));
    expect(spy.prompts.resolver).toContain(`${p!.id} [GBR] "${p!.name}"`);
    await engine.advisor(state, depsFor(seed, spy), { country: "GBR" });
    expect(spy.prompts.advisor).toContain(`YOUR PROJECTS:\n${p!.id} [GBR]`);
    p = project();
    expect(p.progress).toBe(projectPace(state, 30));
    expect(p!.milestones[0].done).toBeTruthy();
    for (let i = 0; i < 10 && project().status === "active"; i++) await engine.runTurn(state, depsFor(seed));
    p = project();
    expect(p).toMatchObject({ status: "completed", progress: 100 });
    expect(p!.milestones.every((m) => m.done)).toBe(true);
  });

  test("the validator guards who starts projects, the pace of progress, and completion", () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    const ctx = newTurnContext(30, [{ id: "o1", country: "GBR" }]);
    const start = (country: string, name: string): Effect => ({ type: "startProject", country, name, goal: "", months: 12, milestones: [] });
    // A player's project needs the player's own order; AI nations start theirs freely, two a turn.
    let r = applyEvent(state, map, event(state, [start("GBR", "Rail")]), ctx);
    expect(r.rejected[0]?.reason).toMatch(/player-controlled/);
    r = applyEvent(state, map, event(state, [start("GBR", "Rail")], ["o1"]), ctx);
    expect(r.applied.length).toBe(1);
    r = applyEvent(state, map, event(state, [start("DEU", "A"), start("DEU", "B"), start("DEU", "C")]), ctx);
    expect(r.applied.length).toBe(2);
    expect(r.rejected[0]?.reason).toMatch(/at most 2 new projects/);
    const rail = state.projects!.find((p) => p.country === "GBR")!;
    expect(rail.due).toBe(addDays(state.date, 365));
    // Progress shares one allowance per project per turn; completion needs 80%.
    const pace = projectPace(state, 30);
    r = applyEvent(state, map, event(state, [{ type: "advanceProject", projectId: rail.id, progress: 90 }]), ctx);
    expect(rail.progress).toBe(pace);
    expect(r.clamped.length).toBe(1);
    applyEvent(state, map, event(state, [{ type: "advanceProject", projectId: rail.id, progress: 10 }]), ctx);
    expect(rail.progress).toBe(pace);
    r = applyEvent(state, map, event(state, [{ type: "endProject", projectId: rail.id, outcome: "completed" }]), ctx);
    expect(r.rejected[0]?.reason).toMatch(/completes from 80%/);
    r = applyEvent(state, map, event(state, [{ type: "endProject", projectId: rail.id, outcome: "abandoned" }]), ctx);
    expect(r.rejected[0]?.reason).toMatch(/only its own orders/);
    // Overdue is derived from the date, not stored.
    expect(projectStatus(rail, addDays(rail.due, 1))).toBe("overdue");
    expect(projectStatus(rail, addDays(rail.due, -10))).toBe("dueSoon");
  });

  test("a player abandons its own project at once, and only its own", () => {
    const state = newGame(seed, [["p1", "GBR"]]);
    const ctx = newTurnContext(30, [{ id: "o1", country: "GBR" }]);
    applyEvent(state, map, event(state, [{ type: "startProject", country: "GBR", name: "Rail", goal: "", months: 12, milestones: [] }], ["o1"]), ctx);
    const id = state.projects![0].id;
    expect(engine.abandonProject(state, { country: "DEU", projectId: id, map }).ok).toBe(false);
    expect(engine.abandonProject(state, { country: "GBR", projectId: id, map }).ok).toBe(true);
    expect(state.projects![0].status).toBe("abandoned");
    expect(state.events.at(-1)?.headline).toMatch(/abandons Rail/);
    expect(engine.abandonProject(state, { country: "GBR", projectId: id, map }).ok).toBe(false);
  });
});
