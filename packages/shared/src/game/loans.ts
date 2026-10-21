// Lending by international organisations (the IMF, the World Bank). A passed loan resolution gives
// the borrower money and calm now and conditions later; the rules decide both, never the model.

import { addDays, countryByTag, humanTags, nextId, type GameState, type Loan, type LoanKind, type Organization } from "./state.ts";

export interface LoanTerms {
  /** Loan size as a share of the borrower's GDP, and the most an organisation lends at once (USD bn). */
  size: number;
  cap: number;
  /** On approval: GDP in percent, stability in points. */
  gdp: number;
  stability: number;
  /** Programme length, and what it does while it runs: growth in points a year, and the stability target. */
  programmeMonths: number;
  programmeGrowth: number;
  programmeStability: number;
  /** Years of repayment after the programme, and their drag on growth (points a year). */
  repayYears: number;
  repayGrowth: number;
}

export const LOAN_TERMS: Record<LoanKind, LoanTerms> = {
  // IMF stand-by arrangement: cash and calmer markets now, a year of austerity, three years of repayments.
  stabilization: {
    size: 0.04, cap: 60, gdp: 2, stability: 6,
    programmeMonths: 12, programmeGrowth: -0.6, programmeStability: -6, repayYears: 3, repayGrowth: -0.7,
  },
  // World Bank project lending: a small lift now, investment paying off while it is spent, long cheap repayments.
  development: {
    size: 0.02, cap: 15, gdp: 0.8, stability: 2,
    programmeMonths: 24, programmeGrowth: 0.5, programmeStability: 0, repayYears: 5, repayGrowth: -0.3,
  },
};

/** AI governments at or below this stability ask a lender for help. */
export const LOAN_CRISIS_STABILITY = 25;
/** Turns before a refused borrower asks the same organisation again. */
export const LOAN_RETRY_TURNS = 4;
/** Most loan requests AI governments table per turn. */
export const MAX_LOAN_REQUESTS = 2;

export const lenderKind = (org: Organization): LoanKind => org.effects.lender ?? "stabilization";

/** A loan whose programme still runs (one at a time per organisation and borrower). */
export function activeLoan(state: Pick<GameState, "loans" | "date">, orgId: string, tag: string) {
  return (state.loans ?? []).find((l) => l.orgId === orgId && l.borrower === tag && l.programmeEnd > state.date);
}

/** Why `tag` cannot ask `org` for a loan now, or null if it can. */
export function loanBlocker(state: Pick<GameState, "loans" | "date" | "resolutions">, org: Organization, tag: string): string | null {
  if (!org.powers.includes("loan")) return `The ${org.abbrev} does not lend.`;
  if (!org.members.includes(tag)) return `${tag} is not a member of the ${org.abbrev}.`;
  if (org.suspended.includes(tag)) return `${tag} is suspended from the ${org.abbrev}.`;
  const active = activeLoan(state, org.id, tag);
  if (active) return `${tag} already has an ${org.abbrev} programme running until ${active.programmeEnd}.`;
  if (state.resolutions.some((r) => r.status === "pending" && r.orgId === org.id && r.type === "loan" && r.target === tag)) {
    return `A loan for ${tag} is already on the ${org.abbrev} agenda.`;
  }
  return null;
}

/**
 * What the loan would be today. Big economies hit the lender's cap, so their loan is a smaller share
 * of GDP and its effects shrink in proportion (`scale`).
 */
export function loanOffer(state: Pick<GameState, "countries">, org: Organization, tag: string) {
  const kind = lenderKind(org);
  const terms = LOAN_TERMS[kind];
  const gdp = state.countries.find((c) => c.tag === tag)?.gdp ?? 0;
  const amount = r2(Math.max(0.01, Math.min(terms.cap, gdp * terms.size)));
  const scale = gdp > 0 ? Math.min(1, amount / (gdp * terms.size)) : 1;
  return { kind, terms, amount, scale, gdp: r2(terms.gdp * scale), stability: r2(terms.stability * scale) };
}

/** Pay out a passed loan: the immediate relief now, the conditions through `state.loans` and simTick. */
export function grantLoan(state: GameState, org: Organization, tag: string, date: string): Loan | null {
  const k = countryByTag(state, tag);
  if (!k?.alive || !org.members.includes(tag) || activeLoan(state, org.id, tag)) return null;
  const offer = loanOffer(state, org, tag);
  k.gdp = r2(k.gdp * (1 + offer.gdp / 100));
  k.stability = r2(Math.min(100, k.stability + offer.stability));
  const programmeEnd = addMonths(date, offer.terms.programmeMonths);
  const loan: Loan = {
    id: nextId(state, "l"), orgId: org.id, borrower: tag, kind: offer.kind, amount: offer.amount, scale: r2(offer.scale),
    turn: state.turn, date, programmeEnd, repaidBy: addMonths(programmeEnd, offer.terms.repayYears * 12),
  };
  (state.loans ??= []).push(loan);
  return loan;
}

/** "$24bn", "$350m". */
export const money = (bn: number) => (bn >= 1 ? `$${Math.round(bn * 10) / 10}bn` : `$${Math.max(1, Math.round(bn * 1000))}m`);

/** One line for the news and the AI: the money, what it did now, and what comes later. */
export function describeLoan(loan: Loan, abbrev: string) {
  const later = loan.kind === "stabilization"
    ? `Conditions: austerity until ${loan.programmeEnd} (weaker growth, unrest), then repayments slow growth until ${loan.repaidBy}.`
    : `The money is spent on projects until ${loan.programmeEnd} (faster growth), then repayments slow growth slightly until ${loan.repaidBy}.`;
  return `The ${abbrev} lends ${money(loan.amount)}. ${later}`;
}

/**
 * What a country's loans do to its growth (points a year) and stability target right now: the
 * programme while it runs, repayments after, scaled like the loan was when granted.
 */
export function loanDrag(state: GameState, tag: string, date: string) {
  let growth = 0, stability = 0;
  for (const l of state.loans ?? []) {
    if (l.borrower !== tag || date >= l.repaidBy) continue;
    const t = LOAN_TERMS[l.kind];
    if (date < l.programmeEnd) {
      growth += t.programmeGrowth * l.scale;
      stability += t.programmeStability * l.scale;
    } else growth += t.repayGrowth * l.scale;
  }
  return { growth, stability };
}

/**
 * AI governments in crisis that should ask a lender for help this turn, worst first: members of a
 * lending organisation with stability at or below LOAN_CRISIS_STABILITY, no programme running, no
 * request pending and no refusal in the last few turns. Emergency (IMF) lenders come first.
 */
export function loanCandidates(state: GameState) {
  const humans = humanTags(state);
  const lenders = state.organizations
    .filter((o) => o.powers.includes("loan"))
    .sort((a, b) => Number(lenderKind(a) !== "stabilization") - Number(lenderKind(b) !== "stabilization"));
  const out: { tag: string; org: Organization }[] = [];
  const inCrisis = state.countries
    .filter((k) => k.alive && !humans.has(k.tag) && k.stability <= LOAN_CRISIS_STABILITY)
    .sort((a, b) => a.stability - b.stability);
  for (const k of inCrisis) {
    const org = lenders.find((o) => !loanBlocker(state, o, k.tag) && !state.resolutions.some((r) =>
      r.orgId === o.id && r.type === "loan" && r.target === k.tag && state.turn - r.turn < LOAN_RETRY_TURNS));
    if (org) out.push({ tag: k.tag, org });
    if (out.length >= MAX_LOAN_REQUESTS) break;
  }
  return out;
}

const addMonths = (date: string, months: number) => addDays(date, Math.round(months * 30.44));
const r2 = (v: number) => Math.round(v * 100) / 100;
