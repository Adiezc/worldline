// Authoritative game state. Countries are addressed by tag in anything the AI sees and by
// index in map arrays (owners/controllers), so the renderer can stay index-based.
import type { Operation } from "./operations.ts";
import type { CalendarEntry } from "./scenario.ts";

export type Difficulty = "easy" | "normal" | "hard" | "realistic";
export type AiBehaviour = "plausible" | "dynamic";
export type Phase = "lobby" | "orders" | "resolving";
export type StatKey = "gdp" | "population" | "stability" | "military" | "warExhaustion";

export interface Country {
  tag: string;
  name: string;
  color: string;
  government: string;
  leader: string;
  /** USD billions. */
  gdp: number;
  /** Millions. */
  population: number;
  /** 0–100. */
  stability: number;
  /** Abstract strength index, 0–100 (log-scaled from spending and manpower). */
  military: number;
  /** 0–100. */
  warExhaustion: number;
  agenda: { persona: string; goals: string[] };
  /** False once annexed or merged away. */
  alive: boolean;
  /** Nuclear-armed; informs AI deterrence reasoning. */
  nuclear?: boolean;
  /** Turn its government last collapsed (see collapse.ts), so a collapse can't repeat right away. */
  collapsedTurn?: number;
  /** Capital city: its map position (px) and the region it lies in. null = none (uninhabited entries). */
  capital?: { name: string; x: number; y: number; province: number } | null;
  /**
   * Flag reference, rendered by the client:
   *   "iso:fr"                    real flag by ISO 3166-1 alpha-2 code
   *   "hist:<id>"                 historical flag shipped with the client (e.g. "hist:su")
   *   "gen:<pattern>:<c1>,<c2>[,<c3>]"  generated flag; pattern = vertical | horizontal |
   *                               bicolor-v | bicolor-h | nordic | canton | diagonal | triband-star
   * Missing → the client generates one from the country colour.
   */
  flag?: string;
}

export type TreatyType = "alliance" | "defensive" | "trade" | "nonaggression" | "vassal" | "customs_union";

export interface Treaty {
  id: string;
  type: TreatyType;
  members: string[];
  name?: string;
  since: string;
}

export interface War {
  id: string;
  name: string;
  attackers: string[];
  defenders: string[];
  goal: string;
  since: string;
  /** Countries obliged (by alliance or mutual defence) to join, awaiting their decision. */
  calls?: { tag: string; via: string; since: number }[];
}

export type VotingRule = "consensus" | "simpleMajority" | "twoThirds" | "qualifiedMajority" | "vetoMajority" | "weighted";
export type OrgKind = "global" | "regional" | "military" | "economic" | "forum";
export type ResolutionType =
  | "sanction" | "condemn" | "peacekeeping" | "admitMember" | "suspendMember" | "expelMember"
  | "tradePolicy" | "authorizeForce" | "loan" | "custom";

export interface OrgBody {
  id: string;
  name: string;
  /** Empty = all organisation members sit in this body. */
  seats: string[];
  /** Permanent members with a veto (vetoMajority). */
  veto?: string[];
  rule: VotingRule;
  /**
   * weighted: share of the body's whole voting power that must vote yes (0.85 = 85%; default 0.5).
   * Abstaining counts against, as in the IMF and World Bank.
   */
  threshold?: number;
  /** Resolution types decided in this body; the first body handles anything unlisted. */
  handles?: ResolutionType[];
}

export interface Organization {
  id: string;
  abbrev: string;
  name: string;
  kind: OrgKind;
  members: string[];
  observers: string[];
  candidates: { tag: string; since: string; note?: string }[];
  suspended: string[];
  bodies: OrgBody[];
  powers: ResolutionType[];
  effects: { tradeBloc?: boolean; mutualDefense?: boolean; forum?: boolean; lender?: LoanKind };
  /**
   * Voting power in percent for weighted bodies (IMF quotas, World Bank shares). Members not listed
   * share what is left, mostly by GDP (see voteWeights).
   */
  quotas?: Record<string, number>;
  /** 0–100. */
  cohesion: number;
  founded?: string;
}

export interface Resolution {
  id: string;
  orgId: string;
  bodyId: string;
  type: ResolutionType;
  proposer: string;
  target?: string;
  text: string;
  turn: number;
  status: "pending" | "passed" | "failed" | "vetoed";
  votes?: Record<string, "yes" | "no" | "abstain">;
  reasons?: Record<string, string>;
}

/** How an organisation lends: IMF-style emergency programmes or World Bank-style development loans. */
export type LoanKind = "stabilization" | "development";

/** A loan an organisation granted by resolution. Its terms are fixed by the rules (see loans.ts). */
export interface Loan {
  id: string;
  orgId: string;
  borrower: string;
  kind: LoanKind;
  /** USD billions. */
  amount: number;
  /** Share of the standard terms' effects (below 1 when the lender's cap made the loan small for the economy). */
  scale: number;
  /** Turn and date it was approved. */
  turn: number;
  date: string;
  /** Conditions (austerity, or disbursement for development loans) apply until this date. */
  programmeEnd: string;
  /** Repayments weigh on growth from programmeEnd until this date. */
  repaidBy: string;
}

export interface Sanction {
  id: string;
  target: string;
  by: string[];
  source: string;
  since: string;
}

export type Effect =
  | { type: "transferProvinces"; provinces: number[]; from: string; to: string }
  | { type: "setController"; provinces: number[]; controller: string }
  | { type: "statDelta"; country: string; stat: StatKey; delta: number }
  | { type: "relationDelta"; a: string; b: string; delta: number }
  | { type: "createTreaty"; treatyType: TreatyType; members: string[]; name?: string }
  | { type: "endTreaty"; treatyId: string }
  | { type: "declareWar"; attackers: string[]; defenders: string[]; goal: string; name?: string }
  | { type: "joinWar"; warId: string; country: string; side: "attackers" | "defenders" }
  | { type: "makePeace"; warId: string; terms: string }
  | { type: "spawnCountry"; tag?: string; name: string; government: string; leader: string; provinces: number[]; color?: string; flag?: string }
  | { type: "annexCountry"; target: string; by: string }
  | { type: "changeLeader"; country: string; leader: string; government?: string }
  | { type: "joinOrg"; orgId: string; country: string }
  | { type: "leaveOrg"; orgId: string; country: string }
  | { type: "createOrg"; abbrev: string; name: string; kind: OrgKind; members: string[]; rule: VotingRule; tradeBloc?: boolean; mutualDefense?: boolean }
  | { type: "proposeResolution"; orgId: string; resolutionType: ResolutionType; proposer: string; target?: string; text: string }
  | { type: "applyToOrg"; orgId: string; country: string }
  | { type: "imposeSanctions"; target: string; by: string[] }
  | { type: "liftSanctions"; target: string; by: string[] }
  | { type: "updateAgenda"; country: string; goals: string[] }
  | { type: "addClaim"; claimant: string; provinces: number[]; note: string }
  | { type: "dropClaim"; claimant: string; provinces?: number[] }
  | { type: "scheduleEvent"; country: string; date: string; kind: CalendarEntry["kind"]; title: string }
  | { type: "cancelScheduled"; id: string }
  | { type: "startProject"; country: string; name: string; goal: string; months: number; milestones: string[] }
  | { type: "advanceProject"; projectId: string; progress: number; milestone?: number; note?: string }
  | { type: "endProject"; projectId: string; outcome: "completed" | "failed" | "abandoned" }
  /** A nuclear detonation. The engine works out the casualties and the world's reaction (see nuclear.ts). */
  | { type: "nuclearStrike"; by: string; target: string; province?: number; scale: NuclearScale };

export type NuclearScale = "tactical" | "strategic";

/** A nuclear detonation that happened, kept for the AI's memory, fallout and escalation. */
export interface NuclearStrike {
  id: string;
  turn: number;
  date: string;
  by: string;
  target: string;
  province: number;
  scale: NuclearScale;
}

/**
 * A long-running national effort (a programme, megaproject, reform or build-up) that spans many
 * turns. The resolver starts it from an order and advances it period by period; whether it is
 * overdue is derived from the game date (see projectStatus), never stored.
 */
export interface Project {
  id: string;
  country: string;
  name: string;
  /** What finishing achieves, concretely. */
  goal: string;
  started: string;
  /** Target completion date. */
  due: string;
  /** 0–100. */
  progress: number;
  status: "active" | "completed" | "failed" | "abandoned";
  /** `done`: the date it was reached. */
  milestones: { text: string; done?: string }[];
  /** Latest one-line progress note. */
  note?: string;
  ended?: string;
}

export interface GameEvent {
  id: string;
  turn: number;
  date: string;
  headline: string;
  body: string;
  countries: string[];
  /** Order ids that caused this event (player-driven), empty for world events. */
  causes: string[];
  effects: Effect[];
  /** Effects the validator rejected, with reasons (kept for debugging and the AI's memory). */
  rejected?: { effect: Effect; reason: string }[];
  /** Effects that were applied, but scaled down to the per-turn caps. */
  clamped?: { effect: Effect; reason: string }[];
  /** Id of the calendar item (an election, a referendum) this event holds. */
  holds?: string;
  /** Map changes produced by this event, for client playback. */
  mapDiff?: { province: number; owner: number; controller: number }[];
  scope: "player" | "world";
}

export interface Order {
  id: string;
  playerId: string;
  country: string;
  text: string;
  /** A battle plan drawn on the map (offensive arrow or hold line). */
  operation?: Operation;
  /** Proclaim this formable nation (id) when the turn resolves. */
  formable?: string;
}

export interface OrderVerdict {
  orderId: string;
  outcome: "success" | "partial" | "fail";
  reason: string;
  /** Filled by the server: who gave the order and what it said, so verdicts survive reloads. */
  country?: string;
  text?: string;
  /** The order's battle plan, so the map can show how far it got. */
  operation?: Operation;
}

export interface Player {
  id: string;
  name: string;
  country: string | null;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
  /** Proves a returning client owns this seat (ids are public). Server-side; only its owner gets it. */
  secret?: string;
}

export interface ChatMessage {
  id: string;
  from: string; // country tag
  playerId?: string;
  text: string;
  at: string;
  proposal?: Proposal;
  /** Sent by an AI government on its own initiative, not as a reply. */
  unprompted?: boolean;
}

export type PeaceTerms = "white" | "keep_occupied";

/** Land a peace deal hands over by name, whether or not the receiver occupies it. */
export interface ProposalCession {
  from: string;
  to: string;
  provinces: number[];
}

export interface Proposal {
  id: string;
  kind: "treaty" | "endWar" | "joinOrg" | "custom";
  treatyType?: TreatyType;
  /** endWar only: "white" returns all occupied land; "keep_occupied" cedes it to whoever holds it. */
  peace?: PeaceTerms;
  /** endWar only: regions picked by the proposer that change hands on top of the base terms. */
  cessions?: ProposalCession[];
  members: string[];
  terms: string;
  status: "open" | "accepted" | "rejected";
  /** Tags that still need to accept (humans). AI acceptance is decided when proposed. */
  awaiting: string[];
}

export interface Chat {
  id: string;
  /** Country tags in the conversation. */
  members: string[];
  messages: ChatMessage[];
  /** Turn of the last message, so salience can treat active chat partners as engaged. */
  lastTurn: number;
  /**
   * Running record of the whole conversation (asks, offers, promises, refusals), rewritten by the
   * AI side with each reply, so long negotiations stay consistent after old messages scroll out.
   */
  summary?: string;
}

/**
 * A date a government set during the game (an election, a referendum, a summit), kept so the
 * resolver holds it when the day comes. Scenario calendar entries get ids too (`cal<index>`).
 */
export interface ScheduledItem extends CalendarEntry {
  id: string;
  /** Game date it was set on. */
  since: string;
}

/** A country's claim on regions another country holds (a disputed territory). */
export interface Claim {
  id: string;
  claimant: string;
  provinces: number[];
  /** One line of context: the basis of the claim and where it stands. */
  note: string;
  since: string;
}

export interface GameSettings {
  difficulty: Difficulty;
  aiBehaviour: AiBehaviour;
  /** Default jump in days; 0 = until the next major event. */
  jumpDays: number;
  /** Seconds for the orders phase in multiplayer; 0 = no timer. */
  turnTimer: number;
  modelChain: string[];
  reasoningEffort: "none" | "low" | "medium" | "high";
  /** Merge the Director into the resolver call to halve requests. */
  economyMode: boolean;
  jumpVoting: boolean;
}

export interface UsageStats {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens the provider served from its cache (older saves lack it). */
  cachedTokens?: number;
  lastModel?: string;
  failures: number;
}

export interface GameState {
  id: string;
  scenarioId: string;
  name: string;
  date: string;
  turn: number;
  phase: Phase;
  settings: GameSettings;
  countries: Country[];
  owners: number[];
  controllers: number[];
  relations: Record<string, number>;
  treaties: Treaty[];
  wars: War[];
  sanctions: Sanction[];
  organizations: Organization[];
  resolutions: Resolution[];
  events: GameEvent[];
  memory: { upToTurn: number; text: string }[];
  chats: Chat[];
  /** Formable nations already proclaimed (ids). */
  formed?: string[];
  /** Territorial claims on land others hold. Informational: shown on the map and given to the AI. */
  claims?: Claim[];
  /** Dates governments set during the game, until they are held (older saves may lack it). */
  schedule?: ScheduledItem[];
  /** Every nuclear detonation so far (older saves lack it). */
  nuclearStrikes?: NuclearStrike[];
  /**
   * Governments that collapsed and whose successor the resolver has yet to name (a changeLeader for
   * the country clears it). `previous` is the fallen leader, for the narrative.
   */
  successions?: { country: string; previous: string; since: number }[];
  /** Turn a collapsing nation last asked a player for terms, keyed "AAA>BBB", so offers don't repeat every turn. */
  surrenderOffers?: Record<string, number>;
  /** Long-running national efforts, active and finished (older saves lack it). */
  projects?: Project[];
  /** Loans organisations granted, kept until repaid (older saves lack it). */
  loans?: Loan[];
  /** Power ranking (tags, strongest first) as each recent turn began resolving (see ranking.ts; older saves lack it). */
  rankHistory?: { turn: number; order: string[] }[];
  players: Player[];
  /** Pending orders this turn, keyed by player id. */
  orders: Record<string, Order[]>;
  /** Per-player jump votes when voting is enabled. */
  jumpVotes: Record<string, number>;
  lastVerdicts: OrderVerdict[];
  /** Every past verdict with its turn and date (older saves may lack it). */
  verdictLog?: (OrderVerdict & { turn: number; date: string })[];
  turnDeadline?: number;
  usage: UsageStats;
  /** Rotating offset for background (tier C) countries. */
  rotation: number;
  seq: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  difficulty: "normal",
  aiBehaviour: "plausible",
  jumpDays: 30,
  turnTimer: 0,
  // Free models first, fastest first (a benchmarked turn: MiniMax ~27 s, Nemotron 3 Super ~53 s,
  // Nemotron 3.5 VL ~100 s); a cheap paid model last so a turn never fails when the free ones are busy.
  modelChain: [
    "minimax/minimax-m3.1-flash:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "nvidia/nemotron-3.5-super-vl:free",
    "deepseek/deepseek-v4.1-flash-1017",
  ],
  // Free models are slow; thinking roughly doubles turn time. Hosts can opt in from the lobby.
  reasoningEffort: "none",
  economyMode: false,
  jumpVoting: false,
};

export const relKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const getRelation = (s: GameState, a: string, b: string) => (a === b ? 100 : s.relations[relKey(a, b)] ?? 0);

export const nextId = (s: GameState, prefix: string) => `${prefix}${(++s.seq).toString(36)}`;

export const countryIndex = (s: GameState, tag: string) => s.countries.findIndex((c) => c.tag === tag);
export const countryByTag = (s: GameState, tag: string) => s.countries.find((c) => c.tag === tag);

export function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

export function warsOf(s: GameState, tag: string) {
  return s.wars.filter((w) => w.attackers.includes(tag) || w.defenders.includes(tag));
}

export function atWar(s: GameState, a: string, b: string) {
  return s.wars.some(
    (w) => (w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a)),
  );
}

export function humanTags(s: GameState) {
  return new Set(s.players.map((p) => p.country).filter((c): c is string => !!c));
}

export function provincesOf(s: GameState, tag: string) {
  const idx = countryIndex(s, tag);
  const out: number[] = [];
  for (let id = 1; id < s.owners.length; id++) if (s.owners[id] === idx) out.push(id);
  return out;
}
