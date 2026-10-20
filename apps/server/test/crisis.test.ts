// Nuclear use, collapsing governments and surrender, on the fixture seed with the offline mock.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  applyEvent, buildMapIndex, countryByTag, countryIndex, getRelation, newTurnContext, simTick, STRIKE,
  type Effect, type GameState, type MapMeta,
} from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import type { AiRequest } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";
import { buildFixtureSeed, ROOT } from "./fixtures/seed.ts";

const meta = (await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta;
const map = buildMapIndex(meta);
const seed = await buildFixtureSeed();
const deps = (ai = new MockProvider()) => ({ map, seed, ai });

function game(players: [string, string][] = [["p1", "RUS"]]) {
  const s = engine.createGame({ id: "g1", name: "Crisis", seed });
  s.phase = "orders";
  s.players = players.map(([id, country], i) => ({ id, name: id, country, isHost: i === 0, connected: true, ready: false }));
  return s;
}
const event = (s: GameState, effects: Effect[], causes: string[] = []) =>
  ({ id: "x", turn: s.turn, date: s.date, headline: "h", body: "", countries: [], causes, effects, scope: "world" as const });
const strike = (scale: "tactical" | "strategic", target = "UKR", by = "RUS"): Effect => ({ type: "nuclearStrike", by, target, scale });

/** Records prompts by kind, and can make every AI delegation refuse proposals. */
class Spy extends MockProvider {
  prompts: Partial<Record<AiRequest["kind"], string>> = {};
  constructor(private refuse = false) { super(); }
  override async complete(req: AiRequest) {
    this.prompts[req.kind] = req.user;
    const res = await super.complete(req);
    if (!this.refuse || req.kind !== "chat") return res;
    return { ...res, text: JSON.stringify({ ...JSON.parse(res.text), acceptsPlayerProposal: false }) };
  }
}

describe("nuclear strikes", () => {
  test("the engine, not the model, decides what a strike costs and how the world reacts", () => {
    const s = game();
    const ukr = countryByTag(s, "UKR")!, rus = countryByTag(s, "RUS")!;
    const before = { pop: ukr.population, gdp: ukr.gdp, stab: ukr.stability, rusStab: rus.stability, usa: getRelation(s, "RUS", "USA"), sanctions: s.sanctions.length };
    const ctx = newTurnContext(30, [{ id: "o1", country: "RUS" }]);
    const ev = event(s, [strike("strategic")], ["o1"]);
    applyEvent(s, map, ev, ctx);
    expect(ev.effects).toHaveLength(1);
    const onCapital = ukr.capital?.province === (ev.effects[0] as { province: number }).province;
    const k = onCapital ? 1.8 : 1;
    expect(ukr.population).toBeCloseTo(before.pop * (1 - (STRIKE.strategic.pop * k) / 100), 1);
    expect(ukr.gdp).toBeLessThan(before.gdp * 0.95);
    expect(ukr.stability).toBeLessThanOrEqual(before.stab - 18);
    expect(rus.stability).toBe(Math.round((before.rusStab - 12) * 100) / 100);
    expect(getRelation(s, "RUS", "USA")).toBeLessThan(before.usa - 20);
    expect(getRelation(s, "RUS", "UKR")).toBe(-100);
    expect(s.sanctions.length).toBe(before.sanctions + 1);
    expect(s.sanctions.at(-1)?.source).toMatch(/Nuclear use against Ukraine/);
    expect(s.nuclearStrikes).toHaveLength(1);
    expect(ev.body).toMatch(/Ukraine loses .*% of its population/);
  });

  test("strikes need a nuclear power, a war and, for a player, its own order; two a turn at most", () => {
    const s = game();
    const ctx = newTurnContext(30, [{ id: "o1", country: "RUS" }]);
    const reasons = (effects: Effect[], causes: string[] = ["o1"]) => applyEvent(s, map, event(s, effects, causes), ctx).rejected.map((r) => r.reason);
    expect(reasons([strike("tactical")], [])[0]).toMatch(/player-controlled/);
    expect(reasons([strike("tactical", "UKR", "DEU")])[0]).toMatch(/no nuclear weapons/);
    expect(reasons([strike("tactical", "POL")])[0]).toMatch(/not at war/);
    expect(reasons([strike("tactical"), strike("tactical"), strike("tactical")])[0]).toMatch(/at most 2 nuclear strikes/);
  });

  test("repeat use hits harder, and fallout keeps dragging the economy afterwards", () => {
    const s = game();
    const ctx = () => newTurnContext(30, [{ id: "o1", country: "RUS" }]);
    const drop = () => {
      const before = getRelation(s, "RUS", "BRA");
      applyEvent(s, map, event(s, [strike("tactical")], ["o1"]), ctx());
      return before - getRelation(s, "RUS", "BRA");
    };
    const first = drop(), second = drop();
    expect(second).toBeGreaterThan(first);

    const clean = game();
    for (const x of [s, clean]) countryByTag(x, "UKR")!.gdp = 200;
    simTick(s, 30);
    simTick(clean, 30);
    expect(countryByTag(s, "UKR")!.gdp).toBeLessThan(countryByTag(clean, "UKR")!.gdp);
  });

  test("a player's nuclear order becomes a strike through the turn", async () => {
    const s = game();
    s.orders.p1 = [{ id: "o1", playerId: "p1", country: "RUS", text: "Use a tactical nuclear weapon on the Ukrainian front" }];
    const pop = countryByTag(s, "UKR")!.population;
    await engine.runTurn(s, deps());
    expect(s.nuclearStrikes).toHaveLength(1);
    expect(s.nuclearStrikes![0]).toMatchObject({ by: "RUS", target: "UKR", scale: "tactical" });
    expect(countryByTag(s, "UKR")!.population).toBeLessThan(pop);
    // The next turn's prompt remembers it.
    const spy = new Spy();
    await engine.runTurn(s, deps(spy));
    expect(spy.prompts.resolver).toContain("NUCLEAR USE SO FAR (1 detonation");
  });
});

describe("collapse", () => {
  test("a government at rock bottom falls, costs the country, and the next turn names a successor", async () => {
    const s = game([["p1", "GBR"]]);
    const deu = countryByTag(s, "DEU")!;
    deu.stability = 2;
    const mil = deu.military;
    await engine.runTurn(s, deps());
    const fell = s.events.find((e) => e.headline === "Government of Germany collapses");
    expect(fell).toBeTruthy();
    expect(countryByTag(s, "DEU")).toMatchObject({ leader: "Caretaker government", stability: 22, collapsedTurn: 1 });
    expect(countryByTag(s, "DEU")!.military).toBeLessThan(mil);
    expect(s.successions).toEqual([expect.objectContaining({ country: "DEU" })]);

    const spy = new Spy();
    await engine.runTurn(s, deps(spy));
    expect(spy.prompts.resolver).toContain("GOVERNMENT CRISES");
    expect(spy.prompts.resolver).toMatch(/- DEU Germany: .* fell/);
    // Naming the successor closes the crisis.
    applyEvent(s, map, event(s, [{ type: "changeLeader", country: "DEU", leader: "Jane Doe (Chancellor)" }]), newTurnContext(30, []));
    expect(s.successions).toEqual([]);
    // No second collapse straight away, even if stability drops again.
    countryByTag(s, "DEU")!.stability = 1;
    await engine.runTurn(s, deps());
    expect(s.events.filter((e) => e.headline === "Government of Germany collapses")).toHaveLength(1);
  });
});

describe("surrender", () => {
  function broken() {
    const s = game();
    const ukr = countryByTag(s, "UKR")!;
    ukr.warExhaustion = 98;
    ukr.stability = 30; // above the collapse line, so only the war gives way
    return s;
  }

  test("a collapsing AI nation asks the player for terms, and asks again after two turns", async () => {
    const s = broken();
    await engine.runTurn(s, deps());
    const chat = () => s.chats.find((c) => c.members.includes("RUS") && c.members.includes("UKR"))!;
    const offers = () => chat().messages.filter((m) => m.from === "UKR" && m.unprompted && m.proposal?.kind === "endWar");
    expect(offers()).toHaveLength(1);
    expect(offers()[0].proposal).toMatchObject({ peace: "keep_occupied", status: "open", awaiting: ["RUS"] });
    // While it stays open, no duplicate; once refused, it comes back after two turns.
    countryByTag(s, "UKR")!.warExhaustion = 98;
    await engine.runTurn(s, deps());
    expect(offers()).toHaveLength(1);
    engine.respondProposal(s, { chatId: chat().id, proposalId: offers()[0].proposal!.id, byTag: "RUS", accept: false, map });
    for (let i = 0; i < 2; i++) {
      countryByTag(s, "UKR")!.warExhaustion = 98;
      await engine.runTurn(s, deps());
    }
    expect(offers().length).toBe(2);
  });

  test("a collapsing nation signs the winner's terms even when its envoy would refuse", async () => {
    const s = broken();
    const ukr = countryIndex(s, "UKR"), rus = countryIndex(s, "RUS");
    // An unoccupied Ukrainian region next to land Russia holds: a demand it would normally refuse.
    const region = [...Array(map.count + 1).keys()].find((id) => id > 0 && s.owners[id] === ukr && s.controllers[id] === ukr && map.neighbors[id].some((n) => s.controllers[n] === rus))!;
    const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(s, deps(new Spy(true)), {
      chatId, playerId: "p1", text: "Sign.",
      proposal: { kind: "endWar", peace: "keep_occupied", members: ["RUS", "UKR"], terms: "Ukraine cedes the named region.", cessions: [{ from: "UKR", to: "RUS", provinces: [region] }] },
    });
    expect(s.chats.find((c) => c.id === chatId)!.messages[0].proposal?.status).toBe("accepted");
    expect(s.owners[region]).toBe(rus);
    expect(s.wars.some((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))).toBe(false);
  });
});
