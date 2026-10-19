// Contract between the game engine (src/engine/*, src/ai/*) and the networking layer
// (src/index.ts, src/rooms.ts, src/db.ts). The engine never touches sockets; the rooms layer
// never builds prompts. All functions mutate the passed GameState in place.

import type {
  FormationGoal, FormationRequest, GameState, MapIndex, ProposalDraft, ResolutionType, ScenarioSeed, TurnResult,
} from "@worldline/shared";

export interface AiCallUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
}

export interface AiRequest {
  /** Which feature is calling; the mock provider uses it to synthesise a valid response. */
  kind: "director" | "resolver" | "votes" | "consolidation" | "chat" | "advisor" | "polish" | "brainstorm" | "assessor";
  system: string;
  user: string;
  /** Zod schema name from @worldline/shared (e.g. "ResolverOutput"); omitted for plain text. */
  schemaName?: string;
  jsonSchema?: unknown;
  /** Structured inputs the mock provider can use to produce semantically valid output. */
  mockContext?: unknown;
  maxTokens?: number;
  temperature?: number;
}

export interface AiResponse {
  text: string;
  usage: AiCallUsage;
}

export interface AiProvider {
  readonly name: "openrouter" | "mock";
  complete(req: AiRequest, settings: { modelChain: string[]; reasoningEffort: string }): Promise<AiResponse>;
  /** Requests made today and the daily cap (OpenRouter free tier: 50, or 1000 with credits). */
  quota(): { usedToday: number; dailyLimit: number };
}

export interface EngineDeps {
  map: MapIndex;
  seed: ScenarioSeed;
  ai: AiProvider;
  onProgress?: (stage: "director" | "votes" | "resolver" | "applying" | "consolidating" | "done", detail?: string) => void;
}

export interface EngineApi {
  createGame(opts: { id: string; name: string; seed: ScenarioSeed }): GameState;
  /** Resolve the current turn: director → votes → resolver → validate/apply → simTick → consolidation. */
  runTurn(state: GameState, deps: EngineDeps): Promise<TurnResult>;
  /** Human message to a chat; appends the human message and, for AI members, their reply. */
  sendChat(state: GameState, deps: EngineDeps, opts: { chatId: string; playerId: string; text: string; proposal?: ProposalDraft }): Promise<void>;
  openChat(state: GameState, opts: { from: string; with: string[] }): string;
  respondProposal(state: GameState, opts: { chatId: string; proposalId: string; byTag: string; accept: boolean }): { ok: boolean; message: string };
  advisor(state: GameState, deps: EngineDeps, opts: { country: string; question?: string }): Promise<string>;
  polish(state: GameState, deps: EngineDeps, opts: { country: string; text: string }): Promise<string>;
  brainstorm(state: GameState, deps: EngineDeps, opts: { country: string }): Promise<string[]>;
  proposeResolution(state: GameState, opts: { orgId: string; proposer: string; resolutionType: ResolutionType; target?: string; text: string }): { ok: boolean; message: string };
  castVote(state: GameState, opts: { resolutionId: string; country: string; vote: "yes" | "no" | "abstain" }): { ok: boolean; message: string };
  assessFormation(state: GameState, deps: EngineDeps, opts: { founder: string; request: FormationRequest } | { formationId: string }): Promise<FormationGoal>;
  consentFormation(state: GameState, opts: { formationId: string; country: string; accept: boolean }): { ok: boolean; message: string };
  proclaimFormation(state: GameState, deps: EngineDeps, opts: { formationId: string }): Promise<{ ok: boolean; problems: string[]; event?: TurnResult["events"][number] }>;
  abandonFormation(state: GameState, opts: { formationId: string }): void;
}
