// Client game state: connection, the latest GameView, AI requests, playback and HUD layout.
import { create } from "zustand";
import type { GameEvent, GameView, TurnResult } from "@worldline/shared";
import type { SocketStatus } from "../net/socket.ts";
import type { MapMode } from "./mapModes.ts";

export type AiKind = "advisor" | "polish" | "brainstorm" | "formation";
export type ProgressStage = "director" | "votes" | "resolver" | "applying" | "consolidating" | "done";

export interface AiRequest {
  kind: AiKind;
  at: number;
  /** polish: the order being rewritten. */
  orderId?: string;
  /** advisor: the question asked. */
  question?: string;
}

export interface AiReply {
  ok: boolean;
  text?: string;
  ideas?: string[];
  formationId?: string;
  error?: string;
}

export interface Toast {
  id: number;
  level: "info" | "warn" | "error" | "success";
  text: string;
}

export interface DraftOrder {
  id: string;
  text: string;
}

export interface ChatWindowState {
  chatId: string;
  minimized: boolean;
  /** Proposal builder open in the composer. */
  builder: boolean;
}

export type LeftTab = "orders" | "advisor" | "orgs" | "formation";

export interface GameStore {
  gameId: string | null;
  status: SocketStatus | "idle";
  statusDetail?: string;
  playerId: string | null;
  view: GameView | null;
  /** Ownership before the most recent turn change, for playback. */
  preTurn: { turn: number; owners: number[]; controllers: number[] } | null;
  /** A post-turn view arrived since the last `turn` message (so the map already shows it). */
  viewAdvanced: boolean;
  /** Ownership playback must start from (set when the view beat the `turn` message). */
  turnBase: { owners: number[]; controllers: number[] } | null;
  progress: { stage: ProgressStage; detail?: string } | null;

  lastResult: TurnResult | null;
  resultOpen: boolean;
  /** While true the map keeps showing pre-turn ownership (results modal / playback). */
  mapHold: boolean;
  playback: { events: GameEvent[]; index: number } | null;

  requests: Record<string, AiRequest>;
  replies: Record<string, AiReply>;
  advisorLog: { reqId: string; question: string }[];
  ideas: string[];
  brainstormReq: string | null;
  formationReq: string | null;
  activeFormationId: string | null;

  orders: DraftOrder[];
  ordersDirty: boolean;
  /** Text of last turn's orders by id, so verdicts can quote them. */
  prevOrders: Record<string, string>;

  toasts: Toast[];
  selectedCountry: string | null;
  mapMode: MapMode;
  selectedOrg: string | null;
  leftTab: LeftTab | null;
  countryOpen: boolean;
  feedOpen: boolean;
  feedTab: "player" | "world";
  chats: ChatWindowState[];
  pendingChat: { members: string[]; builder: boolean } | null;
  /** `count` = messages in the chat when typing began; a newer reply from `from` clears it. */
  typing: Record<string, { from: string; until: number; count: number }>;
}

const initial: GameStore = {
  gameId: null,
  status: "idle",
  playerId: null,
  view: null,
  preTurn: null,
  viewAdvanced: false,
  turnBase: null,
  progress: null,
  lastResult: null,
  resultOpen: false,
  mapHold: false,
  playback: null,
  requests: {},
  replies: {},
  advisorLog: [],
  ideas: [],
  brainstormReq: null,
  formationReq: null,
  activeFormationId: null,
  orders: [],
  ordersDirty: false,
  prevOrders: {},
  toasts: [],
  selectedCountry: null,
  mapMode: "political",
  selectedOrg: null,
  leftTab: "orders",
  countryOpen: true,
  feedOpen: false,
  feedTab: "player",
  chats: [],
  pendingChat: null,
  typing: {},
};

export const useGame = create<GameStore>(() => ({ ...initial }));

export const resetGame = (gameId: string | null) => useGame.setState({ ...initial, gameId }, true);

let toastSeq = 0;
export function toast(text: string, level: Toast["level"] = "info") {
  const t: Toast = { id: ++toastSeq, level, text };
  useGame.setState((s) => ({ toasts: [...s.toasts.slice(-4), t] }));
}
export const dismissToast = (id: number) => useGame.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

const sameMembers = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Fold a fresh view into the store. */
export function applyView(view: GameView) {
  useGame.setState((s) => {
    const prev = s.view;
    const patch: Partial<GameStore> = { view };
    const turnChanged = !!prev && prev.turn !== view.turn;
    if (turnChanged) {
      patch.preTurn = { turn: prev.turn, owners: prev.owners, controllers: prev.controllers };
      patch.viewAdvanced = true;
      patch.prevOrders = Object.fromEntries(s.orders.map((o) => [o.id, o.text]));
    }
    // Orders: adopt the server's list unless we have local edits waiting to sync.
    if (!prev || turnChanged || !s.ordersDirty) {
      patch.orders = view.orders.map((o) => ({ id: o.id, text: o.text }));
      if (turnChanged) patch.ordersDirty = false;
    }
    if (view.phase !== "resolving" && s.progress) patch.progress = null;
    // A chat we asked to open has appeared.
    if (s.pendingChat) {
      const chat = view.chats.find((c) => sameMembers(c.members, s.pendingChat!.members));
      if (chat) {
        patch.chats = openWindow(s.chats, chat.id, s.pendingChat.builder);
        patch.pendingChat = null;
      }
    }
    return patch;
  });
}

export function openWindow(list: ChatWindowState[], chatId: string, builder = false): ChatWindowState[] {
  const existing = list.find((w) => w.chatId === chatId);
  if (existing) {
    return list.map((w) => (w.chatId === chatId ? { ...w, minimized: false, builder: builder || w.builder } : w));
  }
  // Keep at most three windows; the oldest drops off.
  return [...list, { chatId, minimized: false, builder }].slice(-3);
}

export { sameMembers };
