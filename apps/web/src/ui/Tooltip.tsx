import { useMap } from "../store.ts";
import { useGame } from "../game/store.ts";

/** Region name and owner under the cursor, from the live view (or the static start map). */
export function Tooltip() {
  const meta = useMap((s) => s.meta);
  const scenario = useMap((s) => s.scenario);
  const view = useGame((s) => s.view);
  const id = useMap((s) => s.hoverId);
  const pointer = useMap((s) => s.pointer);
  const world = view ?? scenario;
  if (!meta || !world || !id) return null;

  const p = meta.provinces[id - 1];
  if (!p) return null;
  const owner = world.countries[world.owners[id]];
  const controller = world.countries[world.controllers[id]];
  const holder = view && owner ? view.players.find((pl) => pl.country === owner.tag) : undefined;
  const left = Math.min(pointer.x + 16, window.innerWidth - 240);
  const top = Math.min(pointer.y + 18, window.innerHeight - 90);

  return (
    <div className="pointer-events-none fixed z-50 max-w-56 rounded border border-panel-edge bg-panel/95 px-3 py-2 shadow-xl" style={{ left, top }}>
      <div className="font-display text-sm leading-tight text-parchment">{p.name}</div>
      <div className="mt-1 flex items-center gap-1.5 text-xs text-parchment/65">
        <span className="h-2.5 w-2.5 rounded-sm border border-black/40" style={{ background: owner?.color }} />
        {owner?.name ?? "Unclaimed"}
      </div>
      {controller && controller !== owner && <div className="mt-0.5 text-xs text-red-300/85">Occupied by {controller.name}</div>}
      {holder && <div className="mt-0.5 text-[11px] text-gold/80">Played by {holder.name}</div>}
      {view?.phase === "lobby" && owner && !holder && <div className="mt-1 text-[10.5px] tracking-wider text-parchment/45 uppercase">Click to claim</div>}
    </div>
  );
}
