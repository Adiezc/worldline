// Owns the single GameSocket and routes every ServerMessage into the store.
import type { ClientMessage, ServerMessage } from "@worldline/shared";
import { GameSocket } from "../net/socket.ts";
import { storage } from "../net/storage.ts";
import { applyView, resetGame, toast, useGame } from "./store.ts";

let socket: GameSocket | null = null;
let ordersTimer = 0;

export function connectGame(gameId: string) {
  if (socket && useGame.getState().gameId === gameId) return;
  disconnectGame();
  resetGame(gameId);
  socket = new GameSocket({
    join: () => ({
      t: "join",
      gameId,
      playerId: useGame.getState().playerId ?? storage.playerId(gameId),
      name: storage.name() || "Anonymous",
    }),
    onMessage: handleMessage,
    onStatus: (status, detail) => useGame.setState({ status, statusDetail: detail }),
  });
  socket.connect();
}

export function disconnectGame() {
  window.clearTimeout(ordersTimer);
  socket?.close();
  socket = null;
}

export const retryConnection = () => socket?.retry();

export function send(msg: ClientMessage) {
  if (!socket) return false;
  socket.send(msg);
  return true;
}

/** Push the local order list to the server, debounced. */
export function scheduleOrdersSync(delay = 600) {
  window.clearTimeout(ordersTimer);
  ordersTimer = window.setTimeout(flushOrders, delay);
}

export function flushOrders() {
  window.clearTimeout(ordersTimer);
  const { orders, ordersDirty } = useGame.getState();
  if (!ordersDirty) return;
  send({ t: "orders", orders: orders.filter((o) => o.text.trim()).map((o) => ({ id: o.id, text: o.text })) });
  useGame.setState({ ordersDirty: false });
}

function handleMessage(msg: ServerMessage) {
  const s = useGame.getState();
  switch (msg.t) {
    case "welcome": {
      const gameId = s.gameId ?? msg.view.id;
      storage.setPlayerId(gameId, msg.playerId);
      storage.touchRecent({ id: gameId, name: msg.view.name });
      useGame.setState({ playerId: msg.playerId });
      applyView(msg.view);
      // Edits made while offline go out again.
      if (useGame.getState().ordersDirty) scheduleOrdersSync(50);
      break;
    }
    case "view": {
      applyView(msg.view);
      // A reply from whoever was typing ends the typing indicator.
      const typing = { ...useGame.getState().typing };
      let cleared = false;
      for (const [chatId, t] of Object.entries(typing)) {
        const messages = msg.view.chats.find((c) => c.id === chatId)?.messages ?? [];
        if (messages.length > t.count && messages.at(-1)?.from === t.from) {
          delete typing[chatId];
          cleared = true;
        }
      }
      if (cleared) useGame.setState({ typing });
      break;
    }
    case "progress":
      useGame.setState({ progress: msg.stage === "done" ? null : { stage: msg.stage, detail: msg.detail } });
      break;
    case "turn":
      useGame.setState({
        lastResult: msg.result,
        turnBase: s.viewAdvanced && s.preTurn ? { owners: s.preTurn.owners, controllers: s.preTurn.controllers } : null,
        viewAdvanced: false,
        resultOpen: true,
        mapHold: true,
        playback: null,
        progress: null,
      });
      break;
    case "ai":
      handleAi(msg);
      break;
    case "chat.typing":
      useGame.setState((st) => {
        const count = st.view?.chats.find((c) => c.id === msg.chatId)?.messages.length ?? 0;
        return { typing: { ...st.typing, [msg.chatId]: { from: msg.from, until: Date.now() + 15000, count } } };
      });
      break;
    case "toast":
      toast(msg.text, msg.level);
      break;
    case "error":
      toast(msg.message, "error");
      break;
  }
}

function handleAi(msg: Extract<ServerMessage, { t: "ai" }>) {
  const s = useGame.getState();
  const req = s.requests[msg.reqId];
  const reply = { ok: msg.ok, text: msg.text, ideas: msg.ideas, formationId: msg.formationId, error: msg.error };
  const patch: Partial<typeof s> = { replies: { ...s.replies, [msg.reqId]: reply } };
  const requests = { ...s.requests };
  delete requests[msg.reqId];
  patch.requests = requests;

  if (!msg.ok) toast(msg.error ?? "The advisors could not answer.", "warn");

  if (msg.ok) {
    if (msg.kind === "polish" && req?.orderId && msg.text) {
      patch.orders = s.orders.map((o) => (o.id === req.orderId ? { ...o, text: msg.text! } : o));
      patch.ordersDirty = true;
    }
    if (msg.kind === "brainstorm" && msg.ideas) patch.ideas = msg.ideas;
    if (msg.kind === "formation" && msg.formationId) patch.activeFormationId = msg.formationId;
  }
  useGame.setState(patch);
  if (patch.ordersDirty) scheduleOrdersSync();
}
