import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { GameSummary, HealthResponse } from "@worldline/shared";
import { api, ApiError } from "../../net/api.ts";
import { storage, type RecentGame } from "../../net/storage.ts";
import { navigate, parseGameRef } from "../../router.ts";
import { fmtShortDate } from "../../game/format.ts";
import { Button, Field, Spinner } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

type Health = { state: "loading" } | { state: "offline" } | { state: "ok"; data: HealthResponse };

const SCENARIOS = [{ id: "modern-2026", label: "Modern Day — 1 January 2026" }];

export function MainMenu() {
  const [health, setHealth] = useState<Health>({ state: "loading" });
  const [name, setName] = useState(storage.name());

  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .health()
        .then((data) => alive && setHealth({ state: "ok", data }))
        .catch(() => alive && setHealth({ state: "offline" }));
    void check();
    const t = window.setInterval(check, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  const offline = health.state === "offline";

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center overflow-y-auto">
      {/* Vignette over the start map */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(10_14_20/0.25)_0%,rgb(10_14_20/0.78)_70%,rgb(8_10_14/0.92)_100%)]" />

      <div className="relative mt-[7vh] flex flex-col items-center px-4 text-center">
        <div className="gilt-rule w-72" />
        <h1 className="mt-4 font-display text-6xl font-bold tracking-[0.32em] text-gold-bright drop-shadow-[0_2px_10px_rgb(0_0_0/0.8)] sm:text-7xl">
          WORLDLINE
        </h1>
        <p className="mt-2 font-display text-sm tracking-[0.35em] text-parchment/70 uppercase">Rewrite the history of tomorrow</p>
        <div className="gilt-rule mt-4 w-72" />
      </div>

      <div className="pointer-events-auto relative mt-8 mb-6 grid w-[min(860px,calc(100%-2rem))] gap-4 md:grid-cols-[1.1fr_1fr]">
        <NewGameCard name={name} setName={setName} offline={offline} />
        <div className="flex min-w-0 flex-col gap-4">
          <JoinCard name={name} offline={offline} />
          <RecentCard offline={offline} />
        </div>
      </div>

      <HealthFooter health={health} />
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="hud-panel p-5 text-left">
      <h2 className="mb-4 font-display text-base tracking-[0.18em] text-gold-bright">{title}</h2>
      {children}
    </section>
  );
}

function NewGameCard({ name, setName, offline }: { name: string; setName: (n: string) => void; offline: boolean }) {
  const [gameName, setGameName] = useState("");
  const [scenario, setScenario] = useState(SCENARIOS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Choose a name for yourself first.");
    setBusy(true);
    setError(null);
    storage.setName(name);
    try {
      const title = gameName.trim() || `${name.trim()}'s World`;
      const { gameId } = await api.createGame({ name: title, scenarioId: scenario });
      storage.touchRecent({ id: gameId, name: title });
      navigate(`/game/${encodeURIComponent(gameId)}`);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 0 ? "The game server is offline." : String((err as Error).message));
      setBusy(false);
    }
  }

  return (
    <Card title="New Game">
      <form onSubmit={submit} className="space-y-3.5">
        <Field label="Your name">
          <input className="hud-input" value={name} maxLength={32} placeholder="e.g. Talleyrand" onChange={(e) => setName(e.target.value)} onBlur={() => storage.setName(name)} />
        </Field>
        <Field label="Game name">
          <input className="hud-input" value={gameName} maxLength={60} placeholder={`${name.trim() || "Your"}'s World`} onChange={(e) => setGameName(e.target.value)} />
        </Field>
        <Field label="Scenario">
          <select className="hud-input" value={scenario} onChange={(e) => setScenario(e.target.value)}>
            {SCENARIOS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs leading-relaxed text-parchment/55">
          201 nations, live alliances, wars and institutions as they stand at the dawn of 2026. Claim a country, write your orders in plain language, and let the world respond.
        </p>
        {error && <p className="text-xs text-[#f0b2aa]">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy} disabled={offline}>
          Found a New World
        </Button>
      </form>
    </Card>
  );
}

function JoinCard({ name, offline }: { name: string; offline: boolean }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const id = parseGameRef(ref);
    if (!id) return setError("Paste an invite link or a game code.");
    if (!name.trim()) return setError("Enter your name in the New Game form first.");
    storage.setName(name);
    setBusy(true);
    setError(null);
    try {
      await api.game(id);
      navigate(`/game/${encodeURIComponent(id)}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 404) setError("No game with that code.");
      else if (err instanceof ApiError && err.status === 0) setError("The game server is offline.");
      else navigate(`/game/${encodeURIComponent(id)}`);
    }
  }

  return (
    <Card title="Join a Game">
      <form onSubmit={submit} className="flex gap-2">
        <input className="hud-input" value={ref} placeholder="Invite link or code" onChange={(e) => setRef(e.target.value)} />
        <Button type="submit" variant="secondary" busy={busy} disabled={offline} icon="link">
          Join
        </Button>
      </form>
      {error && <p className="mt-2 text-xs text-[#f0b2aa]">{error}</p>}
    </Card>
  );
}

function RecentCard({ offline }: { offline: boolean }) {
  const [recent, setRecent] = useState<RecentGame[]>(() => storage.recent());
  const [summaries, setSummaries] = useState<Record<string, GameSummary | null>>({});

  useEffect(() => {
    if (offline) return;
    let alive = true;
    for (const g of recent) {
      api
        .game(g.id)
        .then((s) => alive && setSummaries((m) => ({ ...m, [g.id]: s })))
        .catch((e) => alive && e instanceof ApiError && e.status === 404 && setSummaries((m) => ({ ...m, [g.id]: null })));
    }
    return () => {
      alive = false;
    };
  }, [recent, offline]);

  return (
    <Card title="Resume">
      {recent.length === 0 ? (
        <p className="text-xs text-parchment/45 italic">Games you play will be listed here.</p>
      ) : (
        <ul className="hud-scroll -mx-2 max-h-56 space-y-1">
          {recent.map((g) => {
            const s = summaries[g.id];
            return (
              <li key={g.id} className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/[0.04]">
                <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/game/${encodeURIComponent(g.id)}`)} disabled={s === null}>
                  <div className="truncate font-display text-sm text-parchment">{g.name}</div>
                  <div className="truncate text-[11px] text-parchment/45">
                    {s === null
                      ? "No longer on the server"
                      : s
                        ? `${fmtShortDate(s.date)} · Turn ${s.turn} · ${s.players.length} player${s.players.length === 1 ? "" : "s"}`
                        : `Last played ${relTime(g.lastPlayed)}`}
                  </div>
                </button>
                {s !== null && (
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/game/${encodeURIComponent(g.id)}`)}>
                    Resume
                  </Button>
                )}
                <button
                  className="rounded p-1 text-parchment/30 opacity-0 group-hover:opacity-100 hover:text-parchment"
                  title="Forget"
                  onClick={() => {
                    storage.forgetRecent(g.id);
                    setRecent(storage.recent());
                  }}
                >
                  <Icon name="close" size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function HealthFooter({ health }: { health: Health }) {
  return (
    <div className="pointer-events-auto relative mt-auto mb-5 flex items-center gap-3 rounded-full border border-panel-edge/60 bg-panel/80 px-4 py-1.5 text-[11.5px] text-parchment/65 backdrop-blur">
      {health.state === "loading" && (
        <>
          <Spinner className="text-gold" /> Contacting the server…
        </>
      )}
      {health.state === "offline" && (
        <>
          <span className="h-2 w-2 rounded-full bg-fail" />
          <span>
            <b className="font-semibold text-[#f0b2aa]">Server offline</b> — start <code className="text-parchment/80">apps/server</code> on port 3001 to play.
          </span>
        </>
      )}
      {health.state === "ok" && (
        <>
          <span className="h-2 w-2 rounded-full bg-success" />
          <span>Server online</span>
          <span className="h-3 w-px bg-panel-edge" />
          <span>
            AI: <b className="font-semibold text-parchment/90">{health.data.ai === "openrouter" ? "OpenRouter" : "Mock"}</b>
          </span>
          <span className="h-3 w-px bg-panel-edge" />
          <span>
            {health.data.usedToday.toLocaleString()} / {health.data.dailyLimit.toLocaleString()} requests today
          </span>
        </>
      )}
    </div>
  );
}

function relTime(ms: number) {
  const d = (Date.now() - ms) / 1000;
  if (d < 90) return "just now";
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} days ago`;
}
