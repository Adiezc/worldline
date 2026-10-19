import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { GameSummary, HealthResponse, ScenarioInfo } from "@worldline/shared";
import { api, ApiError } from "../../net/api.ts";
import { storage, type RecentGame } from "../../net/storage.ts";
import { refreshMe, signOut, useAuth } from "../../net/auth.ts";
import { backdropOf, DEFAULT_SCENARIO, listScenarios, loadSeed, STATIC_START } from "../../net/scenarios.ts";
import { editorPath, navigate, parseGameRef } from "../../router.ts";
import { useMap } from "../../store.ts";
import { fmtDate, fmtShortDate } from "../../game/format.ts";
import { Badge, Button, Field, Spinner } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";
import { AuthForm } from "../common/AuthForm.tsx";

type Health = { state: "loading" } | { state: "offline" } | { state: "ok"; data: HealthResponse };
type Catalogue = { list: ScenarioInfo[]; offline: boolean; error?: string } | null;

const ERA_LABELS: Record<string, string> = { modern: "Modern", coldwar: "Cold War", custom: "Custom" };

export function MainMenu() {
  const [health, setHealth] = useState<Health>({ state: "loading" });
  const [name, setName] = useState(storage.name());
  const [catalogue, setCatalogue] = useState<Catalogue>(null);
  const [scenarioId, setScenarioId] = useState(() => storage.lastScenario() ?? DEFAULT_SCENARIO);

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
  const online = health.state === "ok";

  // Scenario list: reload when the server comes (back) online.
  useEffect(() => {
    if (health.state === "loading") return;
    let alive = true;
    void listScenarios(online && !!catalogue?.offline).then((c) => alive && setCatalogue(c));
    return () => {
      alive = false;
    };
    // Only on online/offline transitions; `catalogue` is read, not watched.
  }, [health.state]);

  // Keep the selection valid for the list we have.
  const list = catalogue?.list;
  useEffect(() => {
    if (list && !list.some((s) => s.id === scenarioId)) setScenarioId(list.find((s) => s.id === DEFAULT_SCENARIO)?.id ?? list[0].id);
  }, [list, scenarioId]);

  // Preview the chosen scenario's world behind the menu.
  const selected = list?.find((s) => s.id === scenarioId);
  useEffect(() => {
    if (!catalogue) return;
    let alive = true;
    if (catalogue.offline || !selected) {
      useMap.setState({ scenario: STATIC_START, theme: "modern" });
      return;
    }
    loadSeed(selected.id)
      .then((seed) => alive && useMap.setState({ scenario: backdropOf(seed), theme: seed.theme ?? selected.theme ?? "modern" }))
      .catch(() => alive && useMap.setState({ scenario: STATIC_START, theme: "modern" }));
    return () => {
      alive = false;
    };
  }, [catalogue, selected]);

  const choose = (id: string) => {
    setScenarioId(id);
    storage.setLastScenario(id);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center overflow-y-auto">
      {/* Vignette over the start map */}
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_center,rgb(10_14_20/0.2)_0%,rgb(10_14_20/0.74)_70%,rgb(8_10_14/0.9)_100%)]" />

      <div className="relative mt-[5vh] flex flex-col items-center px-4 text-center">
        <div className="gilt-rule w-72" />
        <h1 className="mt-4 font-display text-6xl font-bold tracking-[0.32em] text-gold-bright drop-shadow-[0_2px_10px_rgb(0_0_0/0.8)] sm:text-7xl">
          WORLDLINE
        </h1>
        <p className="mt-2 font-display text-sm tracking-[0.35em] text-parchment/70 uppercase">Rewrite the history of tomorrow</p>
        <div className="gilt-rule mt-4 w-72" />
      </div>

      <div className="pointer-events-auto relative mt-7 mb-6 grid w-[min(920px,calc(100%-2rem))] gap-4 md:grid-cols-[1.15fr_1fr]">
        <NewGameCard name={name} setName={setName} offline={offline} catalogue={catalogue} selected={selected} onSelect={choose} />
        <div className="flex min-w-0 flex-col gap-4">
          <AccountCard offline={offline} />
          <JoinCard name={name} offline={offline} />
          <RecentCard offline={offline} />
          <EditorCard scenarioId={selected?.id ?? null} />
        </div>
      </div>

      <HealthFooter health={health} />
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="hud-panel p-5 text-left">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="flex-1 font-display text-base tracking-[0.18em] text-gold-bright">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function NewGameCard({
  name,
  setName,
  offline,
  catalogue,
  selected,
  onSelect,
}: {
  name: string;
  setName: (n: string) => void;
  offline: boolean;
  catalogue: Catalogue;
  selected?: ScenarioInfo;
  onSelect: (id: string) => void;
}) {
  const [gameName, setGameName] = useState("");
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
      const { gameId } = await api.createGame({ name: title, scenarioId: selected?.id ?? DEFAULT_SCENARIO });
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Your name">
            <input className="hud-input" value={name} maxLength={32} placeholder="e.g. Talleyrand" onChange={(e) => setName(e.target.value)} onBlur={() => storage.setName(name)} />
          </Field>
          <Field label="Game name">
            <input className="hud-input" value={gameName} maxLength={60} placeholder={`${name.trim() || "Your"}'s World`} onChange={(e) => setGameName(e.target.value)} />
          </Field>
        </div>
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="hud-label">Scenario</span>
            {catalogue?.offline && <span className="text-[10.5px] text-parchment/40 italic">{catalogue.error ?? "Offline"} — showing the built-in scenario</span>}
          </div>
          {!catalogue ? (
            <div className="flex h-24 items-center justify-center gap-2 rounded border border-panel-edge/40 text-[12px] text-parchment/50">
              <Spinner className="text-gold" /> Unrolling the maps…
            </div>
          ) : (
            <ul className="hud-scroll -mx-1 max-h-[260px] space-y-1.5 px-1 py-0.5" role="listbox" aria-label="Scenario">
              {catalogue.list.map((s) => (
                <ScenarioOption key={s.id} s={s} active={s.id === selected?.id} onClick={() => onSelect(s.id)} />
              ))}
            </ul>
          )}
        </div>
        {error && <p className="text-xs text-[#f0b2aa]">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" busy={busy} disabled={offline || !catalogue}>
          Found a New World
        </Button>
      </form>
    </Card>
  );
}

function ScenarioOption({ s, active, onClick }: { s: ScenarioInfo; active: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onClick}
        className={`w-full rounded border px-3 py-2 text-left transition-colors ${
          active ? "border-gold/80 bg-gold/[0.09] shadow-[inset_0_0_0_1px_rgb(201_164_92/0.25)]" : "border-panel-edge/45 bg-black/20 hover:border-gold/45 hover:bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-gold-bright" : "bg-panel-edge"}`} />
          <span className="min-w-0 flex-1 truncate font-display text-[14px] text-parchment">{s.name}</span>
          {s.custom ? <Badge tone="blue">Custom{s.author ? ` · ${s.author}` : ""}</Badge> : s.theme !== "modern" && <Badge>{ERA_LABELS[s.theme] ?? s.theme}</Badge>}
        </div>
        <div className="mt-0.5 pl-4 text-[11px] text-gold/70">
          {fmtDate(s.date)} · {s.countries} nations
        </div>
        {s.description && <p className={`mt-1 pl-4 text-[11.5px] leading-snug text-parchment/55 ${active ? "" : "line-clamp-2"}`}>{s.description}</p>}
      </button>
    </li>
  );
}

function AccountCard({ offline }: { offline: boolean }) {
  const user = useAuth((s) => s.user);
  const token = useAuth((s) => s.token);
  const unavailable = useAuth((s) => s.meUnavailable);

  if (token) {
    return (
      <section className="hud-panel flex items-center gap-3 px-5 py-3.5 text-left">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-gold/60 bg-gold/10 text-gold-bright">
          <Icon name="user" size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="hud-label">Signed in</div>
          <div className="truncate font-display text-[14px] text-parchment">{user?.username ?? "Your account"}</div>
          {unavailable && <div className="text-[10.5px] text-parchment/40 italic">Account service unreachable — playing as before.</div>}
        </div>
        <Button size="sm" variant="ghost" icon="logout" onClick={() => void signOut()}>
          Sign out
        </Button>
      </section>
    );
  }

  return (
    <section className="hud-panel px-5 py-4 text-left">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="font-display text-base tracking-[0.18em] text-gold-bright">Account</h2>
        <span className="text-[11px] text-parchment/40">optional — guests can play too</span>
      </div>
      <AuthForm disabled={offline} hint="Keeps your games across devices; needed to publish scenarios." />
    </section>
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

interface ResumeEntry {
  id: string;
  name: string;
  lastPlayed: number;
  /** From /api/me (signed in). */
  myCountry?: string | null;
  summary?: GameSummary;
  local: boolean;
}

const COUNTRY_NAMES = new Map(STATIC_START.countries.map((c) => [c.tag, c.name]));

function RecentCard({ offline }: { offline: boolean }) {
  const [recent, setRecent] = useState<RecentGame[]>(() => storage.recent());
  const [summaries, setSummaries] = useState<Record<string, GameSummary | null>>({});
  const token = useAuth((s) => s.token);
  const me = useAuth((s) => s.me);

  useEffect(() => {
    if (token && !offline) void refreshMe();
  }, [token, offline]);

  const entries = useMemo(() => {
    const out = new Map<string, ResumeEntry>();
    for (const g of me?.games ?? []) out.set(g.id, { id: g.id, name: g.name, lastPlayed: g.lastPlayed, myCountry: g.myCountry, summary: g, local: false });
    for (const g of recent) {
      const ex = out.get(g.id);
      if (ex) ex.lastPlayed = Math.max(ex.lastPlayed, g.lastPlayed);
      else out.set(g.id, { ...g, local: true });
    }
    return [...out.values()].sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, 12);
  }, [me, recent]);

  // Local-only entries: ask the server whether they still exist.
  useEffect(() => {
    if (offline) return;
    let alive = true;
    for (const g of entries) {
      if (!g.local || g.id in summaries) continue;
      api
        .game(g.id)
        .then((s) => alive && setSummaries((m) => ({ ...m, [g.id]: s })))
        .catch((e) => alive && e instanceof ApiError && e.status === 404 && setSummaries((m) => ({ ...m, [g.id]: null })));
    }
    return () => {
      alive = false;
    };
  }, [entries, offline]);

  return (
    <Card title="Resume" right={token && me ? <span className="text-[10.5px] text-parchment/40">Your games · this device</span> : undefined}>
      {entries.length === 0 ? (
        <p className="text-xs text-parchment/45 italic">{token ? "Games you play will be listed here, on any device." : "Games you play will be listed here."}</p>
      ) : (
        <ul className="hud-scroll -mx-2 max-h-48 space-y-1">
          {entries.map((g) => {
            const s = g.summary ?? summaries[g.id];
            const gone = s === null;
            const open = () => navigate(`/game/${encodeURIComponent(g.id)}`);
            return (
              <li key={g.id} className="group flex items-center gap-3 rounded px-2 py-1.5 hover:bg-white/[0.04]">
                <button className="min-w-0 flex-1 text-left" onClick={open} disabled={gone}>
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-display text-sm text-parchment">{g.name}</span>
                    {g.myCountry && <Badge tone="grey">{COUNTRY_NAMES.get(g.myCountry) ?? g.myCountry}</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-parchment/45">
                    {gone
                      ? "No longer on the server"
                      : s
                        ? `${fmtShortDate(s.date)} · Turn ${s.turn} · ${s.players.length} player${s.players.length === 1 ? "" : "s"} · ${relTime(g.lastPlayed)}`
                        : `Last played ${relTime(g.lastPlayed)}`}
                  </div>
                </button>
                {!gone && (
                  <Button size="sm" variant="secondary" onClick={open}>
                    Resume
                  </Button>
                )}
                {g.local && (
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
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function EditorCard({ scenarioId }: { scenarioId: string | null }) {
  return (
    <button
      onClick={() => navigate(editorPath(scenarioId))}
      className="hud-panel group flex items-center gap-3 px-5 py-3.5 text-left transition-colors hover:border-gold/70"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded border border-gold/50 bg-gold/10 text-gold-bright">
        <Icon name="brush" size={17} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[14px] tracking-[0.1em] text-gold-bright">Open the scenario editor</span>
        <span className="block text-[11.5px] text-parchment/50">Redraw borders, found nations and publish your own world.</span>
      </span>
      <Icon name="chevronLeft" size={16} className="rotate-180 text-parchment/40 group-hover:text-gold-bright" />
    </button>
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
