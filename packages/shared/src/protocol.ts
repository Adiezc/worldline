// WebSocket + REST contract between apps/web and apps/server.
//
// REST (JSON):
//   GET  /api/health            → HealthResponse
//   POST /api/games             CreateGameRequest → { gameId }          (Authorization optional)
//   GET  /api/games/:id         → GameSummary
//   GET  /api/games/:id/export?player=<playerId>  → GameBundle as a file  (host's player id only)
//   POST /api/games/import      GameBundle (+ optional `name`) → { gameId }   (60 MB max)
//   GET  /api/scenarios         → ScenarioInfo[]
//   GET  /api/scenarios/:id     → ScenarioSeed (full, used by the editor and menu previews)
//   POST /api/scenarios         CustomScenarioRequest → { id }          (Authorization required)
//   POST /api/auth/register     AuthRequest → AuthResponse
//   POST /api/auth/login        AuthRequest → AuthResponse
//   POST /api/auth/logout       (Authorization) → { ok: true }
//   GET  /api/me                (Authorization) → MeResponse
// Authorization header: `Bearer <token>`.
// WebSocket: /ws   (first client message must be `join`)

import type { Operation } from "./game/operations.ts";
import type { CalendarEntry, EraTheme, Formable, ScenarioSeed } from "./game/scenario.ts";
import type {
  Chat, GameEvent, GameSettings, GameState, Order, OrderVerdict, Proposal, ResolutionType, StatKey, TreatyType,
} from "./game/state.ts";

export const SERVER_PORT = 3001;

export interface HealthResponse {
  ok: true;
  ai: "live" | "openrouter" | "mock";
  /** Configured AI backends, e.g. ["openrouter", "anthropic"]. */
  backends: string[];
  /** Local daily cap; 0 = none (OpenRouter's own limits still apply). */
  dailyLimit: number;
  usedToday: number;
}

export interface CreateGameRequest {
  name: string;
  scenarioId?: string;
}

/** A saved game as a single file: the state plus every per-turn snapshot (oldest first), so
 * rewind keeps working after import. Player ids are replaced by aliases on export. */
export interface GameBundle {
  format: "worldline-game/1";
  exportedAt: string;
  game: GameState;
  snapshots: GameState[];
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
  ai: { provider: "live" | "openrouter" | "mock"; backends: string[]; usedToday: number; dailyLimit: number };
  /** Battle plans of human allies (same side of a war) for this turn; enemies' stay hidden. */
  allyOperations: { country: string; orderId: string; operation: Operation }[];
};

export interface ResolutionResult {
  resolutionId: string;
  orgAbbrev: string;
  status: "passed" | "failed" | "vetoed";
  summary: string;
  text: string;
}

/** How a player's nation changed over a turn, as [start, end] pairs (for the results screen). */
export interface NationChange {
  tag: string;
  stats: Record<StatKey, [number, number]>;
  /** Regions it owns, its own regions held by others, and others' regions it holds. */
  regions: { owned: [number, number]; occupied: [number, number]; occupying: [number, number] };
  /** The largest relation changes, biggest first. */
  relations: { tag: string; from: number; to: number }[];
}

export interface TurnResult {
  turn: number;
  fromDate: string;
  toDate: string;
  events: GameEvent[];
  verdicts: OrderVerdict[];
  votes: ResolutionResult[];
  /** Player nations' changes over the turn (each player receives only their own). */
  nations: NationChange[];
}

export type ProposalDraft = Pick<Proposal, "kind" | "treatyType" | "members" | "terms" | "peace" | "cessions">;


export type ClientMessage =
  /** `secret` (from `welcome`) resumes the seat `playerId`; without it the client joins as someone new. */
  | { t: "join"; gameId: string; playerId?: string; secret?: string; name: string; token?: string }
  | { t: "claim"; tag: string | null }
  | { t: "settings"; settings: Partial<GameSettings> }
  | { t: "start" }
  | { t: "orders"; orders: { id: string; text: string; operation?: Operation; formable?: string }[] }
  | { t: "ready"; ready: boolean }
  | { t: "jump"; days: number }
  | { t: "ai"; reqId: string; kind: "advisor" | "polish" | "brainstorm"; text?: string }
  | { t: "chat.open"; with: string[] }
  /** `speaker` asks a specific AI member of a group chat to answer. */
  | { t: "chat.send"; chatId: string; text: string; proposal?: ProposalDraft; speaker?: string }
  | { t: "proposal.respond"; chatId: string; proposalId: string; accept: boolean }
  | { t: "org.propose"; orgId: string; resolutionType: ResolutionType; target?: string; text: string }
  | { t: "org.vote"; resolutionId: string; vote: "yes" | "no" | "abstain" }
  | { t: "project.abandon"; projectId: string }
  /** Host: restore the game to the start of an earlier turn (from per-turn snapshots). */
  | { t: "rewind"; turn: number }
  /** Host: stop the last turn at this event; later events are discarded and the date set to it. */
  | { t: "intervene"; eventId: string };

export type ServerMessage =
  | { t: "welcome"; playerId: string; secret: string; view: GameView }
  | { t: "view"; view: GameView }
  | { t: "progress"; stage: "director" | "votes" | "resolver" | "applying" | "consolidating" | "done"; detail?: string }
  | { t: "turn"; result: TurnResult }
  | { t: "ai"; reqId: string; kind: "advisor" | "polish" | "brainstorm"; ok: boolean; text?: string; ideas?: string[]; error?: string }
  | { t: "chat.typing"; chatId: string; from: string; stop?: boolean }
  /** An AI reply as it is being written; the view that follows carries the finished message. */
  | { t: "chat.stream"; chatId: string; from: string; text: string }
  | { t: "toast"; level: "info" | "warn" | "error"; text: string }
  | { t: "error"; message: string };

export type { TreatyType };
