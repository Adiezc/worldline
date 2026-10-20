import { useEffect, useRef, useState } from "react";
import { MAX_HOLD_REGIONS, MAX_OFFENSIVE_POINTS, STANCE_LABELS, type Operation, type OperationStance, type OrderVerdict } from "@worldline/shared";
import { addOrder, brainstorm, deleteOrder, editOrder, polishOrder, updateOperation } from "../../game/actions.ts";
import { toast, useGame, type DraftOrder, type OperationDraft } from "../../game/store.ts";
import { fmtShortDate } from "../../game/format.ts";
import { describeOperation, enemiesOf, planOdds, sideOf } from "../../game/operations.ts";
import { countryMap } from "../../game/selectors.ts";
import { getMap, setPickHandler } from "../../map/controller.ts";
import { provinceName, useMap } from "../../store.ts";
import { Badge, Button, Empty, Panel, SectionTitle, outcomeColor, outcomeTone } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

export function OrdersPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const orders = useGame((s) => s.orders);
  const me = view.you.country ? countryMap(view.countries).get(view.you.country) : undefined;
  const locked = view.phase !== "orders" || !!view.players.find((p) => p.id === view.you.playerId)?.ready;
  const drafting = useGame((s) => !!s.opDraft);
  // Closing the panel abandons a plan still being drawn.
  useEffect(() => () => useGame.setState({ opDraft: null }), []);

  return (
    <Panel title="Orders" subtitle={me ? `${me.name} · Turn ${view.turn}` : "Spectating"} onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {!me || me.alive === false ? (
        <Empty>
          {me ? `${me.name} is no more.` : "Spectators cannot issue orders."} To play, select a nation nobody leads on the map and choose
          “Play as”.
        </Empty>
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
          {!locked && drafting && <OperationComposer />}
          {!locked && !drafting && <Composer />}
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
      {order.operation && <PlanSummary op={order.operation} />}
      <div className="flex items-center gap-1 px-2 pt-1 pb-1.5">
        {verdict && <VerdictBadge v={verdict} />}
        <div className="flex-1" />
        {order.operation && (
          <Button size="sm" variant="ghost" icon="map" onClick={() => getMap()?.focusOn(order.operation!.regions, { maxZoom: 1.4 })} title="Show this plan on the map">
            Show
          </Button>
        )}
        {!locked && order.operation && (
          <Button size="sm" variant="ghost" icon="edit" onClick={() => useGame.setState({ opDraft: { ...order.operation!, name: order.operation!.name ?? "", orderId: order.id } })} title="Redraw this plan on the map">
            Redraw
          </Button>
        )}
        {!locked && (
          <>
            {/* A battle plan's text is generated from the map; polishing it would drift from the plan. */}
            {!order.operation && (
              <Button size="sm" variant="ghost" icon="sparkle" busy={polishing} onClick={() => polishOrder(order.id)} title="Let your staff rewrite this order clearly">
                {polishing ? "Polishing" : "Polish"}
              </Button>
            )}
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
      <PlanButton />
    </div>
  );
}

/** "Plan operation": only while your country is at war. */
function PlanButton() {
  const atWar = useGame((s) => {
    const me = s.view?.you.country;
    return !!me && !!s.view?.wars.some((w) => w.attackers.includes(me) || w.defenders.includes(me));
  });
  if (!atWar) return null;
  return (
    <Button
      size="sm"
      variant="secondary"
      icon="swords"
      className="mt-2 w-full"
      title="Draw an offensive or a hold line on the map"
      onClick={() => useGame.setState({ opDraft: { kind: "offensive", regions: [], divisions: 0, stance: "balanced", name: "" } })}
    >
      Plan operation
    </Button>
  );
}

function PlanSummary({ op }: { op: Operation }) {
  const offensive = op.kind === "offensive";
  return (
    <div className="mx-2.5 mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
      <Badge tone={offensive ? "red" : "blue"}>{offensive ? "Offensive" : "Hold line"}</Badge>
      {offensive ? (
        <span className="text-parchment/60">
          {op.divisions} divisions · {STANCE_LABELS[op.stance]} · {op.regions.length - 1} objective{op.regions.length === 2 ? "" : "s"}
        </span>
      ) : (
        <span className="text-parchment/60">{op.regions.length} region{op.regions.length === 1 ? "" : "s"}</span>
      )}
    </div>
  );
}

const STANCES: OperationStance[] = ["cautious", "balanced", "allout"];

/** Draw a battle plan: map clicks add regions while this is open. */
function OperationComposer() {
  const view = useGame((s) => s.view)!;
  const draft = useGame((s) => s.opDraft)!;
  const meta = useMap((s) => s.meta);
  const me = view.you.country!;
  const set = (patch: Partial<OperationDraft>) => useGame.setState((s) => ({ opDraft: s.opDraft && { ...s.opDraft, ...patch } }));

  // Map clicks build the plan; leaving the composer drops an unfinished draft.
  useEffect(() => {
    setPickHandler((id) => {
      const st = useGame.getState();
      const d = st.opDraft, v = st.view;
      if (!d || !v) return;
      const meIdx = v.countries.findIndex((c) => c.tag === me);
      const ctrl = v.controllers[id];
      const regions = d.regions;
      if (d.kind === "hold") {
        if (regions.includes(id)) return set({ regions: regions.filter((x) => x !== id) });
        if (ctrl !== meIdx) return toast(`${provinceName(id)} isn't held by your forces.`, "warn");
        if (regions.length >= MAX_HOLD_REGIONS) return toast(`A hold line covers at most ${MAX_HOLD_REGIONS} regions.`, "warn");
        const meta = useMap.getState().meta;
        const neighbours = meta?.provinces[id - 1]?.neighbors ?? [];
        const enemies = enemiesOf(v, me);
        if (meta && !neighbours.some((n) => enemies.has(v.controllers[n]))) {
          toast(`${provinceName(id)} isn't on the front yet; the line only matters where it faces the enemy.`, "info");
        }
        return set({ regions: [...regions, id] });
      }
      if (!regions.length) {
        if (!sideOf(v, me).has(ctrl)) return toast("Start the arrow in a region your side holds.", "warn");
        return set({ regions: [id] });
      }
      if (regions[regions.length - 1] === id) return set({ regions: regions.slice(0, -1) });
      if (regions.includes(id)) return toast(`${provinceName(id)} is already on the arrow.`, "warn");
      if (regions.length >= MAX_OFFENSIVE_POINTS) return toast(`An arrow has at most ${MAX_OFFENSIVE_POINTS - 1} objectives.`, "warn");
      set({ regions: [...regions, id] });
    });
    return () => setPickHandler(null);
  }, [me]);

  const odds = meta && draft.regions.length ? planOdds(view, meta, me, draft.regions.slice(0, 1)) : null;
  const total = Math.max(1, odds?.total ?? 1);
  // First jump-off point picked: commit about 60% of what holds that front.
  useEffect(() => {
    if (draft.kind === "offensive" && odds && draft.divisions === 0) set({ divisions: Math.max(1, Math.round((odds.own || odds.total * 0.3) * 0.6)) });
  }, [draft.kind, draft.divisions, odds?.own, odds?.total]);

  const offensive = draft.kind === "offensive";
  const ready = offensive ? draft.regions.length >= 2 : draft.regions.length >= 1;
  const ratio = odds && odds.enemy ? draft.divisions / odds.enemy : null;
  const enemyName = odds?.enemyTag ? countryMap(view.countries).get(odds.enemyTag)?.name ?? odds.enemyTag : "the enemy";

  const submit = () => {
    const op: Operation = {
      kind: draft.kind, regions: draft.regions, divisions: Math.max(1, Math.min(total, draft.divisions || 1)),
      stance: draft.stance, ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    };
    if (draft.orderId) updateOperation(draft.orderId, describeOperation(op), op);
    else addOrder(describeOperation(op), { operation: op });
    useGame.setState({ opDraft: null });
  };

  return (
    <div className="mt-3 rounded border border-gold/45 bg-gold/[0.04] p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon name="swords" size={13} className="text-gold" />
        <span className="font-display text-[13px] text-gold-bright">{draft.orderId ? "Redraw operation" : "Plan operation"}</span>
      </div>
      <div className="mb-2 flex overflow-hidden rounded border border-panel-edge/60">
        {(["offensive", "hold"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ kind: k, regions: [], divisions: 0 })}
            className={`flex-1 px-2 py-1 text-[11.5px] ${draft.kind === k ? "bg-gold/20 text-parchment" : "text-parchment/50 hover:text-parchment"}`}
          >
            {k === "offensive" ? "Offensive" : "Hold line"}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-gold-bright/80">
        {offensive
          ? draft.regions.length
            ? "Click the objectives in order. Click the last point again to take it back."
            : "Click a region your side holds to start the arrow."
          : "Click your regions along the front to dig in. Click one again to remove it."}
      </p>
      {draft.regions.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1 text-[11px]">
          {draft.regions.map((id, i) => (
            <span key={id} className="flex items-center gap-1">
              {offensive && i > 0 && <span className="text-gold/60">→</span>}
              <button
                type="button"
                onClick={() => getMap()?.focusOn(id, { zoom: "keep" })}
                className={`rounded-sm border px-1.5 py-0.5 hover:border-gold ${offensive && i === 0 ? "border-success/50 text-[#c8ecc9]" : "border-gold/50 text-parchment"}`}
                title={offensive && i === 0 ? "Jump-off point" : "Show on the map"}
              >
                {provinceName(id)}
              </button>
            </span>
          ))}
        </div>
      )}
      {offensive && draft.regions.length > 0 && (
        <>
          <div className="mb-1 flex items-center justify-between text-[11px] text-parchment/65">
            <span>Divisions committed</span>
            <span className="tabular-nums text-parchment">
              {draft.divisions} <span className="text-parchment/45">of {total}</span>
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={total}
            value={Math.min(total, Math.max(1, draft.divisions))}
            onChange={(e) => set({ divisions: Number(e.target.value) })}
            className="w-full accent-[#c9a45c]"
          />
          {odds && odds.enemy > 0 && (
            <div className="mt-0.5 text-[11px] text-parchment/60">
              vs ~{odds.enemy} divisions of {enemyName} on this front ·{" "}
              <span style={{ color: ratio! >= 1.5 ? "#8fd18f" : ratio! >= 0.8 ? "#e2c46b" : "#e08a80" }}>
                {ratio! >= 1.5 ? "favourable odds" : ratio! >= 0.8 ? "even odds" : "poor odds"}
              </span>
            </div>
          )}
          <div className="mt-2 flex gap-1">
            {STANCES.map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => set({ stance: st })}
                className={`flex-1 rounded-sm border px-1.5 py-1 text-[11px] ${draft.stance === st ? "border-gold/70 bg-gold/15 text-parchment" : "border-panel-edge/50 text-parchment/50 hover:text-parchment"}`}
                title={st === "cautious" ? "Slower, fewer losses" : st === "allout" ? "Faster if it works, heavier losses and exhaustion" : "A steady push"}
              >
                {STANCE_LABELS[st]}
              </button>
            ))}
          </div>
        </>
      )}
      <input
        value={draft.name}
        onChange={(e) => set({ name: e.target.value.slice(0, 40) })}
        placeholder="Operation name (optional)"
        className="hud-input mt-2 py-1 text-[12px]"
      />
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => useGame.setState({ opDraft: null })}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={draft.orderId ? "check" : "plus"} disabled={!ready} onClick={submit}>
          {draft.orderId ? "Update order" : "Add to orders"}
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
