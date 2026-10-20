// Diplomacy chats. One AI member answers each human message; agreed proposals take effect at
// once through the validator, with the chat standing in for a player order.

import {
  applyEvent, atWar, ChatOutputSchema, computeFronts, connectedTransfer, countryByTag, countryIndex, estimateForces, getRelation,
  humanTags, newTurnContext,
  nextId, relKey, type Chat, type ChatMessage, type Effect, type GameEvent, type GameState, type MapIndex, type Proposal,
  type ProposalCession, type ProposalDraft, type TreatyType, type War,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { countryDetail, nameOf, occupationSummary, orgsOf, recentEventsBlock, relationList, treatiesBlock } from "./context.ts";
import { makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { chatSystem } from "./prompts.ts";

/** A proposal the rules refuse before it is sent (the player sees the message as is). */
export class ProposalError extends Error {
  override name = "ProposalError";
}

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
  state: GameState, deps: EngineDeps,
  opts: { chatId: string; playerId: string; text: string; proposal?: ProposalDraft; speaker?: string },
): Promise<void> {
  const chat = state.chats.find((c) => c.id === opts.chatId);
  if (!chat) throw new Error("No such chat.");
  const from = state.players.find((p) => p.id === opts.playerId)?.country;
  if (!from || !chat.members.includes(from)) throw new Error("You are not part of this chat.");
  const text = opts.text.trim().slice(0, 2000);
  if (!text && !opts.proposal) throw new Error("Empty message.");

  const humans = humanTags(state);
  const proposal = opts.proposal ? draftToProposal(state, deps.map, chat, from, opts.proposal) : undefined;
  const msg: ChatMessage = { id: nextId(state, "m"), from, playerId: opts.playerId, text, at: state.date, proposal };
  const ai = chat.members.filter((m) => !humans.has(m) && countryByTag(state, m)?.alive);
  if (opts.speaker && !ai.includes(opts.speaker)) throw new Error(`${opts.speaker} is not an AI delegation in this conversation.`);
  if (!ai.length) {
    chat.messages.push(msg);
    chat.lastTurn = state.turn;
    return;
  }

  // The AI reply is fetched before anything is committed, so a failed call changes nothing.
  const speaker = opts.speaker ?? pickSpeaker(state, chat, text, proposal, ai);
  const present = chat.members.length > 2 ? chat.members.filter((m) => m !== speaker).map((t) => `${nameOf(state, t)} (${t})`) : undefined;
  const out = await callJson(deps, state, {
    kind: "chat",
    schemaName: "ChatOutput",
    system: chatSystem(nameOf(state, speaker), speaker, present),
    user: chatPrompt(state, deps.map, chat, speaker, from, [...chat.messages, msg]),
    maxTokens: 1500,
    temperature: 0.8,
    mockContext: {
      speaker, speakerName: nameOf(state, speaker), player: from, playerName: nameOf(state, from),
      relation: getRelation(state, speaker, from), hasProposal: !!proposal, proposalMembers: proposal?.members ?? [], text,
      peace: proposal?.kind === "endWar" ? {
        exhaustion: countryByTag(state, speaker)?.warExhaustion ?? 0,
        // Regions of the speaker held by the enemy: a losing side is readier to settle.
        landLost: state.owners.filter((o, id) => id > 0 && state.countries[o]?.tag === speaker && state.controllers[id] !== o).length,
        // Named regions the speaker would give up that the other side does not even hold.
        unheldDemand: (proposal.cessions ?? []).filter((c) => c.from === speaker)
          .reduce((n, c) => n + c.provinces.filter((id) => state.controllers[id] === state.owners[id]).length, 0),
      } : undefined,
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
        id: nextId(state, "p"), kind: out.proposal.kind, treatyType: out.proposal.treatyType,
        peace: out.proposal.kind === "endWar" ? out.proposal.peace ?? "white" : undefined, members,
        terms: out.proposal.terms, status: "open", awaiting: awaiting.length ? awaiting : humanMembers,
      };
    }
  }
  chat.messages.push(reply);
  chat.lastTurn = state.turn;
}

export function respondProposal(
  state: GameState, opts: { chatId: string; proposalId: string; byTag: string; accept: boolean; map?: MapIndex },
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
  // Cessions need real adjacency (exclave checks); the stub only suits treaties and plain peace.
  const res = applyProposal(state, opts.map ?? stubMap(state), chat, p);
  p.status = res.ok ? "accepted" : "rejected";
  return res;
}

// ---- helpers ----

function draftToProposal(state: GameState, map: MapIndex, chat: Chat, from: string, d: ProposalDraft): Proposal {
  const humans = humanTags(state);
  const members = [...new Set([from, ...d.members])].filter((t) => countryByTag(state, t)?.alive);
  if (members.length < 2) throw new ProposalError("A proposal needs at least two parties.");
  const peace = d.kind === "endWar" ? (d.peace === "keep_occupied" ? "keep_occupied" : "white") : undefined;
  const cessions = d.kind === "endWar" ? draftCessions(state, map, members, peace!, d.cessions) : undefined;
  return {
    id: nextId(state, "p"), kind: d.kind, treatyType: d.kind === "treaty" ? d.treatyType ?? "nonaggression" : d.treatyType,
    peace, cessions: cessions?.length ? cessions : undefined,
    members, terms: d.terms.trim().slice(0, 1000), status: "open",
    awaiting: chat.members.filter((m) => m !== from && humans.has(m)),
  };
}

const warBetween = (state: GameState, members: string[]) =>
  state.wars.find((w) => members.some((a) => w.attackers.includes(a)) && members.some((d) => w.defenders.includes(d)));

const MAX_NAMED_REGIONS = 150;

/**
 * Regions a peace proposal names, checked up front so the other side judges terms that can
 * actually happen: each must belong to the ceding party, the two must be on opposite sides of
 * the war, and nothing may be left cut off from its new owner.
 */
function draftCessions(
  state: GameState, map: MapIndex, members: string[], peace: "white" | "keep_occupied", raw: unknown,
): ProposalCession[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined;
  const war = warBetween(state, members);
  if (!war) throw new ProposalError("There is no war between these parties.");
  const side = (t: string) => (war.attackers.includes(t) ? "a" : war.defenders.includes(t) ? "d" : "");
  const seen = new Set<number>();
  const out: ProposalCession[] = [];
  for (const c of raw.slice(0, 16) as Partial<ProposalCession>[]) {
    if (!c || typeof c.from !== "string" || typeof c.to !== "string" || !Array.isArray(c.provinces)) continue;
    if (!members.includes(c.from) || !members.includes(c.to) || !side(c.from) || !side(c.to) || side(c.from) === side(c.to)) {
      throw new ProposalError(`${nameOf(state, c.from)} and ${nameOf(state, c.to)} are not opposing parties in this war.`);
    }
    const fromIdx = countryIndex(state, c.from);
    const ids = [...new Set(c.provinces.map(Number))].filter((id) =>
      Number.isInteger(id) && id >= 1 && id <= map.count && state.owners[id] === fromIdx && !seen.has(id));
    for (const id of ids) seen.add(id);
    if (ids.length) out.push({ from: c.from, to: c.to, provinces: ids });
  }
  if (seen.size > MAX_NAMED_REGIONS) throw new ProposalError(`A peace deal can name at most ${MAX_NAMED_REGIONS} regions.`);
  // Connectivity per recipient, counting land it would also keep under "keep what you hold".
  const kept = peace === "keep_occupied" ? occupiedCessions(state, war) : [];
  for (const to of new Set(out.map((c) => c.to))) {
    const toIdx = countryIndex(state, to);
    const named = out.filter((c) => c.to === to).flatMap((c) => c.provinces);
    const alsoKept = kept.flatMap((e) => (e.type === "transferProvinces" && e.to === to ? e.provinces : []));
    const linked = connectedTransfer(state, map, [...named, ...alsoKept], toIdx);
    const stranded = named.filter((id) => !linked.has(id));
    if (stranded.length) {
      const list = stranded.slice(0, 4).map((id) => map.names[id] ?? `region ${id}`).join(", ");
      throw new ProposalError(`${list}${stranded.length > 4 ? ` and ${stranded.length - 4} more` : ""} would be cut off from ${nameOf(state, to)}. Add the regions in between, or pick land that borders it.`);
    }
  }
  return out;
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

function chatPrompt(state: GameState, map: MapIndex, chat: Chat, speaker: string, from: string, history: ChatMessage[]) {
  const humans = humanTags(state);
  const me = countryByTag(state, speaker)!, them = countryByTag(state, from)!;
  const focus = new Set(chat.members.length > 2 ? chat.members : [speaker, from]);
  const others = chat.members.filter((m) => m !== speaker);
  const wars = state.wars.filter((w) => [...w.attackers, ...w.defenders].some((t) => focus.has(t)))
    .map((w) => {
      const exhaustion = [...w.attackers, ...w.defenders].map((t) => `${t} ${Math.round(countryByTag(state, t)?.warExhaustion ?? 0)}`).join(", ");
      const occ = occupationSummary(state, w);
      return `${w.id} "${w.name}" since ${w.since}: ${w.attackers.join(", ")} vs ${w.defenders.join(", ")}; war exhaustion ${exhaustion}${occ ? `; occupation: ${occ}` : ""}`;
    });
  const sanctions = state.sanctions.filter((s) => focus.has(s.target) || s.by.some((t) => focus.has(t)))
    .map((s) => `${s.target} sanctioned by ${s.by.slice(0, 8).join(", ")}${s.by.length > 8 ? "…" : ""}`);
  const shared = orgsOf(state, speaker).filter((o) => orgsOf(state, from).includes(o));
  const lines = history.slice(-14).map((m) => {
    let s = `[${m.from}] ${m.text}`;
    if (m.proposal) {
      const p = m.proposal;
      s += `\n  PROPOSAL (${p.status}): ${p.kind}${p.treatyType ? ` (${p.treatyType})` : ""} between ${p.members.join(", ")}; terms: ${p.terms}`;
      if (p.kind === "endWar") s += `\n  PEACE TERMS: ${describePeace(state, p, map)}`;
    }
    return s;
  });
  const group = chat.members.length > 2;
  return [
    `DATE: ${state.date}`,
    `YOU: ${countryDetail(state, me, humans)}`,
    group
      ? `MULTILATERAL CONFERENCE. Delegations present besides you (${others.length}):\n${others.map((t) => countryDetail(state, countryByTag(state, t)!, humans)).join("\n")}`
      : `SPEAKING WITH: ${others.map((t) => countryDetail(state, countryByTag(state, t)!, humans)).join("\n")}`,
    `YOUR RELATIONS (-100..100): ${relationList(state, speaker, others)}${shared.length ? `; shared memberships: ${shared.join(" ")}` : ""}`,
    treatiesBlock(state, focus, 15),
    wars.length ? `WARS:\n${wars.join("\n")}` : "",
    ...others.map((t) => warSituation(state, map, speaker, t)).filter(Boolean),
    sanctions.length ? `SANCTIONS:\n${sanctions.join("\n")}` : "",
    recentEventsBlock(state, { involving: focus, max: 14, bodies: true }),
    `CONVERSATION (latest last):\n${lines.join("\n")}`,
    `TASK: Reply as ${me.name} to ${them.name}'s last message${group ? ", speaking for your delegation before everyone present; you may address other delegations by name" : ""}.` +
      `${history.at(-1)?.proposal ? " It contains a PROPOSAL: set acceptsPlayerProposal." : ""}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * The speaker's military position in its war with `other`, spelled out so the model weighs peace
 * on facts (land lost, the odds, who is helping) rather than on bravado.
 */
export function warSituation(state: GameState, map: MapIndex, speaker: string, other: string): string {
  const war = warBetween(state, [speaker, other]);
  if (!war || !(war.attackers.includes(speaker) ? war.defenders : war.attackers).includes(other)) return "";
  const mySide = war.attackers.includes(speaker) ? war.attackers : war.defenders;
  const enemySide = mySide === war.attackers ? war.defenders : war.attackers;
  const me = countryIndex(state, speaker);
  const enemyIdx = new Set(enemySide.map((t) => countryIndex(state, t)));
  let owned = 0, lost = 0;
  for (let id = 1; id < state.owners.length; id++) {
    if (state.owners[id] !== me) continue;
    owned++;
    if (enemyIdx.has(state.controllers[id])) lost++;
  }
  const input = { owners: state.owners, controllers: state.controllers, countries: state.countries, wars: state.wars, map };
  const forces = estimateForces(input, computeFronts(input));
  const total = (tags: string[]) => tags.reduce((n, t) => n + (forces.countries[t]?.total ?? 0), 0);
  const own = total(mySide), enemy = total(enemySide);
  const allies = mySide.filter((t) => t !== speaker && countryByTag(state, t)?.alive);
  const share = owned ? lost / owned : 0;
  const exhaustion = Math.round(countryByTag(state, speaker)?.warExhaustion ?? 0);
  const assessment =
    share >= 0.5 || (share >= 0.2 && enemy >= 3 * own) || exhaustion >= 70
      ? "COLLAPSING: your forces cannot retake the occupied land and every month costs more of what remains. Governments in this position sue for peace and sign terms that cede only land the enemy already holds, to save the rest."
      : share > 0 && enemy > own
        ? "LOSING: the enemy holds your land and has the stronger army. Settling on the current lines is a realistic option; giving up land it does not hold is not."
        : enemy > 1.5 * own
          ? "OUTMATCHED but holding your ground."
          : share === 0 && lost === 0 && own >= enemy
            ? "HOLDING or WINNING: you have no reason to give up land."
            : "STALEMATE.";
  return `YOUR WAR SITUATION (${war.name}): ${lost} of your ${owned} regions are occupied by the enemy (${Math.round(share * 100)}%); ` +
    `estimated divisions: your side ${own}, enemy side ${enemy}; allies fighting with you: ${allies.length ? allies.join(", ") : "none"}; ` +
    `your war exhaustion ${exhaustion}. Assessment: ${assessment}`;
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
  let cessions: Effect[] = [];
  let negotiated = false;
  let headline = `${joined} reach an agreement`;

  switch (p.kind) {
    case "treaty": {
      const treatyType = p.treatyType ?? "nonaggression";
      effect = { type: "createTreaty", treatyType, members: p.members };
      headline = `${joined} sign ${TREATY_LABEL[treatyType]}`;
      break;
    }
    case "endWar": {
      const war = warBetween(state, p.members);
      if (!war) return { ok: false, message: "There is no war between these parties." };
      effect = { type: "makePeace", warId: war.id, terms: p.terms };
      // Regions named in the deal go where it says; "keep what you hold" covers the rest.
      const named = new Set((p.cessions ?? []).flatMap((c) => c.provinces));
      const kept = p.peace === "keep_occupied"
        ? occupiedCessions(state, war).flatMap((e) => {
          if (e.type !== "transferProvinces") return [];
          const provinces = e.provinces.filter((id) => !named.has(id));
          return provinces.length ? [{ ...e, provinces }] : [];
        })
        : [];
      cessions = [...kept, ...(p.cessions ?? []).map((c): Effect => ({ type: "transferProvinces", provinces: c.provinces, from: c.from, to: c.to }))];
      negotiated = named.size > 0;
      headline = named.size
        ? `${joined} sign a peace treaty; ${(p.cessions ?? []).map((c) => `${nameOf(state, c.from)} cedes ${c.provinces.length} region${c.provinces.length === 1 ? "" : "s"} to ${nameOf(state, c.to)}`).join(", ")}`
        : cessions.length ? `${joined} make peace; occupied land changes hands` : `${joined} agree to end the ${war.name}`;
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
  // Both sides signed off on exactly these regions, so they may include unoccupied land.
  ctx.negotiated = negotiated;
  const ev = makeEvent(state, {
    date: state.date, headline, body: p.terms, countries: p.members, causes: causes.length ? causes : [`chat:${chat.id}`],
    effects: effect ? [effect, ...cessions] : [], scope: "player",
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

/** "Keep what you hold": each occupied region passes to the side occupying it. */
export function occupiedCessions(state: GameState, war: War): Effect[] {
  const side = (t: string) => (war.attackers.includes(t) ? "a" : war.defenders.includes(t) ? "d" : "");
  const groups = new Map<string, number[]>();
  for (let id = 1; id < state.owners.length; id++) {
    const o = state.countries[state.owners[id]]?.tag, c = state.countries[state.controllers[id]]?.tag;
    if (!o || !c || o === c || !side(o) || !side(c) || side(o) === side(c)) continue;
    const key = `${o}>${c}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(id);
  }
  return [...groups].map(([key, provinces]) => {
    const [from, to] = key.split(">");
    return { type: "transferProvinces", provinces, from, to } as Effect;
  });
}

function describePeace(state: GameState, p: Proposal, map?: MapIndex) {
  const war = warBetween(state, p.members);
  if (!war) return "no war exists between these parties";
  let base: string;
  if (p.peace !== "keep_occupied") base = "otherwise white peace: every other occupied region returns to its owner";
  else {
    const moves = occupiedCessions(state, war).map((e) => (e.type === "transferProvinces" ? `${e.from} cedes ${e.provinces.length} region(s) to ${e.to}` : ""));
    base = moves.length ? `otherwise each side keeps what it holds: ${moves.join("; ")}` : "otherwise each side keeps what it holds (nothing is occupied, so this equals a white peace)";
  }
  const named = (p.cessions ?? []).map((c) => {
    const toSide = new Set((war.attackers.includes(c.to) ? war.attackers : war.defenders).map((t) => countryIndex(state, t)));
    const held = c.provinces.filter((id) => toSide.has(state.controllers[id])).length;
    const names = c.provinces.slice(0, 12).map((id) => map?.names[id] ?? `region ${id}`).join(", ");
    const more = c.provinces.length > 12 ? ` and ${c.provinces.length - 12} more` : "";
    const holding = held === c.provinces.length
      ? `all already occupied by ${c.to}'s side`
      : `${c.provinces.length - held} of them NOT occupied by ${c.to}'s side (${c.from} would hand over land it still holds)`;
    return `${c.from} CEDES ${c.provinces.length} named region(s) to ${c.to}: ${names}${more}; ${holding}`;
  });
  return named.length ? `${named.join("; ")}; ${base}` : base.replace(/^otherwise /, "");
}
