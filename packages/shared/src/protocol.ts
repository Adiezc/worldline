// WebSocket + REST contract between apps/web and apps/server.
//
// REST (JSON):
//   GET  /api/health            → HealthResponse
//   POST /api/games             CreateGameRequest → { gameId }          (Authorization optional)
//   GET  /api/games/:id         → GameSummary
//   GET  /api/scenarios         → ScenarioInfo[]
//   GET  /api/scenarios/:id     → ScenarioSeed (full, used by the editor and menu previews)
//   POST /api/scenarios         CustomScenarioRequest → { id }          (Authorization required)
//   POST /api/auth/register     AuthRequest → AuthResponse
//   POST /api/auth/login        AuthRequest → AuthResponse
//   POST /api/auth/logout       (Authorization) → { ok: true }
//   GET  /api/me                (Authorization) → MeResponse
// Authorization header: `Bearer <token>`.
// WebSocket: /ws   (first client message must be `join`)

import type { CalendarEntry, EraTheme, Formable, ScenarioSeed } from "./game/scenario.ts";
import type {
  Chat, GameEvent, GameSettings, GameState, Order, OrderVerdict, Proposal, ResolutionType, TreatyType,
} from "./game/state.ts";

export const SERVER_PORT = 3001;

export interface HealthResponse {
  ok: true;
  ai: "openrouter" | "mock";
  /** Local daily cap; 0 = none (OpenRouter's own limits still apply). */
  dailyLimit: number;
  usedToday: number;
}

export interface CreateGameRequest {
  name: string;
  scenarioId?: string;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  date: string;
  description: string;
  theme: EraTheme;
  custom: boolean;
  author?: string;
  countries: number;
}

/** A scenario built in the editor: a full seed whose id/author the server assigns. */
export type CustomScenarioRequest = Omit<ScenarioSeed, "id" | "author">;

export interface AuthRequest {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: { id: string; username: string };
}

export interface MeResponse {
  user: { id: string; username: string };
  games: (GameSummary & { lastPlayed: number; myCountry: string | null })[];
}

export interface Snapshot {
  turn: number;
  date: string;
}

export interface GameSummary {
  id: string;
  name: string;
  date: string;
  turn: number;
  players: { name: string; country: string | null; connected: boolean }[];
}

/** What one player is allowed to see: their own orders and chats only. */
export type GameView = Omit<GameState, "orders" | "chats" | "events" | "jumpVotes"> & {
  orders: Order[];
  chats: Chat[];
  /** Most recent events (newest last); `eventCount` is the full total. */
  events: GameEvent[];
  eventCount: number;
  jumpVotes: Record<string, number>;
  you: { playerId: string; country: string | null; isHost: boolean };
  /** Scenario suggestions for the Form a Nation panel. */
  formables: Formable[];
  /** Scheduled real-world events from the current date onward. */
  calendar: CalendarEntry[];
  theme: EraTheme;
  /** Turns that can be rewound to (host only; empty for others). */
  snapshots: Snapshot[];
  /** Event ids of the last resolved turn the host may intervene at (empty once new orders exist). */
  intervenable: string[];
  ai: { provider: "openrouter" | "mock"; usedToday: number; dailyLimit: number };
};

export interface ResolutionResult {
  resolutionId: string;
  orgAbbrev: string;
  status: "passed" | "failed" | "vetoed";
  summary: string;
  text: string;
}

export interface TurnResult {
  turn: number;
  fromDate: string;
  toDate: string;
  events: GameEvent[];
  verdicts: OrderVerdict[];
  votes: ResolutionResult[];
}

export type ProposalDraft = Pick<Proposal, "kind" | "treatyType" | "members" | "terms" | "peace" | "cessions">;

export interface FormationRequest {
  name: string;
  concept: string;
  /** Countries whose territory would join (excluding the founder). */
  countries: string[];
  /** Optional explicit regions; defaults to all regions of founder + countries. */
  provinces?: number[];
  color: string;
  /** Optional generated flag for the new nation: "gen:<pattern>:<c1>,<c2>[,<c3>]". */
  flag?: string;
  government: string;
}

export type ClientMessage =
  | { t: "join"; gameId: string; playerId?: string; name: string; token?: string }
  | { t: "claim"; tag: string | null }
  | { t: "settings"; settings: Partial<GameSettings> }
  | { t: "start" }
  | { t: "orders"; orders: { id: string; text: string }[] }
  | { t: "ready"; ready: boolean }
  | { t: "jump"; days: number }
  | { t: "ai"; reqId: string; kind: "advisor" | "polish" | "brainstorm"; text?: string }
  | { t: "chat.open"; with: string[] }
  /** `speaker` asks a specific AI member of a group chat to answer. */
  | { t: "chat.send"; chatId: string; text: string; proposal?: ProposalDraft; speaker?: string }
  | { t: "proposal.respond"; chatId: string; proposalId: string; accept: boolean }
  | { t: "org.propose"; orgId: string; resolutionType: ResolutionType; target?: string; text: string }
  | { t: "org.vote"; resolutionId: string; vote: "yes" | "no" | "abstain" }
  | { t: "formation.assess"; reqId: string; request: FormationRequest }
  | { t: "formation.recheck"; reqId: string; formationId: string }
  | { t: "formation.proclaim"; formationId: string }
  | { t: "formation.consent"; formationId: string; accept: boolean }
  | { t: "formation.abandon"; formationId: string }
  /** Host: restore the game to the start of an earlier turn (from per-turn snapshots). */
  | { t: "rewind"; turn: number }
  /** Host: stop the last turn at this event; later events are discarded and the date set to it. */
  | { t: "intervene"; eventId: string };

export type ServerMessage =
  | { t: "welcome"; playerId: string; view: GameView }
  | { t: "view"; view: GameView }
  | { t: "progress"; stage: "director" | "votes" | "resolver" | "applying" | "consolidating" | "done"; detail?: string }
  | { t: "turn"; result: TurnResult }
  | { t: "ai"; reqId: string; kind: "advisor" | "polish" | "brainstorm" | "formation"; ok: boolean; text?: string; ideas?: string[]; formationId?: string; error?: string }
  | { t: "chat.typing"; chatId: string; from: string; stop?: boolean }
  | { t: "toast"; level: "info" | "warn" | "error"; text: string }
  | { t: "error"; message: string };

export type { TreatyType };
