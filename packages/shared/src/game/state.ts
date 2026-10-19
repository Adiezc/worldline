// Authoritative game state. Countries are addressed by tag in anything the AI sees and by
// index in map arrays (owners/controllers), so the renderer can stay index-based.

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

export type VotingRule = "consensus" | "simpleMajority" | "twoThirds" | "qualifiedMajority" | "vetoMajority";
export type OrgKind = "global" | "regional" | "military" | "economic" | "forum";
export type ResolutionType =
  | "sanction" | "condemn" | "peacekeeping" | "admitMember" | "suspendMember" | "expelMember"
  | "tradePolicy" | "authorizeForce" | "custom";

export interface OrgBody {
  id: string;
  name: string;
  /** Empty = all organisation members sit in this body. */
  seats: string[];
  /** Permanent members with a veto (vetoMajority). */
  veto?: string[];
  rule: VotingRule;
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
  effects: { tradeBloc?: boolean; mutualDefense?: boolean; forum?: boolean };
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
  | { type: "updateFormation"; country: string; index: number; met: boolean; text?: string };

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
  /** Map changes produced by this event, for client playback. */
  mapDiff?: { province: number; owner: number; controller: number }[];
  scope: "player" | "world";
}

export interface Order {
  id: string;
  playerId: string;
  country: string;
  text: string;
}

export interface OrderVerdict {
  orderId: string;
  outcome: "success" | "partial" | "fail";
  reason: string;
  /** Filled by the server: who gave the order and what it said, so verdicts survive reloads. */
  country?: string;
  text?: string;
}

export interface Player {
  id: string;
  name: string;
  country: string | null;
  isHost: boolean;
  connected: boolean;
  ready: boolean;
}

export interface ChatMessage {
  id: string;
  from: string; // country tag
  playerId?: string;
  text: string;
  at: string;
  proposal?: Proposal;
}

export interface Proposal {
  id: string;
  kind: "treaty" | "endWar" | "joinOrg" | "custom";
  treatyType?: TreatyType;
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
}

export interface FormationGoal {
  id: string;
  founder: string;
  name: string;
  concept: string;
  color: string;
  /** Generated flag ("gen:…") the new nation adopts; derived from `color` when missing. */
  flag?: string;
  government: string;
  /** Countries whose territory is involved. */
  countries: string[];
  provinces: number[];
  verdict: "achievable" | "notYet" | "unrealistic";
  requirements: { text: string; met: boolean; why: string }[];
  consent: { country: string; needed: boolean; willing: boolean | null; human: boolean; accepted?: boolean }[];
  suggestedPath: string;
  plan?: FormationPlan;
  lastChecked: number;
  status: "active" | "proclaimed" | "abandoned";
}

export interface FormationPlan {
  name: string;
  orgHandling: string;
  reactions: { a: string; b: string; delta: number }[];
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
  formations: FormationGoal[];
  players: Player[];
  /** Pending orders this turn, keyed by player id. */
  orders: Record<string, Order[]>;
  /** Per-player jump votes when voting is enabled. */
  jumpVotes: Record<string, number>;
  lastVerdicts: OrderVerdict[];
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
