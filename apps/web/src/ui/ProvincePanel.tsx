import { useMap } from "../store.ts";

const nf = new Intl.NumberFormat("en-US");

export function ProvincePanel() {
  const meta = useMap((s) => s.meta);
  const scenario = useMap((s) => s.scenario);
  const id = useMap((s) => s.selectedId);
  if (!meta || !scenario || !id) return null;

  const p = meta.provinces[id - 1];
  const owner = scenario.countries[scenario.owners[id]];
  const controller = scenario.countries[scenario.controllers[id]];
  const ownerProvinces = scenario.owners.filter((o) => o === scenario.owners[id]).length;

  return (
    <div className="absolute bottom-4 left-4 w-80 overflow-hidden rounded-md border border-panel-edge bg-panel/92 shadow-2xl backdrop-blur">
      <div className="flex items-center gap-3 border-b border-panel-edge/60 px-4 py-3" style={{ background: `linear-gradient(90deg, ${owner?.color}55, transparent)` }}>
        <span className="h-8 w-8 shrink-0 rounded-sm border border-black/40" style={{ background: owner?.color }} />
        <div className="min-w-0">
          <div className="truncate font-display text-lg leading-tight text-parchment">{p.name}</div>
          <div className="truncate text-xs tracking-wide text-parchment/60 uppercase">{owner?.name ?? "Unclaimed"}</div>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-sm">
        <dt className="text-parchment/50">Area</dt>
        <dd className="text-right text-parchment">{nf.format(p.areaKm2)} km²</dd>
        <dt className="text-parchment/50">Terrain</dt>
        <dd className="text-right text-parchment">{p.coastal ? "Coastal" : "Inland"}</dd>
        <dt className="text-parchment/50">Neighbours</dt>
        <dd className="text-right text-parchment">{p.neighbors.length}</dd>
        <dt className="text-parchment/50">Country regions</dt>
        <dd className="text-right text-parchment">{ownerProvinces}</dd>
        {controller && controller !== owner && (
          <>
            <dt className="text-red-300/80">Occupied by</dt>
            <dd className="text-right text-red-200">{controller.name}</dd>
          </>
        )}
      </dl>
    </div>
  );
}
