// Test harness: a real server process (mock AI, in-memory database) and a WebSocket client.
import { join } from "node:path";
import type { ClientMessage, GameView, ServerMessage } from "@worldline/shared";

export async function startServer(port: number) {
  const env: Record<string, string> = { ...process.env, PORT: String(port), WORLDLINE_DB: ":memory:" } as Record<string, string>;
  // Always the mock in tests. Bun auto-loads .env in the child, so deleting the key is not
  // enough: force the provider explicitly.
  env.OPENROUTER_API_KEY = "";
  env.WORLDLINE_AI = "mock";
  const proc = Bun.spawn(["bun", join(import.meta.dir, "..", "..", "src", "index.ts")], { env, stdout: "ignore", stderr: "inherit" });
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`)).ok) return proc;
    } catch {}
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error("server did not start");
}

export class Client {
  ws!: WebSocket;
  view!: GameView;
  playerId = "";
  secret = "";
  inbox: ServerMessage[] = [];
  private waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];

  constructor(private port: number) {}

  async connect(gameId: string, name: string, playerId?: string, token?: string, secret?: string) {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    await new Promise((r) => (this.ws.onopen = r));
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.t === "welcome") { this.view = msg.view; this.playerId = msg.playerId; this.secret = msg.secret; }
      if (msg.t === "view") this.view = msg.view;
      this.inbox.push(msg);
      this.waiters = this.waiters.filter((w) => (w.pred(msg) ? (w.resolve(msg), false) : true));
    };
    const welcome = this.wait((m) => m.t === "welcome");
    this.send({ t: "join", gameId, name, playerId, token, secret });
    await welcome;
    return this;
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  wait(pred: (m: ServerMessage) => boolean, ms = 8000) {
    return new Promise<ServerMessage>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timed out waiting for message")), ms);
      this.waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
    });
  }

  /** Wait until a pushed view satisfies the predicate. */
  async until(pred: (v: GameView) => boolean, ms = 8000) {
    if (this.view && pred(this.view)) return this.view;
    return (await this.wait((m) => (m.t === "view" || m.t === "welcome") && pred(m.view), ms) as { view: GameView }).view;
  }

  close() {
    this.ws.close();
  }
}
