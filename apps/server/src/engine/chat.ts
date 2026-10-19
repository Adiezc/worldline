// Diplomacy chats. One AI member answers each human message; agreed proposals take effect at
// once through the validator, with the chat standing in for a player order.

import {
  applyEvent, atWar, ChatOutputSchema, countryByTag, getRelation, humanTags, newTurnContext, nextId, relKey,
  type Chat, type ChatMessage, type Effect, type GameEvent, type GameState, type MapIndex, type Proposal,
  type ProposalDraft, type TreatyType,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { countryDetail, nameOf, orgsOf, recentEventsBlock, relationList, treatiesBlock } from "./context.ts";
import { makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { chatSystem } from "./prompts.ts";

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function openChat(state: GameState, opts: { from: string; with: string[] }): string {
  const members = [...new Set([opts.from, ...opts.with])].filter((t) => countryByTag(state, t)?.alive);
  if (members.length < 2) throw new Error("A chat needs at least two existing countries.");
  const existing = state.chats.find((c) => sameSet(c.members, members));
  if (existing) return existing.id;
  const chat: Chat = { id: nextId(state, "c"), members, messages: [], lastTurn: state.turn };
  state.chats.push(chat);
  return chat.id;
}

export async function sendChat(
  state: GameState, deps: EngineDeps, opts: { chatId: string; playerId: string; text: string; proposal?: ProposalDraft },
): Promise<void> {
  const chat = state.chats.find((c) => c.id === opts.chatId);
  if (!chat) throw new Error("No such chat.");
  const from = state.players.find((p) => p.id === opts.playerId)?.country;
  if (!from || !chat.members.includes(from)) throw new Error("You are not part of this chat.");
  const text = opts.text.trim().slice(0, 2000);
  if (!text && !opts.proposal) throw new Error("Empty message.");

  const humans = humanTags(state);
  const proposal = opts.proposal ? draftToProposal(state, chat, from, opts.proposal) : undefined;
  const msg: ChatMessage = { id: nextId(state, "m"), from, playerId: opts.playerId, text, at: state.date, proposal };
  const ai = chat.members.filter((m) => !humans.has(m) && countryByTag(state, m)?.alive);
  if (!ai.length) {
    chat.messages.push(msg);
    chat.lastTurn = state.turn;
    return;
  }

  // The AI reply is fetched before anything is committed, so a failed call changes nothing.
  const speaker = pickSpeaker(state, chat, text, proposal, ai);
  const out = await callJson(deps, state, {
    kind: "chat",
    schemaName: "ChatOutput",
    system: chatSystem(nameOf(state, speaker), speaker),
    user: chatPrompt(state, chat, speaker, from, [...chat.messages, msg]),
    maxTokens: 1500,
    temperature: 0.8,
    mockContext: {
      speaker, speakerName: nameOf(state, speaker), player: from, playerName: nameOf(state, from),
      relation: getRelation(state, speaker, from), hasProposal: !!proposal, proposalMembers: proposal?.members ?? [], text,
    },
  }, ChatOutputSchema);

  chat.messages.push(msg);

  if (proposal) {
    const aiParties = proposal.members.filter((m) => !humans.has(m));
    const agrees = (t: string) => (t === speaker ? out.acceptsPlayerProposal === true : aiWouldAccept(state, t, proposal, humans));
    if (!aiParties.every(agrees)) proposal.status = "rejected";
    else if (!proposal.awaiting.length) {
      const res = applyProposal(state, deps.map, chat, proposal);
      proposal.status = res.ok ? "accepted" : "rejected";
      if (!res.ok) console.warn(`[chat] accepted proposal rejected by rules: ${res.message}`);
    }
  }

  const delta = Math.max(-5, Math.min(5, Math.round(out.relationDelta)));
  if (delta) state.relations[relKey(speaker, from)] = Math.max(-100, Math.min(100, getRelation(state, speaker, from) + delta));

  const reply: ChatMessage = { id: nextId(state, "m"), from: speaker, text: out.reply.trim(), at: state.date };
  if (out.proposal) {
    const members = [...new Set(out.proposal.members)].filter((t) => countryByTag(state, t)?.alive);
    if (!members.includes(speaker)) members.unshift(speaker);
    const humanMembers = chat.members.filter((m) => humans.has(m));
    const awaiting = humanMembers.filter((m) => members.includes(m));
    if (members.length >= 2) {
      reply.proposal = {
        id: nextId(state, "p"), kind: out.proposal.kind, treatyType: out.proposal.treatyType, members,
        terms: out.proposal.terms, status: "open", awaiting: awaiting.length ? awaiting : humanMembers,
      };
    }
  }
  chat.messages.push(reply);
  chat.lastTurn = state.turn;
}

export function respondProposal(
  state: GameState, opts: { chatId: string; proposalId: string; byTag: string; accept: boolean },
): { ok: boolean; message: string } {
  const chat = state.chats.find((c) => c.id === opts.chatId);
  const p = chat?.messages.find((m) => m.proposal?.id === opts.proposalId)?.proposal;
  if (!chat || !p) return { ok: false, message: "No such proposal." };
  if (p.status !== "open") return { ok: false, message: `This proposal was already ${p.status}.` };
  if (!p.awaiting.includes(opts.byTag)) return { ok: false, message: "This proposal is not waiting for your answer." };
  if (!opts.accept) {
    p.status = "rejected";
    p.awaiting = [];
    return { ok: true, message: "Proposal rejected." };
  }
  p.awaiting = p.awaiting.filter((t) => t !== opts.byTag);
  if (p.awaiting.length) return { ok: true, message: `Accepted; still waiting for ${p.awaiting.join(", ")}.` };
  // The contract gives no map here; only makePeace touches it, and only for its province count.
  const res = applyProposal(state, stubMap(state), chat, p);
  p.status = res.ok ? "accepted" : "rejected";
  return res;
}

// ---- helpers ----

function draftToProposal(state: GameState, chat: Chat, from: string, d: ProposalDraft): Proposal {
  const humans = humanTags(state);
  const members = [...new Set([from, ...d.members])].filter((t) => countryByTag(state, t)?.alive);
  if (members.length < 2) throw new Error("A proposal needs at least two parties.");
  return {
    id: nextId(state, "p"), kind: d.kind, treatyType: d.kind === "treaty" ? d.treatyType ?? "nonaggression" : d.treatyType,
    members, terms: d.terms.trim().slice(0, 1000), status: "open",
    awaiting: chat.members.filter((m) => m !== from && humans.has(m)),
  };
}

/** Non-speaking AI parties in group chats accept on goodwill: friendly and not at war with a party. */
function aiWouldAccept(state: GameState, tag: string, p: Proposal, humans: Set<string>) {
  const others = p.members.filter((m) => m !== tag);
  const friendly = others.filter((m) => humans.has(m)).every((m) => getRelation(state, tag, m) >= 20);
  return friendly && (p.kind === "endWar" || !others.some((m) => atWar(state, tag, m)));
}

/** The AI member most relevant to the message: named in it, party to the proposal, then the biggest. */
function pickSpeaker(state: GameState, chat: Chat, text: string, p: Proposal | undefined, ai: string[]) {
  if (ai.length === 1) return ai[0];
  const lower = text.toLowerCase();
  const lastAi = [...chat.messages].reverse().find((m) => ai.includes(m.from))?.from;
  const score = (t: string) => {
    const k = countryByTag(state, t)!;
    let s = Math.log10(1 + k.gdp);
    if (new RegExp(`\\b${t}\\b`).test(text) || lower.includes(k.name.toLowerCase())) s += 100;
    if (p?.members.includes(t)) s += 50;
    if (t === lastAi) s += 5;
    return s;
  };
  return [...ai].sort((a, b) => score(b) - score(a))[0];
}

function chatPrompt(state: GameState, chat: Chat, speaker: string, from: string, history: ChatMessage[]) {
  const humans = humanTags(state);
  const me = countryByTag(state, speaker)!, them = countryByTag(state, from)!;
  const focus = new Set([speaker, from]);
  const others = chat.members.filter((m) => m !== speaker);
  const wars = state.wars.filter((w) => [...w.attackers, ...w.defenders].some((t) => focus.has(t)))
    .map((w) => `${w.id} "${w.name}": ${w.attackers.join(", ")} vs ${w.defenders.join(", ")}`);
  const sanctions = state.sanctions.filter((s) => focus.has(s.target) || s.by.some((t) => focus.has(t)))
    .map((s) => `${s.target} sanctioned by ${s.by.slice(0, 8).join(", ")}${s.by.length > 8 ? "…" : ""}`);
  const shared = orgsOf(state, speaker).filter((o) => orgsOf(state, from).includes(o));
  const lines = history.slice(-14).map((m) => {
    let s = `[${m.from}] ${m.text}`;
    if (m.proposal) {
      const p = m.proposal;
      s += `\n  PROPOSAL (${p.status}): ${p.kind}${p.treatyType ? ` (${p.treatyType})` : ""} between ${p.members.join(", ")}; terms: ${p.terms}`;
    }
    return s;
  });
  return [
    `DATE: ${state.date}`,
    `YOU: ${countryDetail(state, me, humans)}`,
    `SPEAKING WITH: ${others.map((t) => countryDetail(state, countryByTag(state, t)!, humans)).join("\n")}`,
    `YOUR RELATIONS (-100..100): ${relationList(state, speaker, others)}${shared.length ? `; shared memberships: ${shared.join(" ")}` : ""}`,
    treatiesBlock(state, focus, 15),
    wars.length ? `WARS:\n${wars.join("\n")}` : "",
    sanctions.length ? `SANCTIONS:\n${sanctions.join("\n")}` : "",
    recentEventsBlock(state, { involving: focus, max: 12 }),
    `CONVERSATION (latest last):\n${lines.join("\n")}`,
    `TASK: Reply as ${me.name} to ${them.name}'s last message.${history.at(-1)?.proposal ? " It contains a PROPOSAL: set acceptsPlayerProposal." : ""}`,
  ].filter(Boolean).join("\n\n");
}

const TREATY_LABEL: Record<TreatyType, string> = {
  alliance: "an alliance", defensive: "a mutual defence pact", trade: "a trade agreement",
  nonaggression: "a non-aggression pact", customs_union: "a customs union", vassal: "a protectorate agreement",
};

/** Turn an agreed proposal into an effect and apply it as a player event. */
export function applyProposal(state: GameState, map: MapIndex, chat: Chat, p: Proposal): { ok: boolean; message: string; event?: GameEvent } {
  const humans = humanTags(state);
  const names = p.members.map((t) => nameOf(state, t));
  const joined = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join(" and ");
  let effect: Effect | undefined;
  let headline = `${joined} reach an agreement`;

  switch (p.kind) {
    case "treaty": {
      const treatyType = p.treatyType ?? "nonaggression";
      effect = { type: "createTreaty", treatyType, members: p.members };
      headline = `${joined} sign ${TREATY_LABEL[treatyType]}`;
      break;
    }
    case "endWar": {
      const war = state.wars.find((w) =>
        p.members.some((a) => w.attackers.includes(a)) && p.members.some((d) => w.defenders.includes(d)));
      if (!war) return { ok: false, message: "There is no war between these parties." };
      effect = { type: "makePeace", warId: war.id, terms: p.terms };
      headline = `${joined} agree to end the ${war.name}`;
      break;
    }
    case "joinOrg": {
      const terms = p.terms.toLowerCase();
      const org = state.organizations.find((o) =>
        new RegExp(`\\b${escapeRe(o.abbrev.toLowerCase())}\\b`).test(terms) || terms.includes(o.name.toLowerCase()))
        ?? state.organizations.find((o) => p.members.some((m) => o.members.includes(m)) && p.members.some((m) => !o.members.includes(m)) && o.kind !== "global");
      const joiner = org && p.members.find((m) => !org.members.includes(m));
      if (!org || !joiner) return { ok: false, message: "Could not tell which organisation to join." };
      effect = org.powers.includes("admitMember")
        ? { type: "applyToOrg", orgId: org.id, country: joiner }
        : { type: "joinOrg", orgId: org.id, country: joiner };
      headline = org.powers.includes("admitMember")
        ? `${nameOf(state, joiner)} applies to join the ${org.abbrev} with backing from ${names.filter((n) => n !== nameOf(state, joiner)).join(", ")}`
        : `${nameOf(state, joiner)} joins the ${org.abbrev}`;
      break;
    }
    case "custom":
      break;
  }

  // Each consenting human party gets its own cause id so the validator sees all of them agreeing.
  const parties = p.members.filter((m) => humans.has(m));
  const causes = parties.map((h, i) => (i === 0 ? `chat:${chat.id}` : `chat:${chat.id}#${h}`));
  const ctx = newTurnContext(30, parties.map((h, i) => ({ id: causes[i], country: h })));
  const ev = makeEvent(state, {
    date: state.date, headline, body: p.terms, countries: p.members, causes: causes.length ? causes : [`chat:${chat.id}`],
    effects: effect ? [effect] : [], scope: "player",
  });
  applyEvent(state, map, ev, ctx);
  if (effect && !ev.effects.length) {
    return { ok: false, message: `The agreement could not take effect: ${(ev.rejected ?? []).map((r) => r.reason).join("; ")}` };
  }
  state.events.push(ev);
  return { ok: true, message: headline, event: ev };
}

/** Minimal map for validator paths that only need the province count. */
function stubMap(state: GameState): MapIndex {
  return { count: state.owners.length - 1, neighbors: [], coastal: [], names: [], area: [], cx: [], cy: [], width: 0 };
}
