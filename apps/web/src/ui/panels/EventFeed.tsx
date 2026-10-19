import type { GameEvent } from "@worldline/shared";
import { fmtShortDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { CountryChip, Empty } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

/** Bottom chronicle: your news / world news. */
export function EventFeed() {
  const open = useGame((s) => s.feedOpen);
  const tab = useGame((s) => s.feedTab);
  const events = useGame((s) => s.view!.events);
  const list = events.filter((e) => e.scope === tab).slice().reverse();
  const latest = events[events.length - 1];

  return (
    <div className="pointer-events-auto absolute bottom-3 left-[384px] right-[332px] flex justify-center">
      <section className={`hud-panel flex w-full max-w-[640px] flex-col overflow-hidden transition-[height] duration-200 ${open ? "h-[240px]" : "h-10"}`}>
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
        {open && (
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

function Tab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-2.5 py-1 text-[11px] tracking-wider uppercase transition-colors ${active ? "bg-gold/15 text-gold-bright ring-1 ring-gold/50" : "text-parchment/50 hover:text-parchment"}`}
    >
      {children}
    </button>
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
