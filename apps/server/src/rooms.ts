// Game rooms: one in-memory authoritative GameState per game, players attached by WebSocket.
// The room owns sequencing (lobby → orders → resolving), the ready/timer rule, persistence and
// per-player views. All game logic lives in ./engine.

import type { ServerWebSocket } from "bun";
import {
  DEFAULT_SETTINGS, countryByTag, pruneClaims, relocateCapitals, sanitizeOperation, type ClientMessage, type GameSettings, type GameState, type GameView,
  type MapIndex, type ScenarioSeed, type ServerMessage,
} from "@worldline/shared";
import { engine, jumpDays, turnEvents } from "./engine/index.ts";
import type { AiProvider, EngineDeps } from "./engine/api.ts";
import {
  deleteSnapshotsAfter, linkedPlayer, linkUserGame, listSnapshots, loadGame, loadSnapshot, saveGame, saveSnapshot, snapshotEventCount,
} from "./db.ts";

export interface SocketData {
  gameId?: string;
  playerId?: string;
  userId?: string;
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
  /** Event-log length of the last turn's pre-turn snapshot (undefined = not looked up yet). */
  private snapEvents: { turn: number; count: number | null } | undefined;

  constructor(public state: GameState, private deps: RoomDeps) {}

  /** AI governments' plan for the open turn, computed while players write their orders. */
  private directorPlan?: NonNullable<EngineDeps["directorPlan"]> & { key: string };

  private planKey() {
    const s = this.state;
    return JSON.stringify([s.turn, s.date, jumpDays(s), s.settings.modelChain, s.settings.aiBehaviour, s.settings.economyMode]);
  }

  /** Start (or restart) the advance plan whenever the open turn or its AI settings change. */
  private ensureDirectorPlan() {
    const s = this.state;
    if (s.phase !== "orders" || this.resolving || s.settings.economyMode) return;
    if (!s.players.some((p) => p.connected && p.country)) return;
    const key = this.planKey();
    if (this.directorPlan?.key === key) return;
    const started = Date.now();
    const pre = engine.planDirector(s, { map: this.deps.map, seed: this.deps.seed(s.scenarioId), ai: this.deps.ai });
    this.directorPlan = { ...pre, key };
    void pre.plan.then((p) => {
      if (this.directorPlan?.plan === pre.plan) {
        this.log("info", `turn ${pre.turn}: AI governments planned ahead in ${Math.round((Date.now() - started) / 1000)}s${p ? "" : " (no plan; the turn will plan live)"}`);
      }
    });
  }

  private engineDeps(): EngineDeps {
    return {
      map: this.deps.map,
      seed: this.deps.seed(this.state.scenarioId),
      ai: this.deps.ai,
      directorPlan: this.directorPlan,
      onProgress: (stage, detail) => {
        this.log("info", `turn ${this.state.turn}: ${stage}${detail ? ` (${detail})` : ""}`);
        this.broadcast({ t: "progress", stage, detail });
      },
      onValidation: (e) => this.log(e.outcome === "failed" ? "error" : "warn", `AI ${e.kind} output ${e.outcome}: ${e.error}`),
    };
  }

  /** Server-side trace: errors players see as toasts also land in the terminal. */
  log(level: "info" | "warn" | "error", message: string) {
    const line = `[${new Date().toTimeString().slice(0, 8)}] [game ${this.state.id}] ${message}`;
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
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
      players: s.players.map(({ secret: _secret, ...p }) => p),
      orders: orders[playerId] ?? [],
      // Orders are private, and verdicts quote them: only your own.
      lastVerdicts: s.lastVerdicts.filter((v) => !v.country || v.country === tag),
      verdictLog: (s.verdictLog ?? []).filter((v) => v.country === tag).slice(-60),
      chats: tag ? chats.filter((c) => c.members.includes(tag)) : [],
      events: events.slice(-VIEW_EVENTS),
      eventCount: events.length,
      jumpVotes,
      you: { playerId, country: tag, isHost: !!me?.isHost },
      // Only the nations this player's country could proclaim.
      formables: tag ? seed.formables.filter((f) => f.formers.includes(tag)) : [],
      calendar: seed.calendar.filter((e) => e.date >= s.date).slice(0, 24),
      theme: seed.theme ?? "modern",
      snapshots: me?.isHost ? listSnapshots(s.id) : [],
      intervenable: me?.isHost ? this.intervenable() : [],
      ai: { provider: this.deps.ai.name, usedToday: quota.usedToday, dailyLimit: quota.dailyLimit },
      allyOperations: tag ? this.allyOperations(playerId, tag) : [],
    };
  }

  /** Other human players' battle plans when they fight on `tag`'s side of a war. */
  private allyOperations(playerId: string, tag: string): GameView["allyOperations"] {
    const s = this.state;
    const sides = s.wars.map((w) => (w.attackers.includes(tag) ? w.attackers : w.defenders.includes(tag) ? w.defenders : []));
    const out: GameView["allyOperations"] = [];
    for (const p of s.players) {
      if (p.id === playerId || !p.country || p.country === tag || !sides.some((side) => side.includes(p.country!))) continue;
      for (const o of s.orders[p.id] ?? []) if (o.operation) out.push({ country: p.country, orderId: o.id, operation: o.operation });
    }
    return out;
  }

  /** Events of the last resolved turn the host may stop time at; empty once anything new has happened. */
  intervenable(): string[] {
    const s = this.state;
    const last = s.turn - 1;
    if (s.phase !== "orders" || last < 1 || Object.values(s.orders).some((o) => o.length)) return [];
    const count = this.snapshotEvents(last);
    if (count === null) return [];
    if (s.events.slice(count).some((e) => e.turn > last)) return [];
    return turnEvents(s, count, last).map((e) => e.id);
  }

  private snapshotEvents(turn: number) {
    if (this.snapEvents?.turn !== turn) this.snapEvents = { turn, count: snapshotEventCount(this.state.id, turn) };
    return this.snapEvents.count;
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
    this.ensureDirectorPlan();
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

  /** `user`: the signed-in account, whose earlier player in this game is resumed on any device. */
  join(ws: Socket, msg: Extract<ClientMessage, { t: "join" }>, user?: { id: string } | null) {
    const s = this.state;
    const linked = user ? linkedPlayer(user.id, s.id) : null;
    let player = linked ? s.players.find((p) => p.id === linked) : undefined;
    // Every view lists player ids, so resuming a seat takes its secret too. Seats saved before
    // secrets existed have none; the first client to resume one is given it.
    player ??= msg.playerId ? s.players.find((p) => p.id === msg.playerId && (!p.secret || p.secret === msg.secret)) : undefined;
    const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 32) : "";
    if (!player) {
      player = {
        id: crypto.randomUUID(),
        name: name || "Player",
        country: null,
        isHost: s.players.length === 0,
        connected: true,
        ready: false,
      };
      s.players.push(player);
    } else {
      player.connected = true;
      if (name) player.name = name;
    }
    player.secret ??= crypto.randomUUID();
    if (!s.players.some((p) => p.isHost)) player.isHost = true;
    // A turn timer that ran out while nobody was there to play starts afresh.
    if (s.phase === "orders" && s.turnDeadline && s.turnDeadline <= Date.now()) this.armTimer();
    ws.data.gameId = s.id;
    ws.data.playerId = player.id;
    ws.data.userId = user?.id;
    if (user) linkUserGame(user.id, s.id, player.id);
    this.sockets.add(ws);
    this.send(ws, { t: "welcome", playerId: player.id, secret: player.secret, view: this.view(player.id) });
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
   * turn commits a whole new state and would silently drop anything changed meanwhile. Ones
   * already queued when a turn is called still run: the turn waits for them. */
  private static MUTATING = new Set<ClientMessage["t"]>([
    "claim", "settings", "start", "orders", "jump", "chat.open", "chat.send", "proposal.respond",
    "org.propose", "org.vote",
    "rewind", "intervene",
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
    return this.exclusive(() => this.dispatch(ws, msg));
  }

  private async dispatch(ws: Socket, msg: ClientMessage) {
    const s = this.state;
    const me = s.players.find((p) => p.id === ws.data.playerId);
    if (!me) return this.send(ws, { t: "error", message: "Join the game first." });
    const deps = this.engineDeps();
    const fail = (message: string) => {
      this.log("warn", `${me.name} (${me.country ?? "spectator"}) → ${msg.t}: ${message}`);
      this.send(ws, { t: "error", message });
    };
    const myTag = me.country;

    switch (msg.t) {
      case "join":
        return;

      case "claim": {
        // After the lobby a nation is yours for good, unless it has ceased to exist. Spectators
        // may still take one that nobody leads.
        if (s.phase !== "lobby" && myTag && countryByTag(s, myTag)?.alive) return fail("You can only change country in the lobby.");
        if (msg.tag === null) {
          me.country = null;
          return this.changed();
        }
        const k = countryByTag(s, msg.tag);
        if (!k?.alive) return fail("That country does not exist.");
        if (s.players.some((p) => p.country === msg.tag && p.id !== me.id)) return fail(`${k.name} is already taken.`);
        if (!me.country && s.players.filter((p) => p.country).length >= MAX_PLAYERS) return fail("This game is full.");
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
          .map((o) => {
            // A battle plan that doesn't survive the checks is dropped; the order text stays.
            const operation = sanitizeOperation(o.operation, s, this.deps.map, myTag);
            // A proclamation names a formable this country may form; anything else is dropped.
            const formable = typeof o.formable === "string" && this.deps.seed(s.scenarioId).formables.some((f) => f.id === o.formable && f.formers.includes(myTag))
              ? o.formable : undefined;
            return {
              id: o.id.slice(0, 40), playerId: me.id, country: myTag, text: o.text.slice(0, 1200),
              ...(operation ? { operation } : {}), ...(formable ? { formable } : {}),
            };
          });
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
        // Answered as a failed request (not a bare error) so the client stops waiting for it.
        if (!myTag) return this.send(ws, { t: "ai", reqId: msg.reqId, kind: msg.kind, ok: false, error: "Pick a country first." });
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
          this.log("error", `${msg.kind} for ${myTag} failed: ${errorText(e)}`);
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
        const speaker = msg.speaker || undefined;
        if (speaker && (!chat.members.includes(speaker) || humans.has(speaker) || speaker === myTag)) {
          return fail("Only an AI delegation in this conversation can be asked to answer.");
        }
        const aiMember = speaker ?? chat.members.find((m) => m !== myTag && !humans.has(m));
        if (aiMember) this.broadcastTo(chat.members, { t: "chat.typing", chatId: chat.id, from: aiMember });
        try {
          await engine.sendChat(s, deps, { chatId: msg.chatId, playerId: me.id, text: String(msg.text ?? "").slice(0, 2000), proposal: msg.proposal, speaker });
        } catch (e) {
          if (aiMember) this.broadcastTo(chat.members, { t: "chat.typing", chatId: chat.id, from: aiMember, stop: true });
          // Rule refusals (e.g. land that would be cut off) are the player's to fix, not a lost envoy.
          fail(e instanceof Error && e.name === "ProposalError" ? e.message : `The envoy could not get through: ${errorText(e)}`);
        }
        return this.changed();
      }

      case "proposal.respond": {
        if (!myTag) return;
        const r = engine.respondProposal(s, { chatId: msg.chatId, proposalId: msg.proposalId, byTag: myTag, accept: msg.accept, map: this.deps.map });
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

      case "rewind": {
        if (!me.isHost) return fail("Only the host can rewind time.");
        if (s.phase !== "orders") return fail("Time can only be rewound between turns.");
        const turn = Math.floor(Number(msg.turn));
        const snap = Number.isFinite(turn) ? loadSnapshot(s.id, turn) : null;
        if (!snap) return fail("There is no saved turn to rewind to.");
        this.rewind(snap);
        this.log("info", `${me.name} rewound to turn ${turn} (${snap.date})`);
        this.broadcast({ t: "toast", level: "info", text: `Rewound to ${snap.date} (turn ${turn})` });
        return this.changed();
      }

      case "intervene": {
        if (!me.isHost) return fail("Only the host can stop time.");
        if (!this.intervenable().includes(msg.eventId)) return fail("Time can no longer be stopped at that event.");
        const snap = loadSnapshot(s.id, s.turn - 1);
        if (!snap) return fail("The last turn's snapshot is missing.");
        const r = engine.intervene(s, deps, { snapshot: snap, eventId: msg.eventId });
        deleteSnapshotsAfter(s.id, snap.turn);
        this.armTimer();
        saveGame(s);
        const chosen = r.events.at(-1);
        this.log("info", `${me.name} intervened: time stopped on ${r.date}${chosen ? ` at "${chosen.headline}"` : ""}, ${r.cut} later events undone`);
        this.broadcast({
          t: "toast", level: "info",
          text: `Time stopped on ${r.date}${chosen ? ` at "${chosen.headline}"` : ""}; ${r.cut} later event${r.cut === 1 ? "" : "s"} undone.`,
        });
        return this.changed();
      }
    }
  }

  /** Replace the state with a snapshot, keeping who plays what and the current settings. */
  private rewind(snap: GameState) {
    const s = this.state;
    const next = snap;
    next.players = s.players.map((p) => ({
      ...p, ready: false, country: p.country && countryByTag(next, p.country)?.alive ? p.country : null,
    }));
    next.settings = s.settings;
    next.usage = s.usage;
    next.phase = "orders";
    next.orders = {};
    next.jumpVotes = {};
    // Ids stay unique across branches, so clients never confuse old and new events.
    next.seq = Math.max(next.seq, s.seq);
    // Snapshots from before disputes existed get the scenario's claims.
    if (!next.claims) next.claims = backfillClaims(next, this.deps.seed(next.scenarioId));
    backfillCapitals(next, this.deps.seed(next.scenarioId), this.deps.map);
    delete next.turnDeadline;
    this.state = next;
    this.snapEvents = undefined;
    deleteSnapshotsAfter(next.id, next.turn);
    this.armTimer();
    saveGame(next);
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

  /** Every connected player with a country is ready, or the timer ran out with someone there to play. */
  private turnDue() {
    const s = this.state;
    // A player whose nation is gone gives no orders, so the turn does not wait for them.
    const active = s.players.filter((p) => p.country && p.connected && countryByTag(s, p.country)?.alive);
    if (s.phase !== "orders" || !active.length) return false;
    return active.every((p) => p.ready) || (!!s.turnDeadline && Date.now() >= s.turnDeadline);
  }

  async maybeResolve() {
    if (this.resolving || !this.turnDue()) return;
    // Wait for in-flight chats/formations and queued orders to land before the turn snapshots
    // the state; new changes are refused from here on.
    this.resolving = true;
    await this.lock;
    // Someone may have un-readied or left meanwhile.
    if (!this.turnDue()) {
      this.resolving = false;
      return;
    }
    await this.resolveTurn();
  }

  async resolveTurn() {
    const s = this.state;
    this.resolving = true;
    s.phase = "resolving";
    s.turnDeadline = undefined;
    try {
      // Inside the try: anything thrown from here on must still put the game back to orders.
      this.pushViews();
      saveSnapshot(s);
      this.snapEvents = undefined;
      const started = Date.now();
      const orderCount = Object.values(s.orders).flat().length;
      this.log("info", `resolving turn ${s.turn} (${s.date}, ${orderCount} orders, jump ${s.settings.jumpDays}d, reasoning ${s.settings.reasoningEffort})`);
      // Joins and departures during the turn land on this list, which the commit would replace
      // with its copy from the start (leaving someone who left "connected" for good).
      const players = s.players;
      const result = await engine.runTurn(s, this.engineDeps());
      s.players = players.map((p) => ({ ...p, ready: false }));
      const rejected = result.events.reduce((n, e) => n + (e.rejected?.length ?? 0), 0);
      const clamped = result.events.reduce((n, e) => n + (e.clamped?.length ?? 0), 0);
      this.log("info", `turn done in ${Math.round((Date.now() - started) / 1000)}s: ${result.events.length} events, ${result.verdicts.map((v) => `${v.orderId.slice(0, 6)}=${v.outcome}`).join(" ")}, ${rejected} effects rejected, ${clamped} clamped`);
      s.phase = "orders";
      this.armTimer();
      saveGame(s);
      this.resolving = false;
      this.ensureDirectorPlan();
      for (const ws of this.sockets) {
        const tag = s.players.find((p) => p.id === ws.data.playerId)?.country;
        this.send(ws, {
          t: "turn",
          result: { ...result, verdicts: result.verdicts.filter((v) => !v.country || v.country === tag), nations: result.nations.filter((n) => n.tag === tag) },
        });
      }
    } catch (e) {
      this.log("error", `turn ${s.turn} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
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

  /** A loaded room, without touching the database. */
  peek(id: string): Room | null {
    return this.rooms.get(id) ?? null;
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
    // Games saved before disputes existed get the scenario's claims (minus land already settled).
    if (!state.claims) state.claims = backfillClaims(state, this.deps.seed(state.scenarioId));
    backfillCapitals(state, this.deps.seed(state.scenarioId), this.deps.map);
    room = new Room(state, this.deps);
    this.rooms.set(id, room);
    return room;
  }
}

function backfillClaims(state: GameState, seed: ScenarioSeed) {
  const claims = (seed.disputes ?? []).map((d, i) => ({ id: `cl${i + 1}`, claimant: d.claimant, provinces: [...d.provinces], note: d.note, since: seed.date }));
  const tmp = { ...state, claims };
  pruneClaims(tmp);
  return tmp.claims;
}

/** Games saved before capitals existed take the scenario's, moved if the region has changed hands. */
function backfillCapitals(state: GameState, seed: ScenarioSeed, map: MapIndex) {
  if (state.countries.every((c) => c.capital !== undefined || !c.alive)) return;
  const fromSeed = new Map(seed.countries.map((c) => [c.tag, c.capital]));
  for (const c of state.countries) {
    if (c.capital !== undefined || !fromSeed.has(c.tag)) continue;
    const cap = fromSeed.get(c.tag);
    c.capital = cap ? { ...cap } : null;
  }
  relocateCapitals(state, map);
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
