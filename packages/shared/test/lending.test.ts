// The IMF and World Bank: stake-weighted votes with an 85% bar, and loans whose effects the rules decide.
import { describe, expect, test } from "bun:test";
import { applyEvent } from "../src/game/engine.ts";
import { activeLoan, grantLoan, LOAN_TERMS, loanBlocker, loanCandidates, loanDrag, loanOffer, money } from "../src/game/loans.ts";
import { simTick } from "../src/game/sim.ts";
import { addDays, type GameState, type Organization, type Resolution } from "../src/game/state.ts";
import { bodyOf, enactResolution, heuristicVote, keyVoters, tally, voteWeights, type Vote } from "../src/game/votes.ts";
import { addHuman, country, ctx, ev, makeState, MAP } from "./fixtures.ts";

const QUOTAS = { USA: 16.49, JPN: 6.14, CHN: 6.08, DEU: 5.31, FRA: 4.03, GBR: 4.03 };

/** An IMF of every country in the fixture, with real-ish quotas for the largest shareholders. */
function withImf(s: GameState, lender: "stabilization" | "development" = "stabilization") {
  const imf: Organization = {
    id: "imf", abbrev: "IMF", name: "International Monetary Fund", kind: "economic",
    members: s.countries.map((c) => c.tag), observers: [], candidates: [], suspended: [],
    bodies: [
      { id: "governors", name: "Board of Governors", seats: [], rule: "weighted", threshold: 0.85, handles: ["admitMember", "expelMember", "custom"] },
      { id: "board", name: "Executive Board", seats: [], rule: "weighted", threshold: 0.5, handles: ["loan"] },
    ],
    powers: ["loan", "admitMember", "expelMember", "custom"], quotas: { ...QUOTAS }, effects: { lender }, cohesion: 62,
  };
  s.organizations.push(imf);
  return imf;
}

const all = (tags: string[], v: Vote) => Object.fromEntries(tags.map((t) => [t, v])) as Record<string, Vote>;
const loanRes = (target: string, over: Partial<Resolution> = {}): Resolution => ({
  id: "r1", orgId: "imf", bodyId: "board", type: "loan", proposer: target, target, text: "", turn: 1, status: "pending", ...over,
});

describe("weighted voting", () => {
  test("quota holders keep their share; the rest split what is left, more for bigger economies", () => {
    const s = makeState();
    const imf = withImf(s);
    country(s, "ARG").gdp = 600;
    country(s, "URY").gdp = 80;
    const w = voteWeights(s, imf, bodyOf(imf, "governors"));
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(w.get("USA")).toBeCloseTo(16.49, 6);
    expect(w.get("ARG")!).toBeGreaterThan(w.get("URY")!);
    // Everyone has some vote (the equal "basic votes" part).
    expect(Math.min(...w.values())).toBeGreaterThan(0);
  });

  test("the US alone blocks an 85% decision: vetoed even when everyone else votes yes", () => {
    const s = makeState();
    const imf = withImf(s);
    const gov = bodyOf(imf, "governors");
    const t = tally(s, imf, gov, { ...all(imf.members, "yes"), USA: "no" });
    expect(t.status).toBe("vetoed");
    expect(t.summary).toContain("USA");
    expect(t.summary).toContain("85% needed");
  });

  test("a smaller shareholder cannot block alone, but a coalition can", () => {
    const s = makeState();
    const imf = withImf(s);
    const gov = bodyOf(imf, "governors");
    expect(tally(s, imf, gov, { ...all(imf.members, "yes"), JPN: "no" }).status).toBe("passed");
    // JPN + CHN + DEU = 17.5%: no single one of them was decisive, so it is a plain failure.
    expect(tally(s, imf, gov, { ...all(imf.members, "yes"), JPN: "no", CHN: "no", DEU: "no" }).status).toBe("failed");
  });

  test("abstaining counts against: the bar is a share of all voting power", () => {
    const s = makeState();
    const imf = withImf(s);
    const board = bodyOf(imf, "board");
    // Only the quota holders (42%) vote yes, everyone else abstains: short of 50%.
    expect(tally(s, imf, board, all(Object.keys(QUOTAS), "yes")).status).toBe("failed");
    expect(tally(s, imf, board, all(imf.members, "yes")).status).toBe("passed");
  });

  test("a suspended member's weight drops out and the others scale up", () => {
    const s = makeState();
    const imf = withImf(s);
    imf.suspended.push("USA");
    const gov = bodyOf(imf, "governors");
    const w = voteWeights(s, imf, gov);
    expect(w.has("USA")).toBe(false);
    expect([...w.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    expect(tally(s, imf, gov, { ...all(imf.members, "yes"), USA: "no" }).status).toBe("passed");
  });

  test("the largest shareholders are always among the key voters the AI is asked about", () => {
    const s = makeState();
    const imf = withImf(s);
    const keys = keyVoters(s, imf, bodyOf(imf, "board"), loanRes("ARG"), new Set());
    for (const t of Object.keys(QUOTAS)) expect(keys).toContain(t);
  });
});

describe("loan votes", () => {
  test("lending is routine: neutral members vote yes, the borrower too, sanctioning members no", () => {
    const s = makeState();
    withImf(s);
    const r = loanRes("ARG", { proposer: "ARG" });
    expect(heuristicVote(s, "ARG", r)).toBe("yes");
    expect(heuristicVote(s, "NOR", r)).toBe("yes");
    s.sanctions.push({ id: "s1", target: "ARG", by: ["USA"], source: "test", since: s.date });
    expect(heuristicVote(s, "USA", r)).toBe("no");
  });
});

describe("loans", () => {
  test("a passed IMF loan lifts GDP and stability now and records the conditions", () => {
    const s = makeState();
    const imf = withImf(s);
    const arg = country(s, "ARG");
    arg.gdp = 600;
    arg.stability = 20;
    const note = enactResolution(s, imf, loanRes("ARG"), {}, s.date);
    const t = LOAN_TERMS.stabilization;
    expect(arg.gdp).toBeCloseTo(600 * (1 + t.gdp / 100), 2);
    expect(arg.stability).toBe(20 + t.stability);
    const loan = s.loans![0]!;
    expect(loan).toMatchObject({ orgId: "imf", borrower: "ARG", kind: "stabilization", amount: 24, date: s.date });
    expect(loan.programmeEnd > s.date && loan.repaidBy > loan.programmeEnd).toBe(true);
    expect(note).toContain("$24bn");
    expect(money(0.35)).toBe("$350m");
    expect(note).toContain("austerity");
    expect(activeLoan(s, "imf", "ARG")).toBe(loan);
  });

  test("a big economy hits the lender's cap and gets proportionally less", () => {
    const s = makeState();
    const imf = withImf(s);
    country(s, "USA").gdp = 30000;
    const offer = loanOffer(s, imf, "USA");
    expect(offer.amount).toBe(LOAN_TERMS.stabilization.cap);
    expect(offer.scale).toBeLessThan(0.1);
    expect(offer.gdp).toBeLessThan(0.2);
  });

  test("austerity while the programme runs, repayments after, nothing once repaid", () => {
    const s = makeState();
    const imf = withImf(s);
    const loan = grantLoan(s, imf, "ARG", s.date)!;
    const during = loanDrag(s, "ARG", addDays(s.date, 30));
    expect(during.growth).toBeLessThan(0);
    expect(during.stability).toBeLessThan(0);
    const repaying = loanDrag(s, "ARG", loan.programmeEnd);
    expect(repaying.growth).toBeCloseTo(LOAN_TERMS.stabilization.repayGrowth, 6);
    expect(repaying.stability).toBe(0);
    expect(loanDrag(s, "ARG", loan.repaidBy)).toEqual({ growth: 0, stability: 0 });

    // The simulation applies it: the borrower grows slower than an identical country without a loan.
    const twin = country(s, "URY");
    const arg = country(s, "ARG");
    Object.assign(twin, { gdp: arg.gdp, stability: arg.stability, warExhaustion: 0 });
    simTick(s, 90);
    expect(arg.gdp).toBeLessThan(twin.gdp);
    expect(arg.stability).toBeLessThan(twin.stability);
  });

  test("World Bank development loans speed growth while the money is spent", () => {
    const s = makeState();
    const wb = withImf(s, "development");
    grantLoan(s, wb, "KEN", s.date);
    expect(loanDrag(s, "KEN", addDays(s.date, 30)).growth).toBeGreaterThan(0);
  });

  test("one programme at a time, members only, no duplicate requests", () => {
    const s = makeState();
    const imf = withImf(s);
    imf.members = imf.members.filter((t) => t !== "PRK");
    expect(loanBlocker(s, imf, "ARG")).toBeNull();
    expect(loanBlocker(s, imf, "PRK")).toContain("not a member");
    s.resolutions.push(loanRes("ARG"));
    expect(loanBlocker(s, imf, "ARG")).toContain("already on the");
    s.resolutions = [];
    grantLoan(s, imf, "ARG", s.date);
    expect(loanBlocker(s, imf, "ARG")).toContain("programme running");
    expect(grantLoan(s, imf, "ARG", s.date)).toBeNull();
  });
});

describe("loan requests through the validator", () => {
  const propose = (target: string, proposer = target) =>
    ({ type: "proposeResolution" as const, orgId: "imf", resolutionType: "loan" as const, proposer, target, text: "Help" });

  test("an AI government can ask for itself; a loan needs a borrower", () => {
    const s = makeState();
    withImf(s);
    const e = ev([propose("ARG"), { ...propose("ARG"), target: undefined }]);
    applyEvent(s, MAP, e, ctx());
    expect(s.resolutions.filter((r) => r.type === "loan")).toHaveLength(1);
    expect(s.resolutions[0]).toMatchObject({ bodyId: "board", target: "ARG", status: "pending" });
    expect(e.rejected?.[0]?.reason).toContain("needs a target");
  });

  test("the AI cannot sign a player's country up for a loan", () => {
    const s = makeState();
    withImf(s);
    addHuman(s, "ARG");
    const e = ev([propose("ARG", "BRA")]);
    applyEvent(s, MAP, e, ctx());
    expect(s.resolutions).toHaveLength(0);
    expect(e.rejected?.[0]?.reason).toContain("player-controlled");
  });
});

describe("AI governments in crisis", () => {
  test("the worst-off AI members ask, at most two a turn, never players, not again right after a refusal", () => {
    const s = makeState();
    const imf = withImf(s);
    addHuman(s, "VEN");
    for (const [t, v] of [["VEN", 5], ["SDN", 10], ["HTI", 12], ["LBN", 20]] as const) country(s, t).stability = v;
    expect(loanCandidates(s).map((c) => c.tag)).toEqual(["SDN", "HTI"]);
    s.resolutions.push(loanRes("SDN", { status: "failed", turn: s.turn }));
    expect(loanCandidates(s).map((c) => c.tag)).toEqual(["HTI", "LBN"]);
    expect(loanCandidates(s)[0]!.org).toBe(imf);
  });
});
