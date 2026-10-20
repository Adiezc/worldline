import type { Country } from "@worldline/shared";
import { fmtGdp, fmtPop } from "../../game/format.ts";
import { Bar } from "./ui.tsx";

export const stabilityColor = (v: number) => (v > 60 ? "#6fbf73" : v > 35 ? "#d9a441" : "#d0574d");

/**
 * A nation's attributes at a glance: economy and population as tiles, stability, military and war
 * exhaustion as meters. `rank` adds the country's place among the world's economies. War exhaustion
 * only shows when the nation has any, unless `always` asks for every meter.
 */
export function NationStats({ country: c, rank, always }: { country: Country; rank?: number; always?: boolean }) {
  return (
    <>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
        <Stat label="GDP" value={fmtGdp(c.gdp)} note={rank ? `#${rank} economy` : undefined} />
        <Stat label="Population" value={fmtPop(c.population)} />
      </dl>
      <div className="mt-2.5 space-y-2">
        <Meter label="Stability" value={c.stability} color={stabilityColor(c.stability)} />
        <Meter label="Military" value={c.military} color="#8fa9c9" />
        {(always || c.warExhaustion >= 1) && (
          <Meter label="War exhaustion" value={c.warExhaustion} color={c.warExhaustion > 50 ? "#d0574d" : "#b98a5a"} />
        )}
      </div>
    </>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded border border-panel-edge/30 bg-black/15 px-2.5 py-1.5">
      <dt className="hud-label text-[9.5px]">{label}</dt>
      <dd className="mt-0.5 font-display text-[15px] text-parchment tabular-nums">{value}</dd>
      {note && <dd className="text-[10px] text-parchment/45">{note}</dd>}
    </div>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11.5px]">
        <span className="text-parchment/60">{label}</span>
        <span className="text-parchment/85 tabular-nums">{Math.round(value)}</span>
      </div>
      <Bar value={value} color={color} />
    </div>
  );
}
