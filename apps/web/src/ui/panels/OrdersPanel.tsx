import { useEffect, useRef, useState } from "react";
import type { OrderVerdict } from "@worldline/shared";
import { addOrder, brainstorm, deleteOrder, editOrder, polishOrder } from "../../game/actions.ts";
import { useGame, type DraftOrder } from "../../game/store.ts";
import { fmtShortDate } from "../../game/format.ts";
import { countryMap } from "../../game/selectors.ts";
import { Badge, Button, Empty, Panel, SectionTitle, outcomeColor, outcomeTone } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

export function OrdersPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const orders = useGame((s) => s.orders);
  const me = view.you.country ? countryMap(view.countries).get(view.you.country) : undefined;
  const locked = view.phase !== "orders" || !!view.players.find((p) => p.id === view.you.playerId)?.ready;

  return (
    <Panel title="Orders" subtitle={me ? `${me.name} · Turn ${view.turn}` : "Spectating"} onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {!me ? (
        <Empty>Spectators cannot issue orders. Claim a nation in the next game to play.</Empty>
      ) : (
        <>
          {locked && view.phase === "orders" && (
            <div className="mb-3 rounded border border-success/40 bg-success/10 px-3 py-2 text-[12px] text-[#c8ecc9]">
              You are ready. Un-ready in the top bar to change your orders.
            </div>
          )}
          {orders.length === 0 && <Empty>No orders yet. Tell your government what to do, in plain words.</Empty>}
          <ol className="space-y-2">
            {orders.map((o, i) => (
              <OrderCard key={o.id} order={o} index={i} locked={locked} />
            ))}
          </ol>
          {!locked && <Composer />}
          {!locked && <Ideas />}
          <LastVerdicts />
          <VerdictHistory />
        </>
      )}
    </Panel>
  );
}

function OrderCard({ order, index, locked }: { order: DraftOrder; index: number; locked: boolean }) {
  const polishing = useGame((s) => Object.values(s.requests).some((r) => r.kind === "polish" && r.orderId === order.id));
  const verdict = useGame((s) => s.view?.lastVerdicts.find((v) => v.orderId === order.id));
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => autosize(ref.current), [order.text]);

  return (
    <li className="group rounded border border-panel-edge/50 bg-black/20 transition-colors focus-within:border-gold/60">
      <div className="flex items-start gap-2 px-2.5 pt-2">
        <span className="mt-0.5 font-display text-[12px] text-gold/70">{toRoman(index + 1)}.</span>
        <textarea
          ref={ref}
          value={order.text}
          disabled={locked || polishing}
          rows={1}
          onChange={(e) => editOrder(order.id, e.target.value)}
          className="min-h-5 flex-1 resize-none bg-transparent text-[13px] leading-snug text-parchment outline-none disabled:opacity-75"
        />
      </div>
      <div className="flex items-center gap-1 px-2 pt-1 pb-1.5">
        {verdict && <VerdictBadge v={verdict} />}
        <div className="flex-1" />
        {!locked && (
          <>
            <Button size="sm" variant="ghost" icon="sparkle" busy={polishing} onClick={() => polishOrder(order.id)} title="Let your staff rewrite this order clearly">
              {polishing ? "Polishing" : "Polish"}
            </Button>
            <button onClick={() => deleteOrder(order.id)} className="rounded p-1.5 text-parchment/35 hover:bg-fail/15 hover:text-[#f0b2aa]" title="Delete order">
              <Icon name="trash" size={13} />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function Composer() {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => autosize(ref.current, 64), [text]);
  const submit = () => {
    if (!text.trim()) return;
    addOrder(text);
    setText("");
  };
  return (
    <div className="mt-3">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Issue a new order… e.g. “Open trade talks with Brazil on agricultural tariffs.” (Ctrl/⌘+Enter to add)"
        className="hud-input min-h-16 resize-none leading-snug"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1" />
        <BrainstormButton />
        <Button size="sm" variant="primary" icon="plus" disabled={!text.trim()} onClick={submit}>
          Add order
        </Button>
      </div>
    </div>
  );
}

function BrainstormButton() {
  const busy = useGame((s) => !!s.brainstormReq && !!s.requests[s.brainstormReq]);
  return (
    <Button size="sm" variant="secondary" icon="sparkle" busy={busy} onClick={() => brainstorm()} title="Ask your cabinet for ideas">
      Brainstorm
    </Button>
  );
}

function Ideas() {
  const ideas = useGame((s) => s.ideas);
  if (!ideas.length) return null;
  return (
    <div className="mt-3">
      <SectionTitle right={<button className="text-[10.5px] text-parchment/40 hover:text-parchment" onClick={() => useGame.setState({ ideas: [] })}>Clear</button>}>
        Cabinet ideas
      </SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {ideas.map((idea, i) => (
          <button
            key={i}
            onClick={() => {
              addOrder(idea);
              useGame.setState((s) => ({ ideas: s.ideas.filter((x) => x !== idea) }));
            }}
            className="group flex max-w-full items-start gap-1.5 rounded-sm border border-gold/30 bg-gold/[0.06] px-2 py-1 text-left text-[12px] leading-snug text-parchment/85 hover:border-gold/70 hover:bg-gold/15"
            title="Add as an order"
          >
            <Icon name="plus" size={11} className="mt-0.5 text-gold" />
            {idea}
          </button>
        ))}
      </div>
    </div>
  );
}

const NO_VERDICTS: OrderVerdict[] = [];

/** Verdicts on last turn's orders, quoting the order where we still know its text. */
function LastVerdicts() {
  const verdicts = useGame((s) => s.view?.lastVerdicts ?? NO_VERDICTS);
  const prev = useGame((s) => s.prevOrders);
  const current = useGame((s) => s.orders);
  const shown = verdicts.filter((v) => !current.some((o) => o.id === v.orderId));
  if (!shown.length) return null;
  return (
    <div className="mt-4">
      <SectionTitle>Last turn</SectionTitle>
      <ul className="space-y-1.5">
        {shown.map((v) => (
          <li key={v.orderId} className="rounded border-l-2 bg-black/15 py-1.5 pr-2 pl-2.5" style={{ borderColor: outcomeColor(v.outcome) }}>
            {(v.text ?? prev[v.orderId]) && <div className="text-[12px] leading-snug text-parchment/80">{v.text ?? prev[v.orderId]}</div>}
            <div className="mt-0.5 flex items-start gap-1.5">
              <VerdictBadge v={v} />
              <span className="text-[11.5px] leading-snug text-parchment/55">{v.reason}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function VerdictBadge({ v }: { v: OrderVerdict }) {
  return (
    <span title={v.reason}>
      <Badge tone={outcomeTone(v.outcome)}>{v.outcome === "success" ? "Success" : v.outcome === "partial" ? "Partial" : "Failed"}</Badge>
    </span>
  );
}

function autosize(el: HTMLTextAreaElement | null, min = 0) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${Math.max(min, el.scrollHeight)}px`;
}

function toRoman(n: number) {
  const map: [number, string][] = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, s] of map) while (n >= v) (out += s), (n -= v);
  return out;
}

type LoggedVerdict = OrderVerdict & { turn: number; date: string };
const NO_LOG: LoggedVerdict[] = [];

/** Your orders from earlier turns and how they turned out, newest first (collapsed by default). */
function VerdictHistory() {
  const log = useGame((s) => s.view?.verdictLog ?? NO_LOG);
  const lastTurn = useGame((s) => (s.view ? s.view.turn - 1 : 0));
  const [open, setOpen] = useState(false);
  const earlier = log.filter((v) => v.turn < lastTurn);
  if (!earlier.length) return null;
  const turns = [...new Set(earlier.map((v) => v.turn))].sort((a, b) => b - a);
  return (
    <div className="mt-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <SectionTitle>Earlier turns ({earlier.length})</SectionTitle>
        <Icon name={open ? "chevronUp" : "chevronDown"} size={12} className="text-parchment/45" />
      </button>
      {open && (
        <div className="space-y-3">
          {turns.map((t) => {
            const items = earlier.filter((v) => v.turn === t);
            return (
              <div key={t}>
                <div className="mb-1 text-[10.5px] tracking-wider text-parchment/40 uppercase">
                  Turn {t} · {fmtShortDate(items[0].date)}
                </div>
                <ul className="space-y-1.5">
                  {items.map((v) => (
                    <li key={v.orderId} className="rounded border-l-2 bg-black/15 py-1.5 pr-2 pl-2.5" style={{ borderColor: outcomeColor(v.outcome) }}>
                      {v.text && <div className="text-[12px] leading-snug text-parchment/75">{v.text}</div>}
                      <div className="mt-0.5 flex items-start gap-1.5">
                        <VerdictBadge v={v} />
                        <span className="text-[11.5px] leading-snug text-parchment/50">{v.reason}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
