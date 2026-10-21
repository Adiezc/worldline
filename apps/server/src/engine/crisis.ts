// End-of-turn crises the rules decide on their own: governments that fall when stability bottoms
// out, and broken nations asking players for terms. Neither waits for the model to think of it.

import {
  AFTER_COLLAPSE, countryByTag, governmentFalls, humanTags, loanCandidates, loanOffer, money, nextId, pickBody, SURRENDER_REPEAT, warCollapse,
  type ChatMessage, type GameEvent, type GameState,
} from "@worldline/shared";
import { openChat } from "./chat.ts";
import { makeEvent } from "./game.ts";

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Governments at the bottom of the stability scale fall. The upheaval costs the country (army,
 * economy), a caretaker holds office, and the next turn's resolver names who actually takes power.
 * Players' governments fall too: they keep playing the country under its new rulers.
 */
export function collapseGovernments(state: GameState, date: string): GameEvent[] {
  const events: GameEvent[] = [];
  for (const k of state.countries) {
    if (!governmentFalls(state, k.tag)) continue;
    const previous = k.leader;
    k.collapsedTurn = state.turn;
    k.stability = AFTER_COLLAPSE.stability;
    k.military = r2(Math.max(0, k.military - AFTER_COLLAPSE.military));
    k.gdp = r2(Math.max(0.01, k.gdp * (1 - AFTER_COLLAPSE.gdp / 100)));
    k.warExhaustion = r2(Math.min(100, k.warExhaustion + AFTER_COLLAPSE.exhaustion));
    k.leader = "Caretaker government";
    state.successions = [...(state.successions ?? []).filter((x) => x.country !== k.tag), { country: k.tag, previous, since: state.turn }];
    const ev = makeEvent(state, {
      date,
      headline: `Government of ${k.name} collapses`,
      body: `With the state no longer able to govern, the administration of ${previous} has fallen. A caretaker government holds office while rival factions, the army and the street contest who rules next. Units desert, ministries stall and markets slump.`,
      countries: [k.tag],
    });
    state.events.push(ev);
    events.push(ev);
  }
  return events;
}

/**
 * AI governments in crisis ask a lending organisation (the IMF first) for an emergency loan. The
 * request is voted at the end of the next turn, so players sitting in the body can vote on it.
 */
export function requestLoans(state: GameState, date: string): GameEvent[] {
  return loanCandidates(state).map(({ tag, org }) => {
    const name = countryByTag(state, tag)!.name;
    const offer = loanOffer(state, org, tag);
    const text = offer.kind === "stabilization"
      ? `${name} requests an emergency loan of about ${money(offer.amount)} to stabilise its finances, accepting the ${org.abbrev}'s conditions.`
      : `${name} requests about ${money(offer.amount)} in ${org.abbrev} lending to rebuild and keep public services running.`;
    state.resolutions.push({
      id: nextId(state, "r"), orgId: org.id, bodyId: pickBody(org, "loan").id, type: "loan", proposer: tag, target: tag,
      text, turn: state.turn + 1, status: "pending", votes: {},
    });
    const ev = makeEvent(state, { date, headline: `${name} asks the ${org.abbrev} for a loan`, body: text, countries: [tag] });
    state.events.push(ev);
    return ev;
  });
}

/**
 * A nation too broken to fight on asks each player at war with it for terms: an end to the war on
 * the current lines, waiting in their private channel. A rejected offer comes back after a couple
 * of turns while the collapse lasts, and in talks it signs whatever the winner can legally impose.
 */
export function offerSurrenders(state: GameState, date: string): ChatMessage[] {
  const humans = humanTags(state);
  const sent: ChatMessage[] = [];
  for (const w of state.wars) {
    for (const [side, enemies] of [[w.attackers, w.defenders], [w.defenders, w.attackers]] as const) {
      for (const loser of side) {
        if (humans.has(loser) || !warCollapse(state, loser)) continue;
        for (const winner of enemies.filter((t) => humans.has(t) && countryByTag(state, t)?.alive)) {
          const key = `${loser}>${winner}`;
          const last = state.surrenderOffers?.[key];
          if (last !== undefined && state.turn - last < SURRENDER_REPEAT) continue;
          const chatId = openChat(state, { from: loser, with: [winner] });
          const chat = state.chats.find((c) => c.id === chatId)!;
          if (chat.messages.some((m) => m.proposal?.status === "open" && m.proposal.kind === "endWar")) continue;
          const name = countryByTag(state, loser)!.name;
          const msg: ChatMessage = {
            id: nextId(state, "m"), from: loser, at: date, unprompted: true,
            text: `${name} can no longer continue this war. We ask for an end to the fighting on the current lines. If you have other terms, state them: we are prepared to listen.`,
            proposal: {
              id: nextId(state, "p"), kind: "endWar", peace: "keep_occupied", members: [loser, winner],
              terms: `${name} requests a ceasefire and peace: each side keeps the territory it holds.`, status: "open", awaiting: [winner],
            },
          };
          chat.messages.push(msg);
          chat.lastTurn = state.turn;
          (state.surrenderOffers ??= {})[key] = state.turn;
          sent.push(msg);
        }
      }
    }
  }
  return sent;
}
