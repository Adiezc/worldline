import { closeResults, countryName, startPlayback } from "../../game/actions.ts";
import { fmtDate, fmtGdp, fmtPop, fmtRelation, fmtShortDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import type { GameEvent, NationChange, StatKey } from "@worldline/shared";
import { Badge, Button, Modal, SectionTitle, TagFlag, outcomeColor, outcomeTone } from "../common/ui.tsx";
import { InterveneButton } from "./Intervene.tsx";

export function TurnResultModal() {
  const open = useGame((s) => s.resultOpen);
  const r = useGame((s) => s.lastResult);
  const prevOrders = useGame((s) => s.prevOrders);
  const orders = useGame((s) => s.orders);
  const canIntervene = useGame((s) => !!s.view?.you.isHost && (s.view.intervenable?.length ?? 0) > 0);
  const myTag = useGame((s) => s.view?.you.country);
  if (!open || !r) return null;
  const mineNation = r.nations.find((n) => n.tag === myTag);
  const textOf = (id: string) => prevOrders[id] ?? orders.find((o) => o.id === id)?.text;
  const events = [...r.events].sort((a, b) => a.date.localeCompare(b.date));
  const mine = events.filter((e) => e.scope === "player");
  const world = events.filter((e) => e.scope === "world");

  return (
    <Modal className="flex w-[min(600px,calc(100%-2rem))] flex-col">
      <header className="shrink-0 border-b border-panel-edge/50 px-6 pt-5 pb-4 text-center">
        <div className="hud-label">The world turns</div>
        <h2 className="mt-1 font-display text-2xl tracking-[0.12em] text-gold-bright">Turn {r.turn}</h2>
        <div className="mt-1 font-display text-[13px] text-parchment/70">
          {fmtDate(r.fromDate)} <span className="mx-1.5 text-gold">→</span> {fmtDate(r.toDate)}
        </div>
      </header>
      <div className="hud-scroll min-h-0 flex-1 px-6 py-4">
        {r.verdicts.length > 0 && (
          <>
            <SectionTitle>Your orders</SectionTitle>
            <ul className="space-y-2">
              {r.verdicts.map((v) => (
                <li key={v.orderId} className="rounded border-l-[3px] bg-black/20 py-2 pr-3 pl-3" style={{ borderColor: outcomeColor(v.outcome) }}>
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-parchment/90">{v.text ?? textOf(v.orderId) ?? "Order"}</span>
                    <Badge tone={outcomeTone(v.outcome)}>{v.outcome === "success" ? "Success" : v.outcome === "partial" ? "Partial" : "Failed"}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] leading-snug text-parchment/55">{v.reason}</p>
                </li>
              ))}
            </ul>
          </>
        )}
        {mineNation && <NationReport n={mineNation} />}
        {r.votes.length > 0 && (
          <>
            <SectionTitle>Votes</SectionTitle>
            <ul className="space-y-1.5">
              {r.votes.map((v) => (
                <li key={v.resolutionId} className="flex items-start gap-2 text-[12.5px]">
                  <span className="w-12 shrink-0 font-display font-bold text-parchment/85">{v.orgAbbrev}</span>
                  <span className="min-w-0 flex-1 leading-snug text-parchment/70">{v.summary || v.text}</span>
                  <Badge tone={v.status === "passed" ? "green" : v.status === "vetoed" ? "amber" : "red"}>{v.status}</Badge>
                </li>
              ))}
            </ul>
          </>
        )}
        {canIntervene && events.length > 0 && (
          <p className="mt-4 rounded border border-gold/30 bg-gold/[0.05] px-3 py-2 text-[11.5px] leading-snug text-parchment/60">
            As host you can <b className="text-gold-bright">intervene</b> at any event below: time stops there, later events are discarded, and everyone gives new orders from that day.
          </p>
        )}
        <Headlines title="Concerning you" events={mine} />
        <Headlines title="Around the world" events={world} />
        {events.length === 0 && <p className="py-4 text-center text-sm text-parchment/50 italic">A quiet stretch of history.</p>}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-panel-edge/50 px-6 py-3">
        <Button variant="ghost" onClick={closeResults}>
          Continue
        </Button>
        {events.length > 0 && (
          <Button variant="primary" icon="play" onClick={startPlayback}>
            Watch events
          </Button>
        )}
      </footer>
    </Modal>
  );
}

const STAT_TILES: { key: StatKey; label: string; short?: string; value: (v: number) => string; percent?: boolean; higherIsWorse?: boolean }[] = [
  { key: "gdp", label: "GDP", value: fmtGdp, percent: true },
  { key: "population", label: "Population", value: fmtPop, percent: true },
  { key: "stability", label: "Stability", value: (v) => String(Math.round(v)) },
  { key: "military", label: "Military", value: (v) => String(Math.round(v)) },
  { key: "warExhaustion", label: "War exhaustion", short: "Exhaustion", value: (v) => String(Math.round(v)), higherIsWorse: true },
];

/** Signed change ("+0.5%", "−2"), or null when it rounds to nothing. */
function fmtChange(d: number, percent?: boolean) {
  const digits = Math.abs(d) >= 10 ? 0 : Math.abs(d) >= 1 ? 1 : 2;
  const text = String(Number(Math.abs(d).toFixed(digits)));
  if (text === "0") return null;
  return `${d > 0 ? "+" : "−"}${text}${percent ? "%" : ""}`;
}

const changeColor = (d: number, higherIsWorse?: boolean) => ((d > 0) !== !!higherIsWorse ? "#8fd18f" : "#e08a80");

/** A change in its colour, or a muted dash when there is none. */
function Change({ d, percent, higherIsWorse }: { d: number; percent?: boolean; higherIsWorse?: boolean }) {
  const text = fmtChange(d, percent);
  if (!text) return <span className="text-parchment/35">—</span>;
  return <span style={{ color: changeColor(d, higherIsWorse) }}>{text}</span>;
}

/** How the player's nation moved this turn: stats, land and the relations that shifted most. */
function NationReport({ n }: { n: NationChange }) {
  const land: { label: string; pair: [number, number]; higherIsWorse?: boolean }[] = [
    { label: "regions", pair: n.regions.owned },
    { label: "occupied by others", pair: n.regions.occupied, higherIsWorse: true },
    { label: "held abroad", pair: n.regions.occupying },
  ];
  return (
    <>
      <SectionTitle>Your nation</SectionTitle>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
        {STAT_TILES.map((t) => {
          const [from, to] = n.stats[t.key];
          const d = t.percent ? (from > 0 ? (to / from - 1) * 100 : 0) : to - from;
          return (
            <div key={t.key} className="rounded border border-panel-edge/30 bg-black/15 px-2 py-1.5" title={`${t.label}: ${t.value(from)} → ${t.value(to)}`}>
              <div className="hud-label truncate text-[9.5px]">{t.short ?? t.label}</div>
              <div className="mt-0.5 font-display text-[14px] text-parchment tabular-nums">{t.value(to)}</div>
              <div className="text-[11px] tabular-nums">
                <Change d={d} percent={t.percent} higherIsWorse={t.higherIsWorse} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 text-[12px] text-parchment/65">
        {land.filter((l) => l.pair[0] || l.pair[1] || l.label === "regions").map((l, i) => {
          const d = l.pair[1] - l.pair[0];
          return (
            <span key={l.label}>
              {i > 0 && <span className="mx-1.5 text-parchment/30">·</span>}
              <span className="text-parchment/85 tabular-nums">{l.pair[1]}</span> {l.label}
              {d !== 0 && (
                <span className="ml-1 tabular-nums">
                  (<Change d={d} higherIsWorse={l.higherIsWorse} />)
                </span>
              )}
            </span>
          );
        })}
      </div>
      {n.relations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="hud-label text-[9.5px]">Relations</span>
          {n.relations.map((rel) => (
            <span
              key={rel.tag}
              className="inline-flex items-center gap-1 rounded-sm border border-panel-edge/50 bg-black/20 px-1.5 text-[11px] text-parchment/85"
              title={`Relations with ${countryName(rel.tag)}: ${fmtRelation(rel.from)} → ${fmtRelation(rel.to)}`}
            >
              <TagFlag tag={rel.tag} size={12} />
              {countryName(rel.tag)}
              <span className="tabular-nums">
                <Change d={Math.round(rel.to - rel.from)} />
              </span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

function Headlines({ title, events }: { title: string; events: GameEvent[] }) {
  if (!events.length) return null;
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <ul className="space-y-0.5">
        {events.map((e) => (
          <li key={e.id} className="group -mx-1.5 flex items-start gap-3 rounded px-1.5 py-0.5 text-[12.5px] leading-snug hover:bg-white/[0.03]">
            <span className="w-20 shrink-0 pt-px text-[11px] text-gold/70 tabular-nums">{fmtShortDate(e.date)}</span>
            <span className="min-w-0 flex-1 text-parchment/85">{e.headline}</span>
            <span className="shrink-0 opacity-60 group-hover:opacity-100">
              <InterveneButton event={e} />
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
