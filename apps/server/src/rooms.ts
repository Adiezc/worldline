// Game rooms: one in-memory authoritative GameState per game, players attached by WebSocket.
// The room owns sequencing (lobby → orders → resolving), the ready/timer rule, persistence and
// per-player views. All game logic lives in ./engine.

import type { ServerWebSocket } from "bun";
import {
  DEFAULT_SETTINGS, countryByTag, type ClientMessage, type GameSettings, type GameState, type GameView,
  type MapIndex, type ScenarioSeed, type ServerMessage,
} from "@worldline/shared";
import { engine } from "./engine/index.ts";
import type { AiProvider, EngineDeps } from "./engine/api.ts";
import { loadGame, saveGame, saveSnapshot } from "./db.ts";

export interface SocketData {
  gameId?: string;
  playerId?: string;
}
type Socket = ServerWebSocket<SocketData>;

const MAX_PLAYERS = 8;
const VIEW_EVENTS = 150;

export interface RoomDeps {
  map: MapIndex;
  ai: AiProvider;
  seed(id: string): ScenarioSeed;
}

export class Room {
  sockets = new Set<Socket>();
  resolving = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(public state: GameState, private deps: RoomDeps) {}

  private engineDeps(): EngineDeps {
    return {
      map: this.deps.map,
      seed: this.deps.seed(this.state.scenarioId),
      ai: this.deps.ai,
      onProgress: (stage, detail) => this.broadcast({ t: "progress", stage, detail }),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Views

  view(playerId: string): GameView {
    const s = this.state;
    const me = s.players.find((p) => p.id === playerId);
    const tag = me?.country ?? null;
    const { orders, chats, events, jumpVotes, ...rest } = s;
    const seed = this.deps.seed(s.scenarioId);
    const quota = this.deps.ai.quota();
    return {
      ...rest,
      orders: orders[playerId] ?? [],
      // Orders are private, and verdicts quote them: only your own.
      lastVerdicts: s.lastVerdicts.filter((v) => !v.country || v.country === tag),
      chats: tag ? chats.filter((c) => c.members.includes(tag)) : [],
      events: events.slice(-VIEW_EVENTS),
      eventCount: events.length,
      jumpVotes,
      you: { playerId, country: tag, isHost: !!me?.isHost },
      formables: seed.formables,
      calendar: seed.calendar.filter((e) => e.date >= s.date).slice(0, 24),
      ai: { provider: this.deps.ai.name, usedToday: quota.usedToday, dailyLimit: quota.dailyLimit },
    };
  }

  send(ws: Socket, msg: ServerMessage) {
    ws.send(JSON.stringify(msg));
  }

  broadcast(msg: ServerMessage) {
    const text = JSON.stringify(msg);
    for (const ws of this.sockets) ws.send(text);
  }

  /** Each player gets their own filtered view. */
  pushViews() {
    for (const ws of this.sockets) if (ws.data.playerId) this.send(ws, { t: "view", view: this.view(ws.data.playerId) });
  }

  private changed() {
    this.pushViews();
    this.scheduleSave();
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      saveGame(this.state);
    }, 800);
  }

  // ---------------------------------------------------------------------------------------
  // Connections

  join(ws: Socket, msg: Extract<ClientMessage, { t: "join" }>) {
    const s = this.state;
    let player = msg.playerId ? s.players.find((p) => p.id === msg.playerId) : undefined;
    if (!player) {
      player = {
        id: crypto.randomUUID(),
        name: (msg.name || "Player").slice(0, 32),
        country: null,
        isHost: s.players.length === 0,
        connected: true,
        ready: false,
      };
      s.players.push(player);
    } else {
      player.connected = true;
      if (msg.name) player.name = msg.name.slice(0, 32);
    }
    if (!s.players.some((p) => p.isHost)) player.isHost = true;
    ws.data.gameId = s.id;
    ws.data.playerId = player.id;
    this.sockets.add(ws);
    this.send(ws, { t: "welcome", playerId: player.id, view: this.view(player.id) });
    this.changed();
  }

  leave(ws: Socket) {
    this.sockets.delete(ws);
    const p = this.state.players.find((x) => x.id === ws.data.playerId);
    if (p && ![...this.sockets].some((o) => o.data.playerId === p.id)) p.connected = false;
    this.changed();
    // A player leaving may be the last one everyone was waiting for.
    void this.maybeResolve();
  }

  // ---------------------------------------------------------------------------------------
  // Messages

  /** Messages that change game state. They are serialised and refused mid-resolution, because a
   * turn commits a whole new state and would silently drop anything changed meanwhile. */
  private static MUTATING = new Set<ClientMessage["t"]>([
    "claim", "settings", "start", "orders", "jump", "chat.open", "chat.send", "proposal.respond",
    "org.propose", "org.vote", "formation.assess", "formation.recheck", "formation.consent", "formation.proclaim", "formation.abandon",
  ]);
  private lock: Promise<unknown> = Promise.resolve();

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  async handle(ws: Socket, msg: ClientMessage) {
    if (!Room.MUTATING.has(msg.t)) return this.dispatch(ws, msg);
    if (this.resolving) {
      this.send(ws, { t: "error", message: "The world is turning; try again once the turn resolves." });
      return;
    }
    return this.exclusive(() => (this.resolving ? Promise.resolve() : this.dispatch(ws, msg)));
  }

  private async dispatch(ws: Socket, msg: ClientMessage) {
    const s = this.state;
    const me = s.players.find((p) => p.id === ws.data.playerId);
    if (!me) return this.send(ws, { t: "error", message: "Join the game first." });
    const deps = this.engineDeps();
    const fail = (message: string) => this.send(ws, { t: "error", message });
    const myTag = me.country;

    switch (msg.t) {
      case "join":
        return;

      case "claim": {
        if (msg.tag === null) {
          me.country = null;
          return this.changed();
        }
        const k = countryByTag(s, msg.tag);
        if (!k?.alive) return fail("That country does not exist.");
        if (s.players.some((p) => p.country === msg.tag && p.id !== me.id)) return fail(`${k.name} is already taken.`);
        if (!me.country && s.players.filter((p) => p.country).length >= MAX_PLAYERS) return fail("This game is full.");
        if (s.phase !== "lobby" && me.country) return fail("You can only change country in the lobby.");
        me.country = msg.tag;
        return this.changed();
      }

      case "settings": {
        if (!me.isHost) return fail("Only the host can change settings.");
        s.settings = sanitizeSettings({ ...s.settings, ...msg.settings });
        if (s.phase === "orders") this.armTimer();
        return this.changed();
      }

      case "start": {
        if (!me.isHost) return fail("Only the host can start the game.");
        if (s.phase !== "lobby") return;
        if (!s.players.some((p) => p.country)) return fail("At least one player must pick a country.");
        s.phase = "orders";
        this.armTimer();
        this.broadcast({ t: "toast", level: "info", text: "The game has begun." });
        return this.changed();
      }

      case "orders": {
        if (s.phase !== "orders" || !myTag) return fail("You can't give orders right now.");
        s.orders[me.id] = msg.orders
          .filter((o) => o.text.trim())
          .slice(0, 12)
          .map((o) => ({ id: o.id.slice(0, 40), playerId: me.id, country: myTag, text: o.text.slice(0, 1200) }));
        this.scheduleSave();
        return;
      }

      case "ready": {
        if (s.phase !== "orders" || !myTag) return;
        me.ready = msg.ready;
        this.changed();
        void this.maybeResolve();
        return;
      }

      case "jump": {
        if (s.phase === "resolving") return;
        const days = [0, 7, 30, 90, 180, 365].includes(msg.days) ? msg.days : 30;
        if (s.settings.jumpVoting) s.jumpVotes[me.id] = days;
        else if (me.isHost) s.settings.jumpDays = days;
        else return fail("Only the host sets the jump length.");
        return this.changed();
      }

      case "ai": {
        if (!myTag) return fail("Pick a country first.");
        try {
          if (msg.kind === "advisor") {
            const text = await engine.advisor(s, deps, { country: myTag, question: msg.text });
            this.send(ws, { t: "ai", reqId: msg.reqId, kind: "advisor", ok: true, text });
          } else if (msg.kind === "polish") {
            const text = await engine.polish(s, deps, { country: myTag, text: msg.text ?? "" });
            this.send(ws, { t: "ai", reqId: msg.reqId, kind: "polish", ok: true, text });
          } else {
            const ideas = await engine.brainstorm(s, deps, { country: myTag });
            this.send(ws, { t: "ai", reqId: msg.reqId, kind: "brainstorm", ok: true, ideas });
          }
        } catch (e) {
          this.send(ws, { t: "ai", reqId: msg.reqId, kind: msg.kind, ok: false, error: errorText(e) });
        }
        this.pushUsage();
        return;
      }

      case "chat.open": {
        if (!myTag) return fail("Pick a country first.");
        const others = msg.with.filter((t) => t !== myTag && countryByTag(s, t)?.alive);
        if (!others.length) return fail("Choose who to talk to.");
        engine.openChat(s, { from: myTag, with: others });
        return this.changed();
      }

      case "chat.send": {
        if (!myTag) return fail("Pick a country first.");
        const chat = s.chats.find((c) => c.id === msg.chatId);
        if (!chat?.members.includes(myTag)) return fail("You are not in that conversation.");
        const humans = new Set(s.players.map((p) => p.country).filter(Boolean));
        const aiMember = chat.members.find((m) => m !== myTag && !humans.has(m));
        if (aiMember) this.broadcastTo(chat.members, { t: "chat.typing", chatId: chat.id, from: aiMember });
        try {
          await engine.sendChat(s, deps, { chatId: msg.chatId, playerId: me.id, text: msg.text.slice(0, 2000), proposal: msg.proposal });
        } catch (e) {
          fail(`The envoy could not get through: ${errorText(e)}`);
        }
        return this.changed();
      }

      case "proposal.respond": {
        if (!myTag) return;
        const r = engine.respondProposal(s, { chatId: msg.chatId, proposalId: msg.proposalId, byTag: myTag, accept: msg.accept });
        if (!r.ok) fail(r.message);
        else this.send(ws, { t: "toast", level: "info", text: r.message });
        return this.changed();
      }

      case "org.propose": {
        if (!myTag) return fail("Pick a country first.");
        const r = engine.proposeResolution(s, { orgId: msg.orgId, proposer: myTag, resolutionType: msg.resolutionType, target: msg.target, text: msg.text.slice(0, 1000) });
        if (!r.ok) fail(r.message);
        else this.broadcast({ t: "toast", level: "info", text: r.message });
        return this.changed();
      }

      case "org.vote": {
        if (!myTag) return;
        const r = engine.castVote(s, { resolutionId: msg.resolutionId, country: myTag, vote: msg.vote });
        if (!r.ok) fail(r.message);
        return this.changed();
      }

      case "formation.assess":
      case "formation.recheck": {
        if (!myTag) return fail("Pick a country first.");
        try {
          const goal = await engine.assessFormation(
            s, deps,
            msg.t === "formation.assess" ? { founder: myTag, request: msg.request } : { formationId: msg.formationId },
          );
          this.send(ws, { t: "ai", reqId: msg.reqId, kind: "formation", ok: true, formationId: goal.id });
        } catch (e) {
          this.send(ws, { t: "ai", reqId: msg.reqId, kind: "formation", ok: false, error: errorText(e) });
        }
        return this.changed();
      }

      case "formation.consent": {
        if (!myTag) return;
        const r = engine.consentFormation(s, { formationId: msg.formationId, country: myTag, accept: msg.accept });
        if (!r.ok) fail(r.message);
        return this.changed();
      }

      case "formation.proclaim": {
        if (!myTag) return;
        const f = s.formations.find((x) => x.id === msg.formationId);
        if (!f || f.founder !== myTag) return fail("Only the founder can proclaim the nation.");
        try {
          const r = await engine.proclaimFormation(s, deps, { formationId: msg.formationId });
          if (!r.ok) fail(`Not yet: ${r.problems.join("; ")}`);
          else if (r.event) {
            this.broadcast({ t: "toast", level: "info", text: r.event.headline });
            this.broadcast({ t: "turn", result: { turn: s.turn, fromDate: s.date, toDate: s.date, events: [r.event], verdicts: [], votes: [] } });
          }
        } catch (e) {
          fail(errorText(e));
        }
        return this.changed();
      }

      case "formation.abandon": {
        const f = s.formations.find((x) => x.id === msg.formationId);
        if (f?.founder === myTag) engine.abandonFormation(s, { formationId: msg.formationId });
        return this.changed();
      }
    }
  }

  private broadcastTo(tags: string[], msg: ServerMessage) {
    const ids = new Set(this.state.players.filter((p) => p.country && tags.includes(p.country)).map((p) => p.id));
    for (const ws of this.sockets) if (ws.data.playerId && ids.has(ws.data.playerId)) this.send(ws, msg);
  }

  private pushUsage() {
    // Usage meter lives in the view; refresh everyone cheaply.
    this.pushViews();
  }

  // ---------------------------------------------------------------------------------------
  // Turn flow

  armTimer() {
    const t = this.state.settings.turnTimer;
    this.state.turnDeadline = this.state.phase === "orders" && t > 0 ? Date.now() + t * 1000 : undefined;
  }

  /** Resolve when every connected player with a country is ready, or when the timer runs out. */
  async maybeResolve(force = false) {
    const s = this.state;
    if (s.phase !== "orders" || this.resolving) return;
    const active = s.players.filter((p) => p.country && p.connected);
    const allReady = active.length > 0 && active.every((p) => p.ready);
    const timedOut = !!s.turnDeadline && Date.now() >= s.turnDeadline;
    if (!allReady && !timedOut && !force) return;
    // Wait for in-flight chats/formations to land before the turn snapshots the state.
    this.resolving = true;
    await this.lock;
    await this.resolveTurn();
  }

  async resolveTurn() {
    const s = this.state;
    this.resolving = true;
    s.phase = "resolving";
    s.turnDeadline = undefined;
    this.pushViews();
    try {
      saveSnapshot(s);
      const result = await engine.runTurn(s, this.engineDeps());
      s.phase = "orders";
      this.armTimer();
      saveGame(s);
      for (const ws of this.sockets) {
        const tag = s.players.find((p) => p.id === ws.data.playerId)?.country;
        this.send(ws, { t: "turn", result: { ...result, verdicts: result.verdicts.filter((v) => !v.country || v.country === tag) } });
      }
    } catch (e) {
      s.phase = "orders";
      for (const p of s.players) p.ready = false;
      this.armTimer();
      this.broadcast({ t: "toast", level: "error", text: `The turn could not be resolved: ${errorText(e)}. Your orders are kept; try again.` });
    } finally {
      this.resolving = false;
      this.broadcast({ t: "progress", stage: "done" });
      this.pushViews();
    }
  }

  tick() {
    const s = this.state;
    if (s.phase === "orders" && s.turnDeadline && Date.now() >= s.turnDeadline) void this.maybeResolve();
  }
}

// -----------------------------------------------------------------------------------------

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private deps: RoomDeps) {
    setInterval(() => {
      for (const r of this.rooms.values()) r.tick();
    }, 1000);
  }

  create(name: string, scenarioId = "modern-2026") {
    const id = shortId();
    const state = engine.createGame({ id, name: name.slice(0, 60) || "New game", seed: this.deps.seed(scenarioId) });
    saveGame(state);
    const room = new Room(state, this.deps);
    this.rooms.set(id, room);
    return room;
  }

  get(id: string): Room | null {
    let room = this.rooms.get(id);
    if (room) return room;
    const state = loadGame(id);
    if (!state) return null;
    // A server restart mid-resolution leaves the game in "resolving"; recover to orders.
    if (state.phase === "resolving") state.phase = "orders";
    for (const p of state.players) p.connected = false;
    room = new Room(state, this.deps);
    this.rooms.set(id, room);
    return room;
  }
}

function sanitizeSettings(s: GameSettings): GameSettings {
  const d = DEFAULT_SETTINGS;
  return {
    difficulty: ["easy", "normal", "hard", "realistic"].includes(s.difficulty) ? s.difficulty : d.difficulty,
    aiBehaviour: s.aiBehaviour === "dynamic" ? "dynamic" : "plausible",
    jumpDays: [0, 7, 30, 90, 180, 365].includes(s.jumpDays) ? s.jumpDays : d.jumpDays,
    turnTimer: Math.max(0, Math.min(3600, Math.round(Number(s.turnTimer) || 0))),
    modelChain: sanitizeChain(s.modelChain) ?? d.modelChain,
    reasoningEffort: ["none", "low", "medium", "high"].includes(s.reasoningEffort) ? s.reasoningEffort : d.reasoningEffort,
    economyMode: !!s.economyMode,
    jumpVoting: !!s.jumpVoting,
  };
}

function sanitizeChain(chain: unknown) {
  if (!Array.isArray(chain)) return null;
  const out = chain.map((m) => String(m).trim()).filter((m) => /^[\w.\-/:]+$/.test(m)).slice(0, 6);
  return out.length ? out : null;
}

function shortId() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(8))) out += alphabet[b % alphabet.length];
  return out;
}

export function errorText(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
