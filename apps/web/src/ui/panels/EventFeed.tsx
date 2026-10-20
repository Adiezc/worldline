import { useMemo } from "react";
import type { CalendarEntry, Effect, GameEvent, GameView } from "@worldline/shared";
import { describeEffects, type EffectTone } from "../../game/effects.ts";
import { fmtShortDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { CountryChip, Empty } from "../common/ui.tsx";
import { Icon, type IconName } from "../common/Icon.tsx";

/** Bottom chronicle: your news / world news / the annals (consolidated memory + calendar). */
export function EventFeed() {
  const open = useGame((s) => s.feedOpen);
  const tab = useGame((s) => s.feedTab);
  const events = useGame((s) => s.view!.events);
  const list = tab === "annals" ? [] : events.filter((e) => e.scope === tab).slice().reverse();
  const latest = events[events.length - 1];

  return (
    <div className="pointer-events-auto absolute bottom-3 left-[384px] right-[332px] flex justify-center">
      <section className={`hud-panel flex w-full max-w-[640px] flex-col overflow-hidden transition-[height] duration-200 ${open ? (tab === "annals" ? "h-[300px]" : "h-[240px]") : "h-10"}`}>
        <header className="flex h-10 shrink-0 items-center gap-2 px-3">
          <button onClick={() => useGame.setState({ feedOpen: !open })} className="flex items-center gap-2 text-gold-bright" title={open ? "Collapse" : "Expand"}>
            <Icon name={open ? "chevronDown" : "chevronUp"} size={14} />
            <span className="font-display text-[13px] tracking-[0.14em]">Chronicle</span>
          </button>
          {open ? (
            <div className="ml-2 flex gap-1">
              <Tab active={tab === "player"} onClick={() => useGame.setState({ feedTab: "player" })}>
                Your news
              </Tab>
              <Tab active={tab === "world"} onClick={() => useGame.setState({ feedTab: "world" })}>
                World news
              </Tab>
              <Tab active={tab === "annals"} onClick={() => useGame.setState({ feedTab: "annals" })}>
                Annals
              </Tab>
            </div>
          ) : (
            latest && (
              <button onClick={() => useGame.setState({ feedOpen: true, feedTab: latest.scope })} className="ml-2 min-w-0 flex-1 truncate text-left text-[12px] text-parchment/65 hover:text-parchment">
                <span className="text-parchment/40">{fmtShortDate(latest.date)} — </span>
                {latest.headline}
              </button>
            )
          )}
        </header>
        {open && tab === "annals" && <Annals />}
        {open && tab !== "annals" && (
          <div className="hud-scroll min-h-0 flex-1 space-y-2 border-t border-panel-edge/40 px-3 py-2.5">
            {list.length === 0 && <Empty>{tab === "player" ? "Nothing yet concerns you directly." : "The world is quiet."}</Empty>}
            {list.map((e) => (
              <EventCard key={e.id} e={e} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const KIND_ICONS: Record<CalendarEntry["kind"], IconName> = { election: "ballot", summit: "users", deadline: "clock", event: "calendar" };
const KIND_LABELS: Record<CalendarEntry["kind"], string> = { election: "Election", summit: "Summit", deadline: "Deadline", event: "Scheduled event" };

/** Consolidated chronicles (newest first) beside the calendar of what is coming. */
function Annals() {
  const memory = useGame((s) => s.view!.memory);
  const calendar = useGame((s) => s.view!.calendar);
  const date = useGame((s) => s.view!.date);
  const entries = annalsOf(memory);
  const upcoming = (calendar ?? []).filter((c) => c.date >= date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);

  return (
    <div className="flex min-h-0 flex-1 border-t border-panel-edge/40">
      <div className="hud-scroll min-h-0 flex-1 space-y-2.5 px-3 py-2.5">
        {entries.length === 0 && <Empty>The chroniclers have not yet written. Summaries of past turns gather here as history accumulates.</Empty>}
        {entries.map((m) => (
          <article key={m.upToTurn} className="letter px-3 py-2">
            <div className="font-display text-[10.5px] tracking-[0.16em] text-[#6b4f22] uppercase">{m.from === m.upToTurn ? `Turn ${m.upToTurn}` : `Turns ${m.from}–${m.upToTurn}`}</div>
            <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line select-text">{m.text}</p>
          </article>
        ))}
      </div>
      <aside className="hud-scroll min-h-0 w-[40%] max-w-[220px] shrink-0 border-l border-panel-edge/40 px-2.5 py-2.5">
        <h4 className="hud-label mb-1.5">Upcoming</h4>
        {upcoming.length === 0 && <Empty>Nothing scheduled.</Empty>}
        <ul className="space-y-1.5">
          {upcoming.map((c, i) => (
            <li key={`${c.date}-${i}`} className="flex gap-2" title={[KIND_LABELS[c.kind], c.note].filter(Boolean).join(" — ")}>
              <Icon name={KIND_ICONS[c.kind] ?? "calendar"} size={13} className="mt-0.5 text-gold/75" />
              <div className="min-w-0">
                <div className="text-[10px] tracking-wide text-gold/65 uppercase tabular-nums">{fmtShortDate(c.date)}</div>
                <div className="text-[11.5px] leading-snug text-parchment/80">{c.title}</div>
              </div>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

/** Memory entries newest first, each with the first turn it covers. */
function annalsOf(memory: GameView["memory"]) {
  const sorted = [...(memory ?? [])].sort((a, b) => a.upToTurn - b.upToTurn);
  return sorted.map((m, i) => ({ ...m, from: i === 0 ? 1 : sorted[i - 1].upToTurn + 1 })).reverse();
}

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-2.5 py-1 text-[11px] tracking-wider whitespace-nowrap uppercase transition-colors ${active ? "bg-gold/15 text-gold-bright ring-1 ring-gold/50" : "text-parchment/50 hover:text-parchment"}`}
    >
      {children}
    </button>
  );
}

const TONES: Record<EffectTone, string> = {
  up: "border-success/45 text-[#bfe6c0]",
  down: "border-fail/45 text-[#f0b2aa]",
  neutral: "border-gold/35 text-parchment/75",
};

/** What an event changed under the rules, as small chips: the first few, then a count. */
export function EffectChips({ effects, max = 6 }: { effects: Effect[]; max?: number }) {
  const countries = useGame((s) => s.view?.countries);
  const organizations = useGame((s) => s.view?.organizations);
  const notes = useMemo(() => (countries && organizations ? describeEffects(effects, { countries, organizations }) : []), [effects, countries, organizations]);
  if (!notes.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {notes.slice(0, max).map((n, i) => (
        <span key={i} className={`rounded-sm border bg-black/20 px-1.5 text-[10.5px] leading-[18px] ${TONES[n.tone]}`}>
          {n.text}
        </span>
      ))}
      {notes.length > max && (
        <span className="px-1 text-[10.5px] leading-[18px] text-parchment/45" title={notes.slice(max).map((n) => n.text).join("\n")}>
          +{notes.length - max} more
        </span>
      )}
    </div>
  );
}

export function EventCard({ e, compact }: { e: GameEvent; compact?: boolean }) {
  return (
    <article className="rounded border border-panel-edge/35 bg-black/20 px-3 py-2">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-[10.5px] tracking-wide text-gold/70 uppercase tabular-nums">{fmtShortDate(e.date)}</span>
        <h4 className="font-display text-[13px] leading-snug text-parchment">{e.headline}</h4>
      </div>
      {!compact && e.body && <p className="mt-1 text-[12px] leading-relaxed text-parchment/65 select-text">{e.body}</p>}
      {!compact && <EffectChips effects={e.effects} />}
      {e.countries.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {e.countries.slice(0, 8).map((t) => (
            <CountryChip key={t} tag={t} small />
          ))}
        </div>
      )}
    </article>
  );
}
