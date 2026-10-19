// Engine entry point: the EngineApi implementation the rooms layer uses.

import type { EngineApi } from "./api.ts";
import { advisor, brainstorm, polish } from "./advisor.ts";
import { openChat, respondProposal, sendChat } from "./chat.ts";
import { abandonFormation, assessFormation, consentFormation, proclaimFormation } from "./formation.ts";
import { createGame } from "./game.ts";
import { intervene } from "./intervene.ts";
import { runTurn } from "./pipeline.ts";
import { castVote, proposeResolution } from "./votes.ts";

export const engine: EngineApi = {
  createGame,
  runTurn,
  sendChat,
  openChat,
  respondProposal,
  advisor,
  polish,
  brainstorm,
  proposeResolution,
  castVote,
  assessFormation,
  consentFormation,
  proclaimFormation,
  abandonFormation,
  intervene,
};

export {
  abandonFormation, advisor, assessFormation, brainstorm, castVote, consentFormation, createGame, openChat, polish,
  proclaimFormation, proposeResolution, respondProposal, runTurn, sendChat, intervene,
};
export { INTERRUPTED, turnEvents } from "./intervene.ts";
export { jumpDays } from "./pipeline.ts";
export { callJson, callText, extractJson } from "./llm.ts";
export type * from "./api.ts";
