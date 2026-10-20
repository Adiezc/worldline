// "Stop the clock at this event": rebuild the last resolved turn from its pre-turn snapshot,
// replaying only the events up to (and including) the one the host picked. Effects are re-applied
// through the shared validator with their stored, already-validated values; the id counter is
// replayed from the event ids so wars, treaties and resolutions keep the ids later events refer to.

import {
  applyEvent, countryByTag, daysBetween, enactResolution, newTurnContext, simTick,
  type GameEvent, type GameState, type OrderVerdict, type Resolution,
} from "@worldline/shared";
import type { EngineDeps, InterveneResult } from "./api.ts";

export const INTERRUPTED = "Interrupted: the host stopped time before this played out.";

/** Numeric sequence behind an id made by nextId (`e1z` → 71); NaN for foreign ids. */
const seqOf = (id: string) => parseInt(id.replace(/^[a-z]+/, ""), 36);

/** Events produced while resolving the snapshot's turn (later chat/formation events excluded). */
export function turnEvents(state: GameState, snapshotEventCount: number, turn: number) {
  return state.events.slice(snapshotEventCount).filter((e) => e.turn === turn);
}

export function intervene(state: GameState, deps: EngineDeps, opts: { snapshot: GameState; eventId: string }): InterveneResult {
  const snap = structuredClone(opts.snapshot);
  const turn = snap.turn;
  if (state.turn !== turn + 1) throw new Error("Only the most recent turn can be interrupted.");
  const all = turnEvents(state, snap.events.length, turn);
  const at = all.findIndex((e) => e.id === opts.eventId);
  if (at < 0) throw new Error("That event is not part of the last turn.");
  if (state.events.slice(snap.events.length).some((e) => e.turn > turn)) {
    throw new Error("Something already happened after the turn; time can no longer be stopped there.");
  }
  const chosen = all[at];
  const kept = all.slice(0, at + 1);
  const cut = all.slice(at + 1);
  const work = snap;

  // Same validation context as the original turn: its length and its orders (for player consent).
  const days = Math.max(1, daysBetween(snap.date, state.date));
  const orders = state.lastVerdicts.filter((v) => v.country).map((v) => ({ id: v.orderId, country: v.country! }));
  const ctx = newTurnContext(days, orders);

  // Resolutions voted on in that turn, matched to their vote events (see engine/votes.ts).
  const now = new Map(state.resolutions.map((r) => [r.id, r]));
  const voted = work.resolutions.filter((r) => r.status === "pending" && now.has(r.id) && now.get(r.id)!.status !== "pending");
  const voteEvent = new Map<string, Resolution>();
  for (const r of voted) {
    const ev = all.find((e) => !voteEvent.has(e.id) && !e.effects.length && e.countries[0] === r.proposer && e.body.startsWith(`"${r.text}" Vote`));
    if (ev) voteEvent.set(ev.id, r);
  }

  // Replay in creation (= application) order, which is id order.
  const replay = kept.map((e) => structuredClone(e)).sort((a, b) => (seqOf(a.id) || 0) - (seqOf(b.id) || 0));
  for (const ev of replay) {
    const seq = seqOf(ev.id);
    const r = voteEvent.get(ev.id);
    if (r) {
      const final = structuredClone(now.get(r.id)!);
      const org = work.organizations.find((o) => o.id === r.orgId);
      // enactResolution may take one id (a sanction) just before the vote event's own id.
      if (Number.isFinite(seq)) work.seq = seq - 2;
      if (final.status === "passed" && org) enactResolution(work, org, r, final.votes ?? {}, snap.date);
      Object.assign(r, final);
    }
    if (Number.isFinite(seq)) work.seq = seq;
    const original = ev.rejected ?? [];
    delete ev.rejected;
    delete ev.mapDiff;
    applyEvent(work, deps.map, ev, ctx);
    const fresh = ev.rejected ?? [];
    if (original.length || fresh.length) ev.rejected = [...original, ...fresh];
  }
  // Back to log (chronological) order.
  const byId = new Map(replay.map((e) => [e.id, e]));
  const events: GameEvent[] = kept.map((e) => byId.get(e.id)!);
  work.events.push(...events);

  // Resolutions: the snapshot's (now with this turn's votes) and any tabled by events we kept,
  // plus the ones players tabled after the turn. Ones tabled by cut events are gone.
  const tabledByCut = cut.flatMap((e) => e.effects.filter((x) => x.type === "proposeResolution"));
  const known = new Set(work.resolutions.map((r) => r.id));
  const snapIds = new Set(snap.resolutions.map((r) => r.id));
  for (const r of state.resolutions) {
    if (known.has(r.id) || snapIds.has(r.id)) continue;
    const fromCut = tabledByCut.some((x) => x.type === "proposeResolution" && x.orgId === r.orgId && x.proposer === r.proposer && x.text === r.text && x.resolutionType === r.type);
    const fromKept = events.some((e) => e.effects.some((x) => x.type === "proposeResolution" && x.orgId === r.orgId && x.proposer === r.proposer && x.text === r.text));
    if (!fromCut && !fromKept) work.resolutions.push(structuredClone(r));
  }

  const elapsed = daysBetween(snap.date, chosen.date);
  if (elapsed > 0) simTick(work, elapsed);
  work.date = chosen.date;
  work.turn = turn + 1;
  work.phase = "orders";
  work.orders = {};
  work.jumpVotes = {};
  delete work.turnDeadline;

  // Not turn-scoped: carried over from the present.
  work.chats = structuredClone(state.chats);
  work.settings = structuredClone(state.settings);
  work.usage = structuredClone(state.usage);
  work.rotation = state.rotation;
  work.memory = structuredClone(state.memory.filter((m) => m.upToTurn < turn));
  for (const k of work.countries) {
    const cur = countryByTag(state, k.tag);
    if (cur) k.agenda = structuredClone(cur.agenda);
  }
  work.players = state.players.map((p) => ({
    ...p, ready: false, country: p.country && countryByTag(work, p.country)?.alive ? p.country : null,
  }));
  work.seq = Math.max(work.seq, state.seq);

  // Orders whose consequences were cut short are at best partial now.
  const cutCauses = new Set(cut.flatMap((e) => e.causes));
  work.lastVerdicts = state.lastVerdicts.map((v): OrderVerdict =>
    cutCauses.has(v.orderId) && v.outcome !== "fail" ? { ...v, outcome: "partial", reason: INTERRUPTED } : { ...v });
  // The verdict history keeps the snapshot's entries plus the (possibly downgraded) interrupted turn.
  work.verdictLog = [
    ...(work.verdictLog ?? []),
    ...work.lastVerdicts.map((v) => ({ ...v, turn: opts.snapshot.turn, date: opts.snapshot.date })),
  ].slice(-500);

  for (const key of Object.keys(state)) delete (state as unknown as Record<string, unknown>)[key];
  Object.assign(state, work);
  return { events, cut: cut.length, date: chosen.date };
}
