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
