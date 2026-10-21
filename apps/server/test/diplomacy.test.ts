// Diplomacy chat: no counter-offers after a signed deal, peace terms that keep the front, and AI
// governments answering a player's decision on their offers.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildMapIndex, countryIndex, type GameState, type MapMeta } from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import type { AiRequest } from "../src/engine/api.ts";
import { engine } from "../src/engine/index.ts";
import { buildFixtureSeed, ROOT } from "./fixtures/seed.ts";

const meta = (await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta;
const map = buildMapIndex(meta);
const seed = await buildFixtureSeed();

function game(country = "RUS") {
  const s = engine.createGame({ id: "g1", name: "Talks", seed });
  s.phase = "orders";
  s.players = [{ id: "p1", name: "p1", country, isHost: true, connected: true, ready: false }];
  return s;
}

/** The mock's chat replies, edited by `patch`. */
class ChatScript extends MockProvider {
  constructor(private patch: (out: Record<string, unknown>, req: AiRequest) => void) { super(); }
  override async complete(req: AiRequest) {
    const res = await super.complete(req);
    if (req.kind !== "chat") return res;
    const out = JSON.parse(res.text);
    this.patch(out, req);
    return { ...res, text: JSON.stringify(out) };
  }
}

const deps = (ai = new MockProvider()) => ({ map, seed, ai });
const lastMessage = (s: GameState, chatId: string) => s.chats.find((c) => c.id === chatId)!.messages.at(-1)!;

describe("deals in chat", () => {
  test("an AI that signs the player's deal makes no counter-offer, and never offers peace without a war", async () => {
    const s = game("GBR");
    s.treaties = s.treaties.filter((t) => !(t.type === "trade" && t.members.includes("GBR") && t.members.includes("DEU")));
    const chatId = engine.openChat(s, { from: "GBR", with: ["DEU"] });
    const counter = { kind: "endWar", peace: "white", members: ["DEU", "GBR"], terms: "Peace." };
    const ai = new ChatScript((out) => { out.acceptsPlayerProposal = true; out.proposal = counter; });
    await engine.sendChat(s, deps(ai), { chatId, playerId: "p1", text: "Trade?", proposal: { kind: "treaty", treatyType: "trade", members: ["GBR", "DEU"], terms: "Zero tariffs." } });
    const chat = s.chats.find((c) => c.id === chatId)!;
    expect(chat.messages[0].proposal?.status).toBe("accepted");
    expect(chat.messages[1].proposal).toBeUndefined();
    // Refused this time, the AI may counter, but a peace between countries at peace is dropped.
    await engine.sendChat(s, deps(new ChatScript((out) => { out.acceptsPlayerProposal = false; out.proposal = counter; })), {
      chatId, playerId: "p1", text: "Alliance?", proposal: { kind: "treaty", treatyType: "alliance", members: ["GBR", "DEU"], terms: "Mutual defence." },
    });
    expect(lastMessage(s, chatId).proposal).toBeUndefined();
  });

  test("a peace that names regions keeps the front where it stands, so occupied land is not handed back", async () => {
    const s = game();
    const rus = countryIndex(s, "RUS"), ukr = countryIndex(s, "UKR");
    s.countries[ukr].warExhaustion = 70;
    const occupied = [...Array(map.count + 1).keys()].filter((id) => id > 0 && s.owners[id] === ukr && s.controllers[id] === rus);
    expect(occupied.length).toBeGreaterThan(0);
    // An unoccupied region next to land Russia holds.
    const named = [...Array(map.count + 1).keys()].find((id) => id > 0 && s.owners[id] === ukr && s.controllers[id] === ukr && map.neighbors[id].some((n) => s.controllers[n] === rus))!;
    const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(s, deps(), {
      chatId, playerId: "p1", text: "Sign.",
      proposal: { kind: "endWar", peace: "white", members: ["RUS", "UKR"], terms: "Ukraine cedes the region.", cessions: [{ from: "UKR", to: "RUS", provinces: [named] }] },
    });
    const p = s.chats.find((c) => c.id === chatId)!.messages[0].proposal!;
    expect(p).toMatchObject({ status: "accepted", peace: "keep_occupied" });
    expect(s.owners[named]).toBe(rus);
    for (const id of occupied) expect(s.owners[id]).toBe(rus);
  });
});

describe("unconditional surrender", () => {
  const demand = { kind: "endWar" as const, peace: "surrender" as const, members: ["RUS", "UKR"], terms: "Surrender unconditionally." };
  const ukrLand = (s: GameState) => [...Array(map.count + 1).keys()].filter((id) => id > 0 && s.owners[id] === countryIndex(s, "UKR"));

  test("a collapsing state must sign, and is annexed whole by the winner", async () => {
    const s = game();
    s.countries[countryIndex(s, "UKR")].warExhaustion = 100;
    const land = ukrLand(s);
    const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
    // The model would refuse; collapse decides it.
    await engine.sendChat(s, deps(new ChatScript((out) => { out.acceptsPlayerProposal = false; })), { chatId, playerId: "p1", text: "", proposal: demand });
    const p = s.chats.find((c) => c.id === chatId)!.messages[0].proposal!;
    expect(p).toMatchObject({ status: "accepted", peace: "surrender", surrender: { from: "UKR", to: "RUS" } });
    expect(s.countries[countryIndex(s, "UKR")].alive).toBe(false);
    for (const id of land) expect(s.owners[id]).toBe(countryIndex(s, "RUS"));
    expect(s.wars.some((w) => w.attackers.includes("RUS") && w.defenders.includes("UKR"))).toBe(false);
  });

  test("a state still able to fight refuses, and nothing changes", async () => {
    const s = game();
    const land = ukrLand(s);
    const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
    await engine.sendChat(s, deps(), { chatId, playerId: "p1", text: "", proposal: demand });
    expect(s.chats.find((c) => c.id === chatId)!.messages[0].proposal?.status).toBe("rejected");
    expect(ukrLand(s)).toEqual(land);
  });

  test("an AI may offer its own surrender, never demand a player's", async () => {
    const s = game();
    const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
    const ai = new ChatScript((out) => { out.proposal = { kind: "endWar", peace: "surrender", members: ["UKR", "RUS"], terms: "We lay down our arms." }; });
    await engine.sendChat(s, deps(ai), { chatId, playerId: "p1", text: "Give up." });
    const offer = lastMessage(s, chatId).proposal!;
    expect(offer.surrender).toEqual({ from: "UKR", to: "RUS" });
    engine.respondProposal(s, { chatId, proposalId: offer.id, byTag: "RUS", accept: true, map });
    expect(s.countries[countryIndex(s, "UKR")].alive).toBe(false);

    // Russia is a player: Ukraine's government cannot be handed Russia's surrender to sign.
    const t = game("UKR");
    const id2 = engine.openChat(t, { from: "UKR", with: ["RUS"] });
    await expect(engine.sendChat(t, deps(), { chatId: id2, playerId: "p1", text: "", proposal: { ...demand, members: ["UKR", "RUS"], surrender: { from: "UKR", to: "RUS" } } }))
      .rejects.toThrow(/cannot be surrendered/);
  });
});

describe("answers to decisions", () => {
  test("the AI that made an offer answers when the player accepts or rejects it", async () => {
    const s = game("GBR");
    const chatId = engine.openChat(s, { from: "DEU", with: ["GBR"] });
    const chat = s.chats.find((c) => c.id === chatId)!;
    const offer = (id: string) => ({
      id: "m" + id, from: "DEU", text: "An offer.", at: s.date,
      proposal: { id, kind: "treaty" as const, treatyType: "trade" as const, members: ["DEU", "GBR"], terms: "Zero tariffs.", status: "open" as const, awaiting: ["GBR"] },
    });
    chat.messages.push(offer("pa"));
    engine.respondProposal(s, { chatId, proposalId: "pa", byTag: "GBR", accept: true, map });
    expect(await engine.reactToDecision(s, deps(), { chatId, proposalId: "pa", byTag: "GBR" })).toBe(true);
    expect(lastMessage(s, chatId)).toMatchObject({ from: "DEU", text: expect.stringMatching(/welcomes the agreement/) });

    chat.messages.push(offer("pb"));
    engine.respondProposal(s, { chatId, proposalId: "pb", byTag: "GBR", accept: false, map });
    await engine.reactToDecision(s, deps(), { chatId, proposalId: "pb", byTag: "GBR" });
    expect(lastMessage(s, chatId)).toMatchObject({ from: "DEU", text: expect.stringMatching(/regrets/) });
  });

  test("refusals do not loop: the same deal is never re-offered, and counters stop after two refusals", async () => {
    const s = game();
    // An AI that answers every refusal with a peace of the given type, as Ukraine did in a real game.
    let peace = "keep_occupied";
    const ai = new ChatScript((out) => { out.proposal = { kind: "endWar", peace, members: ["UKR", "RUS"], terms: "A ceasefire." }; });
    const talks = () => {
      const chatId = engine.openChat(s, { from: "RUS", with: ["UKR"] });
      const chat = s.chats.find((c) => c.id === chatId)!;
      chat.messages.push({
        id: `m${chatId}`, from: "UKR", text: "Freeze the front.", at: s.date,
        proposal: { id: `p${chatId}`, kind: "endWar", peace: "keep_occupied", members: ["UKR", "RUS"], terms: "A ceasefire.", status: "open", awaiting: ["RUS"] },
      });
      const refuseLast = async () => {
        const p = chat.messages.filter((m) => m.proposal?.status === "open").at(-1)!.proposal!;
        engine.respondProposal(s, { chatId, proposalId: p.id, byTag: "RUS", accept: false, map });
        await engine.reactToDecision(s, deps(ai), { chatId, proposalId: p.id, byTag: "RUS" });
        return lastMessage(s, chatId).proposal;
      };
      return { chat, refuseLast };
    };

    // Re-offering the deal just refused is no counter at all.
    expect(await talks().refuseLast()).toBeUndefined();

    // A different deal is a real counter; once that is refused too, the AI waits for the player's terms.
    s.chats = [];
    const { chat, refuseLast } = talks();
    peace = "white";
    expect(await refuseLast()).toMatchObject({ peace: "white", status: "open" });
    peace = "keep_occupied";
    expect(await refuseLast()).toBeUndefined();
    expect(chat.messages.filter((m) => m.proposal?.status === "open")).toHaveLength(0);
  });

  test("nobody answers a player's own proposal, or one still open", async () => {
    const s = game("GBR");
    const chatId = engine.openChat(s, { from: "GBR", with: ["DEU"] });
    s.chats.find((c) => c.id === chatId)!.messages.push({
      id: "m1", from: "GBR", playerId: "p1", text: "", at: s.date,
      proposal: { id: "px", kind: "custom", members: ["GBR", "DEU"], terms: "Talks.", status: "accepted", awaiting: [] },
    });
    expect(await engine.reactToDecision(s, deps(), { chatId, proposalId: "px", byTag: "GBR" })).toBe(false);
    expect(await engine.reactToDecision(s, deps(), { chatId, proposalId: "nope", byTag: "GBR" })).toBe(false);
  });
});
