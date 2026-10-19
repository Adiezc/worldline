import { useEffect, useState } from "react";
import { setJump, setReady } from "../../game/actions.ts";
import { fmtCountdown, fmtDate, JUMP_OPTIONS, jumpLabel } from "../../game/format.ts";
import { useGame, type ProgressStage } from "../../game/store.ts";
import { Spinner } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

const STAGES: Record<ProgressStage, string> = {
  director: "Nations deliberating…",
  votes: "Votes being counted…",
  resolver: "The world responds…",
  applying: "Redrawing the map…",
  consolidating: "Chroniclers at work…",
  done: "Done",
};

export function TopBar() {
  const view = useGame((s) => s.view)!;
  const progress = useGame((s) => s.progress);
  const resolving = view.phase === "resolving";

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
      <div className="hud-panel pointer-events-auto flex h-12 items-center gap-4 rounded-t-none border-t-0 px-5 whitespace-nowrap">
        <div className="flex flex-col items-center leading-none">
          <span className="font-display text-[17px] text-parchment">{fmtDate(view.date)}</span>
          <span className="mt-1 text-[10px] tracking-[0.2em] text-gold/80 uppercase">Turn {view.turn}</span>
        </div>
        <span className="h-7 w-px bg-panel-edge/70" />
        {resolving ? (
          <div className="flex min-w-64 items-center gap-2.5 font-display text-[13px] tracking-[0.1em] text-gold-bright">
            <Spinner />
            <span className="animate-hud-pulse">{STAGES[progress?.stage ?? "director"]}</span>
            {progress?.detail && <span className="max-w-48 truncate font-sans text-[11px] tracking-normal text-parchment/50">{progress.detail}</span>}
            <Elapsed />
          </div>
        ) : (
          <>
            <JumpSelector />
            <Countdown deadline={view.turnDeadline} />
            <ReadyButton />
          </>
        )}
      </div>
    </div>
  );
}

function JumpSelector() {
  const view = useGame((s) => s.view)!;
  const { jumpVoting, jumpDays } = view.settings;
  const mine = view.jumpVotes[view.you.playerId];
  const value = jumpVoting ? mine ?? jumpDays : jumpDays;
  const editable = jumpVoting ? !!view.you.country : view.you.isHost;
  const tally = new Map<number, number>();
  for (const d of Object.values(view.jumpVotes)) tally.set(d, (tally.get(d) ?? 0) + 1);
  const tallyText = [...tally].map(([d, n]) => `${jumpLabel(d)} ×${n}`).join(", ");

  return (
    <label className="flex items-center gap-2" title={jumpVoting ? `Votes: ${tallyText || "none yet"}` : editable ? "Time to advance this turn" : "Set by the host"}>
      <span className="hud-label">{jumpVoting ? "Your vote" : "Advance"}</span>
      <select className="hud-input h-8 w-auto py-0 font-display text-[12.5px]" disabled={!editable} value={value} onChange={(e) => setJump(Number(e.target.value))}>
        {JUMP_OPTIONS.map((o) => (
          <option key={o.days} value={o.days}>
            {o.label}
          </option>
        ))}
      </select>
      {jumpVoting && tally.size > 0 && <span className="text-[10.5px] text-parchment/45">{Object.keys(view.jumpVotes).length} vote{Object.keys(view.jumpVotes).length === 1 ? "" : "s"}</span>}
    </label>
  );
}

function ReadyButton() {
  const view = useGame((s) => s.view)!;
  const me = view.players.find((p) => p.id === view.you.playerId);
  const active = view.players.filter((p) => p.country);
  const readyCount = active.filter((p) => p.ready).length;
  if (!me?.country) return <span className="text-xs text-parchment/50 italic">Spectating · {readyCount}/{active.length} ready</span>;
  const ready = me.ready;
  return (
    <button
      onClick={() => setReady(!ready)}
      className={`flex h-9 items-center gap-2.5 rounded border px-4 font-display text-[13px] tracking-[0.12em] transition-colors ${
        ready
          ? "border-success/70 bg-success/15 text-[#c8ecc9] hover:bg-success/25"
          : "border-gold/80 bg-gradient-to-b from-[#b48a45] to-[#8a6630] text-[#1d140a] hover:from-[#c79a52] hover:to-[#9a7338]"
      }`}
      title={ready ? "Click to keep editing your orders" : "Submit your orders and wait for the others"}
    >
      {ready ? "Ready ✓" : "End Turn"}
      <span className="rounded-sm bg-black/20 px-1.5 font-sans text-[11px] font-semibold tracking-normal" title="Players ready">
        {readyCount}/{active.length} ready
      </span>
    </button>
  );
}

function Countdown({ deadline }: { deadline?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [deadline]);
  if (!deadline) return null;
  // Accept seconds or milliseconds since the epoch.
  const ms = (deadline < 1e11 ? deadline * 1000 : deadline) - now;
  const urgent = ms < 30_000;
  return (
    <span className={`flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[13px] tabular-nums ${urgent ? "animate-hud-pulse border-fail/60 text-[#f0b2aa]" : "border-panel-edge text-parchment/80"}`} title="Time left this turn">
      <Icon name="clock" size={13} /> {fmtCountdown(ms)}
    </span>
  );
}

/** Time since resolution started, so a slow AI turn visibly ticks instead of looking frozen. */
function Elapsed() {
  const [start] = useState(() => Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = Math.floor((Date.now() - start) / 1000);
  return (
    <span className="font-sans text-[11px] tracking-normal text-parchment/45 tabular-nums" title="Free AI models can take a few minutes per turn">
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
    </span>
  );
}
