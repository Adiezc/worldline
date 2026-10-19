import { closeResults, startPlayback } from "../../game/actions.ts";
import { fmtDate, fmtShortDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import type { GameEvent } from "@worldline/shared";
import { Badge, Button, Modal, SectionTitle, outcomeColor, outcomeTone } from "../common/ui.tsx";
import { InterveneButton } from "./Intervene.tsx";

export function TurnResultModal() {
  const open = useGame((s) => s.resultOpen);
  const r = useGame((s) => s.lastResult);
  const prevOrders = useGame((s) => s.prevOrders);
  const orders = useGame((s) => s.orders);
  const canIntervene = useGame((s) => !!s.view?.you.isHost && (s.view.intervenable?.length ?? 0) > 0);
  if (!open || !r) return null;
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
