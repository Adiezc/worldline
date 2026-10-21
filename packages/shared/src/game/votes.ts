// Organisation voting. Most AI votes come from a cheap heuristic; the server asks the LLM only
// for the votes that matter (veto holders, unanimity bodies, swing states). Counting is always
// done here, exactly, never by the LLM.

import { describeLoan, grantLoan } from "./loans.ts";
import { countryByTag, getRelation, nextId, relKey, type GameState, type Organization, type OrgBody, type Resolution, type ResolutionType } from "./state.ts";

export type Vote = "yes" | "no" | "abstain";

/** Resolution types a player can only table against a named country. */
export const NEEDS_TARGET: readonly ResolutionType[] = ["sanction", "condemn", "admitMember", "suspendMember", "expelMember", "authorizeForce", "loan"];

export function bodyOf(org: Organization, bodyId: string): OrgBody {
  return org.bodies.find((b) => b.id === bodyId) ?? org.bodies[0];
}

export function votersOf(org: Organization, body: OrgBody) {
  const seats = body.seats.length ? body.seats : org.members;
  return seats.filter((t) => org.members.includes(t) && !org.suspended.includes(t));
}

/** Share of a weighted vote needed to pass (0–1). */
export const weightedThreshold = (body: OrgBody) => body.threshold ?? 0.5;

/**
 * Voting power of each voter in a weighted body, in percent of the body (summing to 100). Members
 * with a quota keep it; the others share the rest, a fifth equally (like IMF basic votes) and the
 * remainder by GDP. Suspended members and empty seats drop out and the rest scale up.
 */
export function voteWeights(state: Pick<GameState, "countries">, org: Organization, body: OrgBody) {
  const voters = votersOf(org, body);
  const quotas = org.quotas ?? {};
  const listed = voters.filter((t) => (quotas[t] ?? 0) > 0);
  const rest = voters.filter((t) => !((quotas[t] ?? 0) > 0));
  const left = Math.max(0, 100 - listed.reduce((s, t) => s + quotas[t]!, 0));
  const gdp = (t: string) => countryByTag(state as GameState, t)?.gdp ?? 0;
  const totalGdp = rest.reduce((s, t) => s + gdp(t), 0);
  const raw = new Map<string, number>(listed.map((t) => [t, quotas[t]!]));
  for (const t of rest) raw.set(t, left * (0.2 / rest.length + (totalGdp > 0 ? (0.8 * gdp(t)) / totalGdp : 0.8 / rest.length)));
  const total = [...raw.values()].reduce((s, w) => s + w, 0);
  return new Map([...raw].map(([t, w]) => [t, total > 0 ? (w * 100) / total : 100 / voters.length]));
}

/** Positive = inclined to vote yes. */
export function voteScore(state: GameState, voter: string, r: Resolution) {
  if (voter === r.proposer) return 100;
  // A borrower wants its own loan; anyone else targeted opposes the measure.
  if (r.target && voter === r.target) return r.type === "loan" ? 100 : -100;
  let s = getRelation(state, voter, r.proposer) * 0.45;
  const shared = (a: string, b: string) => state.organizations.filter((o) => o.members.includes(a) && o.members.includes(b) && o.kind !== "global").length;
  const allied = (a: string, b: string) => state.treaties.some((t) => (t.type === "alliance" || t.type === "defensive") && t.members.includes(a) && t.members.includes(b));
  s += shared(voter, r.proposer) * 4;
  if (allied(voter, r.proposer)) s += 15;
  if (r.target) {
    const hostileMeasure = ["sanction", "condemn", "suspendMember", "expelMember", "authorizeForce"].includes(r.type);
    const tRel = getRelation(state, voter, r.target) + shared(voter, r.target) * 4 + (allied(voter, r.target) ? 30 : 0);
    s += hostileMeasure ? -tRel * 0.6 : tRel * 0.4;
    if (r.type === "admitMember") s += 8; // enlargement is usually welcome
    if (r.type === "loan") {
      s += 12; // lending to a member in trouble is routine
      // Shareholders don't lend to a government they are sanctioning.
      if (state.sanctions.some((x) => x.target === r.target && x.by.includes(voter))) s -= 40;
    }
  }
  // Big, stable members are cautious about binding measures.
  const v = countryByTag(state, voter);
  if (v && ["authorizeForce", "peacekeeping"].includes(r.type)) s -= 6;
  return s;
}

export function heuristicVote(state: GameState, voter: string, r: Resolution): Vote {
  const s = voteScore(state, voter, r);
  return s > 10 ? "yes" : s < -10 ? "no" : "abstain";
}

/** Voters worth an LLM opinion: veto holders, everyone in unanimity bodies, and swing states. */
export function keyVoters(state: GameState, org: Organization, body: OrgBody, r: Resolution, humans: Set<string>, max = 24) {
  const voters = votersOf(org, body).filter((t) => !humans.has(t));
  // In a unanimity body every single member can block, so all of them get asked (`max` only
  // limits swing voters). Truncating here silently left the rest to the heuristic.
  if (body.rule === "consensus") return voters;
  const out = new Set<string>(body.veto?.filter((t) => voters.includes(t)) ?? []);
  // In a weighted body the big shareholders decide: always ask the largest few.
  if (body.rule === "weighted") {
    const w = voteWeights(state, org, body);
    for (const t of [...voters].sort((a, b) => (w.get(b) ?? 0) - (w.get(a) ?? 0)).slice(0, 8)) out.add(t);
  }
  const swing = voters
    .filter((t) => !out.has(t))
    .map((t) => ({ t, s: Math.abs(voteScore(state, t, r)) }))
    .sort((a, b) => a.s - b.s);
  for (const { t, s } of swing) {
    if (out.size >= max || s > 25) break;
    out.add(t);
  }
  return [...out];
}

export interface Tally {
  status: "passed" | "failed" | "vetoed";
  yes: number;
  no: number;
  abstain: number;
  summary: string;
}

export function tally(state: GameState, org: Organization, body: OrgBody, votes: Record<string, Vote>): Tally {
  const voters = votersOf(org, body);
  let yes = 0, no = 0, abstain = 0;
  for (const t of voters) {
    const v = votes[t] ?? "abstain";
    if (v === "yes") yes++;
    else if (v === "no") no++;
    else abstain++;
  }
  const n = voters.length;
  let status: Tally["status"] = "failed";
  let summary = `${yes}–${no}, ${abstain} abstaining`;
  switch (body.rule) {
    case "consensus":
      status = no === 0 && yes > 0 ? "passed" : "failed";
      if (no > 0) summary += ` (blocked by ${voters.filter((t) => votes[t] === "no").join(", ")})`;
      break;
    case "simpleMajority":
      status = yes > no && yes > 0 ? "passed" : "failed";
      break;
    case "twoThirds":
      status = yes >= ((yes + no) * 2) / 3 && yes > 0 ? "passed" : "failed";
      break;
    case "qualifiedMajority": {
      const pop = (t: string) => countryByTag(state, t)?.population ?? 0;
      const totalPop = voters.reduce((s, t) => s + pop(t), 0);
      const yesPop = voters.filter((t) => votes[t] === "yes").reduce((s, t) => s + pop(t), 0);
      const statesOk = yes >= Math.ceil(n * 0.55);
      const popOk = yesPop >= totalPop * 0.65 - 1e-9; // tolerate float error at exactly 65%
      status = statesOk && popOk ? "passed" : "failed";
      summary += ` · ${Math.round((yes / Math.max(1, n)) * 100)}% of states, ${Math.round((yesPop / Math.max(1, totalPop)) * 100)}% of population`;
      break;
    }
    case "weighted": {
      const w = voteWeights(state, org, body);
      const share = (v: Vote) => voters.filter((t) => (votes[t] ?? "abstain") === v).reduce((s, t) => s + (w.get(t) ?? 0), 0);
      const yesW = share("yes"), need = weightedThreshold(body) * 100;
      const pct = (v: number) => `${Math.round(v * 10) / 10}%`;
      summary += ` · ${pct(yesW)} of voting power in favour, ${pct(need)} needed`;
      if (yesW >= need - 1e-9 && yes > 0) status = "passed";
      else {
        // A shareholder whose "no" alone stood between the measure and the threshold vetoed it
        // (the US in the IMF on 85% decisions).
        const blockers = voters.filter((t) => votes[t] === "no" && (w.get(t) ?? 0) >= 100 - need && yesW + (w.get(t) ?? 0) >= need - 1e-9);
        if (blockers.length) {
          status = "vetoed";
          summary += ` (blocked by ${blockers.map((t) => `${t} with ${pct(w.get(t) ?? 0)}`).join(", ")})`;
        }
      }
      break;
    }
    case "vetoMajority": {
      const needed = n >= 15 ? 9 : Math.ceil(n * 0.6);
      // Only a seated, unsuspended veto holder can veto.
      const vetoes = (body.veto ?? []).filter((t) => voters.includes(t) && votes[t] === "no");
      if (yes >= needed && vetoes.length) {
        status = "vetoed";
        summary += ` (vetoed by ${vetoes.join(", ")})`;
      } else status = yes >= needed ? "passed" : "failed";
      break;
    }
  }
  return { status, yes, no, abstain, summary };
}

/** Apply the consequences of a passed resolution. Returns a short description for the event log, if any. */
export function enactResolution(state: GameState, org: Organization, r: Resolution, votes: Record<string, Vote>, date: string): string | undefined {
  const yesVoters = Object.entries(votes).filter(([, v]) => v === "yes").map(([t]) => t);
  const t = r.target;
  switch (r.type) {
    case "sanction": {
      // Members already sanctioning the target are not added again (records would stack in the sim).
      const by = org.members.filter((m) => m !== t && !state.sanctions.some((s) => s.target === t && s.by.includes(m)));
      if (t && countryByTag(state, t)?.alive && by.length) state.sanctions.push({ id: nextId(state, "s"), target: t, by, source: `${org.abbrev} resolution`, since: date });
      break;
    }
    case "condemn":
      if (t) for (const y of yesVoters) state.relations[relKey(y, t)] = Math.max(-100, getRelation(state, y, t) - 8);
      break;
    case "admitMember":
      if (t && !org.members.includes(t)) {
        org.members.push(t);
        org.candidates = org.candidates.filter((c) => c.tag !== t);
        for (const m of org.members) if (m !== t) state.relations[relKey(m, t)] = Math.min(100, getRelation(state, m, t) + 6);
      }
      break;
    case "suspendMember":
      if (t && !org.suspended.includes(t)) org.suspended.push(t);
      break;
    case "expelMember":
      if (t) org.members = org.members.filter((m) => m !== t);
      break;
    case "loan": {
      const loan = t ? grantLoan(state, org, t, date) : null;
      return loan ? describeLoan(loan, org.abbrev) : undefined;
    }
    default:
      break; // peacekeeping, authorizeForce, tradePolicy, custom: the resolver narrates the outcome
  }
}
