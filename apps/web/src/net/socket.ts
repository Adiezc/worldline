// WebSocket client: joins on every (re)connect, reconnects with exponential backoff.
import type { ClientMessage, ServerMessage } from "@worldline/shared";

export type SocketStatus = "connecting" | "open" | "reconnecting" | "failed" | "closed";

export interface SocketOptions {
  /** Built fresh on every connect so a playerId learned from `welcome` is reused. */
  join: () => Extract<ClientMessage, { t: "join" }>;
  onMessage: (msg: ServerMessage) => void;
  onStatus: (status: SocketStatus, detail?: string) => void;
}

const MAX_BACKOFF = 15_000;
const GIVE_UP_AFTER = 4; // failed attempts before ever being welcomed

export class GameSocket {
  private ws: WebSocket | null = null;
  private attempts = 0;
  private timer = 0;
  private stopped = false;
  private welcomed = false;
  private lastError?: string;
  private queue: ClientMessage[] = [];

  constructor(private opts: SocketOptions) {}

  connect() {
    this.stopped = false;
    this.opts.onStatus(this.attempts ? "reconnecting" : "connecting");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`);
    } catch (e) {
      this.scheduleReconnect(String(e));
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify(this.opts.join()));
      for (const m of this.queue.splice(0)) ws.send(JSON.stringify(m));
    };
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      if (msg.t === "welcome") {
        this.welcomed = true;
        this.attempts = 0;
        this.lastError = undefined;
        this.opts.onStatus("open");
      } else if (msg.t === "error" && !this.welcomed) {
        this.lastError = msg.message;
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      this.scheduleReconnect(this.lastError);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleReconnect(detail?: string) {
    this.attempts++;
    // Never welcomed and the server told us why (e.g. unknown game): stop hammering it.
    if (!this.welcomed && (this.lastError || this.attempts > GIVE_UP_AFTER)) {
      this.opts.onStatus("failed", detail ?? "Could not reach the game server");
      return;
    }
    const delay = Math.min(MAX_BACKOFF, 500 * 2 ** Math.min(this.attempts, 6)) * (0.8 + Math.random() * 0.4);
    this.opts.onStatus("reconnecting", detail);
    this.timer = window.setTimeout(() => this.connect(), delay);
  }

  /** Retry now (e.g. after "failed"). */
  retry() {
    window.clearTimeout(this.timer);
    this.attempts = 0;
    this.lastError = undefined;
    this.ws?.close();
    this.ws = null;
    this.connect();
  }

  send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
    else if (this.queue.length < 50) this.queue.push(msg);
  }

  get isOpen() {
    return this.ws?.readyState === WebSocket.OPEN && this.welcomed;
  }

  close() {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.queue = [];
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.opts.onStatus("closed");
  }
}
