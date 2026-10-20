import { useEffect, useState } from "react";
import { formableStatus, type Formable, type GameView } from "@worldline/shared";
import { addOrder, deleteOrder } from "../../game/actions.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { getMap } from "../../map/controller.ts";
import { Badge, Bar, Button, Empty, Panel, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";

/**
 * Nations this country can proclaim, Paradox-style: each has a fixed name, flag, colour and
 * territory. Hold every region of it, then order the proclamation; it happens when the turn resolves.
 */
export function FormationPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const me = view.you.country;
  const myName = me ? countryMap(view.countries).get(me)?.name ?? me : null;
  const formables = view.formables.filter((f) => me && f.formers.includes(me));
  const open = formables.filter((f) => !(view.formed ?? []).includes(f.id));
  const formed = formables.filter((f) => (view.formed ?? []).includes(f.id));

  // Leaving the panel clears any territory highlighted from it.
  useEffect(() => () => getMap()?.setMarked([]), []);

  return (
    <Panel title="Form a Nation" subtitle={myName ? `Nations ${myName} can proclaim` : "Unite peoples under a new flag"} onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {!me && <Empty>Spectators cannot found nations.</Empty>}
      {me && !formables.length && <Empty>No nation can be formed from {myName} in this world.</Empty>}
      {me && open.length > 0 && (
        <p className="mb-3 text-[11.5px] leading-snug text-parchment/55">
          Bring every region of a nation's territory under your control, by war, treaty or union, then order its proclamation. It takes effect when the turn resolves.
        </p>
      )}
      <div className="space-y-3">
        {me && open.map((f) => <FormableCard key={f.id} f={f} view={view} me={me} />)}
      </div>
      {formed.length > 0 && (
        <>
          <SectionTitle>Already proclaimed</SectionTitle>
          <ul className="space-y-1">
            {formed.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-[12px] text-parchment/55">
                <Flag country={{ tag: f.id, flag: f.flag, color: f.color, name: f.name }} size={16} />
                {f.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function FormableCard({ f, view, me }: { f: Formable; view: GameView; me: string }) {
  const status = formableStatus(view, f, me);
  const order = useGame((s) => s.orders.find((o) => o.formable === f.id));
  const locked = useGame((s) => s.view?.phase !== "orders" || !!s.view.players.find((p) => p.id === s.view!.you.playerId)?.ready);
  const [showing, setShowing] = useState(false);
  const byTag = countryMap(view.countries);
  const held = status.total - status.missing.length;
  const ready = status.missing.length === 0;

  // Who holds the regions still missing, largest first.
  const holders = new Map<string, number[]>();
  for (const id of status.missing) {
    const t = view.countries[view.controllers[id]]?.tag ?? "?";
    if (!holders.has(t)) holders.set(t, []);
    holders.get(t)!.push(id);
  }
  const missingBy = [...holders].sort((a, b) => b[1].length - a[1].length);

  const show = (ids: number[]) => {
    getMap()?.setMarked(ids);
    getMap()?.focusOn(f.provinces, { maxZoom: 1.2 });
    setShowing(true);
  };

  return (
    <div className="rounded border border-panel-edge/50 bg-black/20 p-3">
      <div className="flex items-start gap-3">
        <Flag country={{ tag: f.id, flag: f.flag, color: f.color, name: f.name }} size={44} className="mt-0.5 shrink-0 ring-1 ring-gold/40" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/40" style={{ background: f.color }} />
            <span className="font-display text-[14px] text-parchment">{f.name}</span>
          </div>
          {f.capital && <div className="text-[11px] text-parchment/45">Capital: {f.capital}</div>}
          <p className="mt-1 text-[11.5px] leading-snug text-parchment/65">{f.concept}</p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <span className="hud-label shrink-0">Territory</span>
        <Bar value={(held / Math.max(1, status.total)) * 100} color={ready ? "#6fbf73" : "#c9a45c"} className="flex-1" />
        <span className="text-[11px] text-parchment/70 tabular-nums">
          {held}/{status.total}
        </span>
      </div>
      {missingBy.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {missingBy.map(([tag, ids]) => (
            <button
              key={tag}
              type="button"
              onClick={() => show(ids)}
              className="flex items-center gap-1 rounded-sm border border-panel-edge/50 px-1.5 py-0.5 text-[11px] text-parchment/70 hover:border-gold/60 hover:text-parchment"
              title="Show these regions on the map"
            >
              <Flag country={byTag.get(tag) ?? { tag }} size={12} />
              {byTag.get(tag)?.name ?? tag}: {ids.length} region{ids.length === 1 ? "" : "s"}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 flex items-center gap-1.5">
        <Button size="sm" variant="ghost" icon="map" onClick={() => (showing ? (getMap()?.setMarked([]), setShowing(false)) : show(status.missing))}>
          {showing ? "Hide" : "Show territory"}
        </Button>
        <div className="flex-1" />
        {order ? (
          <>
            <Badge tone="green">Proclamation ordered</Badge>
            {!locked && (
              <Button size="sm" variant="ghost" onClick={() => deleteOrder(order.id)} title="Withdraw the order">
                Cancel
              </Button>
            )}
          </>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon="crown"
            disabled={!ready || locked}
            title={ready ? "Order the proclamation; it takes effect when the turn resolves" : "Control every region of the territory first"}
            onClick={() => addOrder(`Proclaim the ${f.name}.`, { formable: f.id })}
          >
            Proclaim
          </Button>
        )}
      </div>
    </div>
  );
}
