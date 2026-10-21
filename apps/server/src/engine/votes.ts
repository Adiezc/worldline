// Organisation votes: humans vote via castVote, most AI members by heuristic, and the key voters
// (veto holders, consensus bodies, swing states) through one batched LLM call. Counting is exact.

import {
  bodyOf, countryByTag, enactResolution, getRelation, heuristicVote, humanTags, keyVoters, loanBlocker, loanOffer, money, NEEDS_TARGET, nextId, pickBody, tally,
  voteWeights, votersOf, VotesOutputSchema, weightedThreshold,
  type GameEvent, type GameState, type Organization, type Resolution, type ResolutionResult, type ResolutionType, type Vote,
} from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { nameOf, recentEventsBlock, warsBlock } from "./context.ts";
import { makeEvent } from "./game.ts";
import { callJson } from "./llm.ts";
import { VOTES_SYSTEM } from "./prompts.ts";

export interface VotesResult {
  results: ResolutionResult[];
  events: GameEvent[];
  /** One line per outcome, handed to the resolver as facts. */
  facts: string[];
}

const LABEL: Record<ResolutionType, [string, string]> = {
  sanction: ["sanctions", "on"],
  condemn: ["condemnation", "of"],
  peacekeeping: ["peacekeeping mission", "in"],
  admitMember: ["admission", "of"],
  suspendMember: ["suspension", "of"],
  expelMember: ["expulsion", "of"],
  tradePolicy: ["trade measure", "on"],
  authorizeForce: ["use of force", "against"],
  loan: ["loan", "for"],
  custom: ["resolution", "on"],
};

export async function runVotes(state: GameState, deps: EngineDeps): Promise<VotesResult> {
  const pending = state.resolutions.filter((r) => r.status === "pending" && r.turn <= state.turn);
  if (!pending.length) return { results: [], events: [], facts: [] };
  const humans = humanTags(state);

  const plans = pending.map((r) => {
    const org = state.organizations.find((o) => o.id === r.orgId);
    if (!org) return { r, org: undefined, keys: [] as string[] };
    const body = bodyOf(org, r.bodyId);
    return { r, org, body, keys: keyVoters(state, org, body, r, humans) };
  });

  const llm = await askKeyVoters(state, deps, plans);
  const results: ResolutionResult[] = [];
  const events: GameEvent[] = [];
  const facts: string[] = [];

  for (const { r, org, body } of plans) {
    if (!org || !body) {
      r.status = "failed";
      continue;
    }
    const votes: Record<string, Vote> = {};
    const reasons: Record<string, string> = {};
    for (const t of votersOf(org, body)) {
      if (humans.has(t)) votes[t] = r.votes?.[t] ?? "abstain";
      else {
        const v = llm.get(r.id)?.get(t);
        votes[t] = v?.vote ?? heuristicVote(state, t, r);
        if (v?.reason) reasons[t] = v.reason;
      }
    }
    const t = tally(state, org, body, votes);
    const outcome = t.status === "passed" ? enactResolution(state, org, r, votes, state.date) : undefined;
    r.status = t.status;
    r.votes = votes;
    r.reasons = reasons;

    const [label, prep] = LABEL[r.type];
    const what = `${label}${r.target ? ` ${prep} ${nameOf(state, r.target)}` : ""}`;
    const where = org.bodies.length > 1 ? `${org.abbrev} ${body.name}` : org.abbrev;
    const headline = t.status === "passed" ? `${where} approves ${what}`
      : t.status === "vetoed" ? `Veto blocks ${org.abbrev} ${what}` : `${where} rejects ${what}`;
    const notable = Object.entries(reasons).slice(0, 3).map(([tag, why]) => `${nameOf(state, tag)}: ${why}`).join(" ");
    const ev = makeEvent(state, {
      date: state.date,
      headline,
      body: `"${r.text}" Vote ${t.summary}.${outcome ? ` ${outcome}` : ""}${notable ? ` ${notable}` : ""}`,
      countries: [r.proposer, ...(r.target ? [r.target] : [])],
    });
    state.events.push(ev);
    events.push(ev);
    results.push({ resolutionId: r.id, orgAbbrev: org.abbrev, status: t.status, summary: t.summary, text: r.text });
    facts.push(`${org.abbrev} ${body.name} ${t.status.toUpperCase()} ${r.type}${r.target ? ` (target ${r.target})` : ""} proposed by ${r.proposer}: ${t.summary}${outcome ? `. ${outcome} (already applied by the rules)` : ""}`);
  }
  return { results, events, facts };
}

type Plan = { r: Resolution; org?: Organization; body?: Organization["bodies"][number]; keys: string[] };

/** One batched call for every key voter; on failure everyone falls back to the heuristic. */
async function askKeyVoters(state: GameState, deps: EngineDeps, plans: Plan[]) {
  const out = new Map<string, Map<string, { vote: Vote; reason: string }>>();
  const asked = plans.filter((p) => p.org && p.keys.length);
  if (!asked.length) return out;

  const hint = (voter: string, r: Resolution, veto: boolean, weight?: number) => {
    const bits = [`rel. proposer ${getRelation(state, voter, r.proposer)}`];
    if (r.target) bits.push(`rel. target ${getRelation(state, voter, r.target)}`);
    if (veto) bits.push("veto");
    if (weight !== undefined) bits.push(`${Math.round(weight * 10) / 10}% of votes`);
    return `${voter} (${bits.join(", ")})`;
  };
  const lines = asked.map(({ r, org, body, keys }) => {
    const veto = new Set(body!.veto ?? []);
    const weights = body!.rule === "weighted" ? voteWeights(state, org!, body!) : undefined;
    const rule = weights ? `weighted, ${Math.round(weightedThreshold(body!) * 100)}% of voting power needed` : body!.rule;
    return `${r.id} in ${org!.abbrev} ${body!.name} [${rule}]: ${r.type}${r.target ? ` targeting ${r.target} ${nameOf(state, r.target)}` : ""}, ` +
      `proposed by ${r.proposer} ${nameOf(state, r.proposer)}: "${r.text}"\n  voters: ${keys.map((k) => hint(k, r, veto.has(k), weights?.get(k))).join("; ")}`;
  });
  const involved = new Set(asked.flatMap(({ r }) => [r.proposer, ...(r.target ? [r.target] : [])]));
  const user = [
    `DATE: ${state.date}`,
    warsBlock(state, deps.map),
    recentEventsBlock(state, { involving: involved, max: 15 }),
    `RESOLUTIONS:\n${lines.join("\n")}`,
    "TASK: Give each listed voter's vote on each resolution.",
  ].filter(Boolean).join("\n\n");

  try {
    const res = await callJson(deps, state, {
      kind: "votes",
      schemaName: "VotesOutput",
      system: VOTES_SYSTEM,
      user,
      maxTokens: 3000,
      temperature: 0.4,
      mockContext: {
        resolutions: asked.map(({ r, keys }) => ({ id: r.id, voters: keys.map((t) => ({ tag: t, vote: heuristicVote(state, t, r) })) })),
      },
    }, VotesOutputSchema);
    const allowed = new Map(asked.map((p) => [p.r.id, new Set(p.keys)]));
    for (const v of res.votes) {
      if (!allowed.get(v.resolutionId)?.has(v.country)) continue;
      if (!out.has(v.resolutionId)) out.set(v.resolutionId, new Map());
      out.get(v.resolutionId)!.set(v.country, { vote: v.vote, reason: v.reason });
    }
  } catch (err) {
    console.warn(`[votes] key-voter call failed, using heuristics: ${err instanceof Error ? err.message : err}`);
  }
  return out;
}

// ---- player actions ----

export function proposeResolution(
  state: GameState,
  opts: { orgId: string; proposer: string; resolutionType: ResolutionType; target?: string; text: string },
): { ok: boolean; message: string } {
  const org = state.organizations.find((o) => o.id === opts.orgId);
  if (!org) return { ok: false, message: "No such organisation." };
  if (!org.members.includes(opts.proposer)) return { ok: false, message: `${opts.proposer} is not a member of the ${org.abbrev}.` };
  if (org.suspended.includes(opts.proposer)) return { ok: false, message: `${opts.proposer} is suspended from the ${org.abbrev}.` };
  if (!org.powers.includes(opts.resolutionType)) return { ok: false, message: `The ${org.abbrev} cannot pass ${opts.resolutionType} resolutions.` };
  const text = opts.text.trim().slice(0, 600);
  if (!text) return { ok: false, message: "The resolution needs a text." };
  const target = opts.target || undefined;
  if (NEEDS_TARGET.includes(opts.resolutionType) && !target) return { ok: false, message: "This resolution needs a target country." };
  if (target) {
    const k = countryByTag(state, target);
    if (!k?.alive) return { ok: false, message: "Unknown target country." };
    if (opts.resolutionType === "admitMember" && org.members.includes(target)) return { ok: false, message: `${target} is already a member.` };
    if ((opts.resolutionType === "suspendMember" || opts.resolutionType === "expelMember") && !org.members.includes(target)) {
      return { ok: false, message: `${target} is not a member.` };
    }
    if (opts.resolutionType === "loan") {
      // Another player's country borrows only when its own player asks.
      if (target !== opts.proposer && humanTags(state).has(target)) return { ok: false, message: `Only ${target}'s government can ask for its loan.` };
      const why = loanBlocker(state, org, target);
      if (why) return { ok: false, message: why };
    }
  }
  const dup = state.resolutions.some((r) => r.status === "pending" && r.orgId === org.id && r.type === opts.resolutionType && r.target === target);
  if (dup) return { ok: false, message: "An identical resolution is already pending." };

  const body = pickBody(org, opts.resolutionType);
  const r: Resolution = {
    id: nextId(state, "r"), orgId: org.id, bodyId: body.id, type: opts.resolutionType, proposer: opts.proposer,
    target, text, turn: state.turn, status: "pending", votes: {},
  };
  // The sponsor votes for its own text unless it later says otherwise.
  if (votersOf(org, body).includes(opts.proposer)) r.votes![opts.proposer] = "yes";
  state.resolutions.push(r);
  if (r.type === "loan") {
    const offer = loanOffer(state, org, target!);
    return { ok: true, message: `Loan request of about ${money(offer.amount)} tabled in the ${org.abbrev} ${body.name}; it is voted when this turn resolves.` };
  }
  return { ok: true, message: `Resolution tabled in the ${org.abbrev} ${body.name}; it is voted when this turn resolves.` };
}

export function castVote(
  state: GameState, opts: { resolutionId: string; country: string; vote: "yes" | "no" | "abstain" },
): { ok: boolean; message: string } {
  const r = state.resolutions.find((x) => x.id === opts.resolutionId);
  if (!r) return { ok: false, message: "No such resolution." };
  if (r.status !== "pending") return { ok: false, message: "Voting on this resolution has closed." };
  const org = state.organizations.find((o) => o.id === r.orgId);
  if (!org) return { ok: false, message: "The organisation no longer exists." };
  const body = bodyOf(org, r.bodyId);
  if (!votersOf(org, body).includes(opts.country)) return { ok: false, message: `${opts.country} has no vote in the ${org.abbrev} ${body.name}.` };
  r.votes = { ...(r.votes ?? {}), [opts.country]: opts.vote };
  return { ok: true, message: `Vote recorded: ${opts.vote}.` };
}
