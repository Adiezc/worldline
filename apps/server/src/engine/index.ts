// Engine entry point: the EngineApi implementation the rooms layer uses.

import type { EngineApi } from "./api.ts";
import { advisor, brainstorm, polish } from "./advisor.ts";
import { openChat, reactToDecision, respondProposal, sendChat } from "./chat.ts";
import { createGame } from "./game.ts";
import { intervene } from "./intervene.ts";
import { runTurn, startDirectorPlan } from "./pipeline.ts";
import { abandonProject } from "./projects.ts";
import { castVote, proposeResolution } from "./votes.ts";

export const engine: EngineApi = {
  createGame,
  runTurn,
  sendChat,
  openChat,
  respondProposal,
  reactToDecision,
  advisor,
  polish,
  brainstorm,
  proposeResolution,
  castVote,
  intervene,
  abandonProject,
  planDirector: startDirectorPlan,
};

export {
  advisor, brainstorm, castVote, createGame, openChat, polish, proposeResolution, respondProposal, runTurn, sendChat, intervene,
};
export { INTERRUPTED, turnEvents } from "./intervene.ts";
export { jumpDays, startDirectorPlan } from "./pipeline.ts";
export { callJson, callText, extractJson } from "./llm.ts";
export type * from "./api.ts";
