// Contract between the game engine (src/engine/*, src/ai/*) and the networking layer
// (src/index.ts, src/rooms.ts, src/db.ts). The engine never touches sockets; the rooms layer
// never builds prompts. All functions mutate the passed GameState in place.

import type {
  GameEvent, GameState, MapIndex, ProposalDraft, ResolutionType, ScenarioSeed, TurnResult,
} from "@worldline/shared";
import type { DirectorPlan } from "./director.ts";

export interface AiCallUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** Prompt tokens served from the provider's cache (cheaper and faster), when it reports them. */
  cachedTokens?: number;
}

export interface AiRequest {
  /** Which feature is calling; the mock provider uses it to synthesise a valid response. */
  kind: "director" | "resolver" | "votes" | "consolidation" | "chat" | "advisor" | "polish" | "brainstorm";
  system: string;
  user: string;
  /** Zod schema name from @worldline/shared (e.g. "ResolverOutput"); omitted for plain text. */
  schemaName?: string;
  jsonSchema?: unknown;
  /** Structured inputs the mock provider can use to produce semantically valid output. */
  mockContext?: unknown;
  /**
   * `user[0, cacheUpto)` is the same from one turn to the next. Providers with explicit prompt
   * caching put a cache breakpoint there; the system prompt is always treated as cacheable.
   */
  cacheUpto?: number;
  maxTokens?: number;
  temperature?: number;
  /** "setting" uses the host's reasoning effort; "off" disables reasoning for speed (the default). */
  reasoning?: "setting" | "off";
}

/** One provider round trip, as recorded by providers that keep a call log (OpenRouter). */
export interface AiCallInfo {
  kind: AiRequest["kind"];
  /** Model that answered (or the first in the chain when the call failed). */
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  ok: boolean;
  /** HTTP attempts, including retries and the structured-output fallback. */
  attempts: number;
  error?: string;
}

export interface AiResponse {
  text: string;
  usage: AiCallUsage;
}

export interface AiProvider {
  /** "live" = the router over configured backends (see ai/router.ts). */
  readonly name: "live" | "openrouter" | "mock";
  /** Backends with a key configured, e.g. ["openrouter", "anthropic"]; empty for the mock. */
  readonly configured?: readonly string[];
  complete(req: AiRequest, settings: { modelChain: string[]; reasoningEffort: string }): Promise<AiResponse>;
  /** Requests made today and the daily cap (OpenRouter free tier: 50, or 1000 with credits). */
  quota(): { usedToday: number; dailyLimit: number };
}

export interface EngineDeps {
  map: MapIndex;
  seed: ScenarioSeed;
  ai: AiProvider;
  /** A Director plan started when the turn opened; used if it matches the turn, date and jump. */
  directorPlan?: { turn: number; date: string; days: number; plan: Promise<DirectorPlan | null> };
  onProgress?: (stage: "director" | "votes" | "resolver" | "applying" | "consolidating" | "done", detail?: string) => void;
  /** Output that failed validation: "invalid" before the repair round, then "repaired" or "failed". */
  onValidation?: (e: { kind: AiRequest["kind"]; outcome: "invalid" | "repaired" | "failed"; error: string }) => void;
}

export interface InterveneResult {
  /** Events of the interrupted turn that still happened (chronological, with fresh mapDiffs). */
  events: GameEvent[];
  /** How many later events were discarded. */
  cut: number;
  /** The new current date (the chosen event's). */
  date: string;
}

export interface EngineApi {
  /** Start the AI governments' planning for the current turn ahead of time (see EngineDeps.directorPlan). */
  planDirector(state: GameState, deps: EngineDeps): { turn: number; date: string; days: number; plan: Promise<DirectorPlan | null> };
  createGame(opts: { id: string; name: string; seed: ScenarioSeed }): GameState;
  /** Resolve the current turn: director → votes → resolver → validate/apply → simTick → consolidation. */
  runTurn(state: GameState, deps: EngineDeps): Promise<TurnResult>;
  /** Human message to a chat; appends the human message and, for AI members, their reply. */
  /** `speaker` picks which AI member answers in a group chat (default: the most relevant one). */
  sendChat(state: GameState, deps: EngineDeps, opts: { chatId: string; playerId: string; text: string; proposal?: ProposalDraft; speaker?: string }): Promise<void>;
  openChat(state: GameState, opts: { from: string; with: string[] }): string;
  respondProposal(state: GameState, opts: { chatId: string; proposalId: string; byTag: string; accept: boolean; map?: MapIndex }): { ok: boolean; message: string };
  advisor(state: GameState, deps: EngineDeps, opts: { country: string; question?: string }): Promise<string>;
  polish(state: GameState, deps: EngineDeps, opts: { country: string; text: string }): Promise<string>;
  brainstorm(state: GameState, deps: EngineDeps, opts: { country: string }): Promise<string[]>;
  proposeResolution(state: GameState, opts: { orgId: string; proposer: string; resolutionType: ResolutionType; target?: string; text: string }): { ok: boolean; message: string };
  castVote(state: GameState, opts: { resolutionId: string; country: string; vote: "yes" | "no" | "abstain" }): { ok: boolean; message: string };
  /** The player drops one of its own projects at once. */
  abandonProject(state: GameState, opts: { country: string; projectId: string; map: MapIndex }): { ok: boolean; message: string };
  /** Rebuild the last resolved turn from its pre-turn snapshot, stopping at `eventId`. */
  intervene(state: GameState, deps: EngineDeps, opts: { snapshot: GameState; eventId: string }): InterveneResult;
}
