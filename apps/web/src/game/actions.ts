// User intents → store updates + client messages.
import type { FormationRequest, GameSettings, ProposalDraft, ResolutionType } from "@worldline/shared";
import { getMap } from "../map/controller.ts";
import { useMap } from "../store.ts";
import { flushOrders, scheduleOrdersSync, send } from "./connection.ts";
import { countryMap } from "./selectors.ts";
import { openWindow, sameMembers, toast, useGame, type AiKind, type LeftTab } from "./store.ts";
import type { MapMode } from "./mapModes.ts";
import { uid } from "./format.ts";

// --- Orders ----------------------------------------------------------------------------------

function setOrders(fn: (o: { id: string; text: string }[]) => { id: string; text: string }[]) {
  useGame.setState((s) => ({ orders: fn(s.orders), ordersDirty: true }));
  scheduleOrdersSync();
}

export const addOrder = (text: string) => {
  const t = text.trim();
  if (!t) return;
  setOrders((o) => [...o, { id: uid("o"), text: t }]);
};
export const editOrder = (id: string, text: string) => setOrders((o) => o.map((x) => (x.id === id ? { ...x, text } : x)));
export const deleteOrder = (id: string) => setOrders((o) => o.filter((x) => x.id !== id));

// --- AI helpers ------------------------------------------------------------------------------

function aiRequest(kind: Exclude<AiKind, "formation">, text?: string, extra: { orderId?: string; question?: string } = {}) {
  const reqId = uid("r");
  useGame.setState((s) => ({ requests: { ...s.requests, [reqId]: { kind, at: Date.now(), ...extra } } }));
  send({ t: "ai", reqId, kind, text });
  return reqId;
}

export function polishOrder(id: string) {
  const order = useGame.getState().orders.find((o) => o.id === id);
  if (!order?.text.trim()) return;
  flushOrders();
  aiRequest("polish", order.text, { orderId: id });
}

export function brainstorm(prompt?: string) {
  const reqId = aiRequest("brainstorm", prompt);
  useGame.setState({ brainstormReq: reqId, ideas: [] });
}

export function askAdvisor(question: string) {
  const q = question.trim() || "Assess my situation.";
  const reqId = aiRequest("advisor", q, { question: q });
  useGame.setState((s) => ({ advisorLog: [...s.advisorLog, { reqId, question: q }] }));
}

export const isPending = (kind: AiKind, pred?: (r: { orderId?: string }) => boolean) =>
  Object.values(useGame.getState().requests).some((r) => r.kind === kind && (!pred || pred(r)));

// --- Turn flow -------------------------------------------------------------------------------

export const setReady = (ready: boolean) => {
  flushOrders();
  send({ t: "ready", ready });
};
export const setJump = (days: number) => send({ t: "jump", days });
export const claimCountry = (tag: string | null) => send({ t: "claim", tag });
export const updateSettings = (settings: Partial<GameSettings>) => send({ t: "settings", settings });
export const startGame = () => send({ t: "start" });

// --- Selection & layout ----------------------------------------------------------------------

export function selectCountry(tag: string | null, opts: { focus?: boolean } = {}) {
  useGame.setState({ selectedCountry: tag, countryOpen: true });
  const view = useGame.getState().view;
  const target = tag ?? view?.you.country;
  if (opts.focus && target) {
    const idx = view?.countries.findIndex((c) => c.tag === target) ?? -1;
    if (idx >= 0) getMap()?.focusOn({ country: idx }, { maxZoom: 1.6 });
  }
}

export const setMapMode = (mapMode: MapMode) => useGame.setState({ mapMode });
export const selectOrg = (orgId: string | null, open = true) =>
  useGame.setState((s) => ({ selectedOrg: orgId, leftTab: open ? "orgs" : s.leftTab }));
export const toggleLeftTab = (tab: LeftTab) => useGame.setState((s) => ({ leftTab: s.leftTab === tab ? null : tab }));
export const setLeftTab = (tab: LeftTab | null) => useGame.setState({ leftTab: tab });

/** Map click in-game: select the owner of the clicked region. */
export function handleMapClick(provinceId: number) {
  const view = useGame.getState().view;
  if (!view) return;
  if (!provinceId) {
    useMap.getState().setSelected(0);
    return;
  }
  const owner = view.countries[view.owners[provinceId]];
  if (view.phase === "lobby") {
    if (owner) {
      const taken = view.players.find((p) => p.country === owner.tag && p.id !== view.you.playerId);
      if (taken) toast(`${owner.name} is already claimed by ${taken.name}.`, "warn");
      else claimCountry(owner.tag);
    }
    return;
  }
  if (owner) selectCountry(owner.tag);
}

// --- Diplomacy -------------------------------------------------------------------------------

/** Open (or create) the bilateral chat with `tag`. */
export function openDiplomacy(tag: string, builder = false) {
  const s = useGame.getState();
  const me = s.view?.you.country;
  if (!s.view || !me || me === tag) return;
  const members = [me, tag];
  const chat = s.view.chats.find((c) => sameMembers(c.members, members));
  if (chat) {
    useGame.setState({ chats: openWindow(s.chats, chat.id, builder) });
  } else {
    useGame.setState({ pendingChat: { members, builder } });
    send({ t: "chat.open", with: [tag] });
  }
}

export const openChat = (chatId: string) => useGame.setState((s) => ({ chats: openWindow(s.chats, chatId) }));
export const closeChat = (chatId: string) => useGame.setState((s) => ({ chats: s.chats.filter((w) => w.chatId !== chatId) }));
export const toggleChatMinimized = (chatId: string) =>
  useGame.setState((s) => ({ chats: s.chats.map((w) => (w.chatId === chatId ? { ...w, minimized: !w.minimized } : w)) }));
export const setChatBuilder = (chatId: string, builder: boolean) =>
  useGame.setState((s) => ({ chats: s.chats.map((w) => (w.chatId === chatId ? { ...w, builder } : w)) }));

/** Open (or create) a conference with several countries at once. */
export function openConference(tags: string[]) {
  const s = useGame.getState();
  const me = s.view?.you.country;
  if (!s.view || !me) return;
  const others = [...new Set(tags.filter((t) => t !== me))];
  if (others.length < 1) return;
  const members = [me, ...others];
  const chat = s.view.chats.find((c) => sameMembers(c.members, members));
  if (chat) {
    useGame.setState({ chats: openWindow(s.chats, chat.id) });
  } else {
    const pending = { members, builder: false };
    useGame.setState({ pendingChat: pending });
    send({ t: "chat.open", with: others });
    // Don't leave "Opening channels…" up forever if the server declines.
    window.setTimeout(() => useGame.setState((st) => (st.pendingChat === pending ? { pendingChat: null } : {})), 15_000);
  }
}

/** `speaker` asks one AI member of a conference to answer (default: the server picks). */
export const sendChat = (chatId: string, text: string, proposal?: ProposalDraft, speaker?: string) =>
  send({ t: "chat.send", chatId, text, proposal, speaker: speaker || undefined });
export const respondProposal = (chatId: string, proposalId: string, accept: boolean) =>
  send({ t: "proposal.respond", chatId, proposalId, accept });

// --- Organisations ---------------------------------------------------------------------------

export const proposeResolution = (orgId: string, resolutionType: ResolutionType, text: string, target?: string) =>
  send({ t: "org.propose", orgId, resolutionType, text, target: target || undefined });
export const voteResolution = (resolutionId: string, vote: "yes" | "no" | "abstain") => send({ t: "org.vote", resolutionId, vote });

// --- Formation -------------------------------------------------------------------------------

export function assessFormation(request: FormationRequest) {
  const reqId = uid("f");
  useGame.setState((s) => ({ formationReq: reqId, requests: { ...s.requests, [reqId]: { kind: "formation", at: Date.now() } } }));
  send({ t: "formation.assess", reqId, request });
}
export function recheckFormation(formationId: string) {
  const reqId = uid("f");
  useGame.setState((s) => ({ formationReq: reqId, requests: { ...s.requests, [reqId]: { kind: "formation", at: Date.now() } } }));
  send({ t: "formation.recheck", reqId, formationId });
}
export const proclaimFormation = (formationId: string) => send({ t: "formation.proclaim", formationId });
export const consentFormation = (formationId: string, accept: boolean) => send({ t: "formation.consent", formationId, accept });
export const abandonFormation = (formationId: string) => {
  send({ t: "formation.abandon", formationId });
  useGame.setState((s) => (s.activeFormationId === formationId ? { activeFormationId: null } : {}));
};

// --- Turn results & playback -----------------------------------------------------------------

export function closeResults() {
  useGame.setState({ resultOpen: false, mapHold: false, playback: null });
}

export function startPlayback() {
  const r = useGame.getState().lastResult;
  if (!r) return closeResults();
  const events = [...r.events].sort((a, b) => a.date.localeCompare(b.date));
  if (!events.length) return closeResults();
  useGame.setState({ resultOpen: false, mapHold: true, playback: { events, index: -1 } });
}

export const skipPlayback = () => useGame.setState({ playback: null, mapHold: false });
export const pausePlayback = (paused: boolean) =>
  useGame.setState((s) => (s.playback ? { playback: { ...s.playback, paused } } : {}));

// --- Time travel (host) ----------------------------------------------------------------------

/** Restore the game to the start of an earlier turn; later turns are discarded. */
export function rewindTo(turn: number) {
  flushOrders();
  useGame.setState({ timeTravel: { kind: "rewind", at: Date.now() }, resultOpen: false, playback: null, mapHold: false });
  send({ t: "rewind", turn });
}

/** Stop the last turn at this event: later events are discarded and orders reopen from its date. */
export function interveneAt(eventId: string) {
  useGame.setState({ timeTravel: { kind: "intervene", at: Date.now() }, resultOpen: false, playback: null, mapHold: false });
  send({ t: "intervene", eventId });
}

/** Name lookup used across panels. */
export function countryName(tag: string) {
  const v = useGame.getState().view;
  return (v && countryMap(v.countries).get(tag)?.name) ?? tag;
}
