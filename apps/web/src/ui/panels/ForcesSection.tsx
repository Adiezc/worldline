import { useMemo } from "react";
import { frontName } from "@worldline/shared";
import { frontsForView } from "../../game/fronts.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { getMap } from "../../map/controller.ts";
import { useMap } from "../../store.ts";
import { Empty, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";
import { Icon } from "../common/Icon.tsx";

/** Country panel section: estimated divisions in total, in reserve and on each front. */
export function ForcesSection({ tag }: { tag: string }) {
  const view = useGame((s) => s.view);
  const meta = useMap((s) => s.meta);
  const result = useMemo(() => (view && meta ? frontsForView(view, meta) : null), [view, meta]);
  if (!view || !result) return null;
  const me = result.forces.countries[tag];
  if (!me) return null;
  const countries = countryMap(view.countries);
  const name = (t: string) => countries.get(t)?.name ?? t;
  const deployed = me.total - me.reserve;

  return (
    <>
      <SectionTitle right={<span className="text-[10px] text-parchment/40 italic">estimated</span>}>Forces</SectionTitle>
      <div className="flex items-baseline justify-between text-[12.5px]">
        <span className="text-parchment/60">Strength</span>
        <span className="font-semibold text-parchment tabular-nums">
          ~{me.total} division{me.total === 1 ? "" : "s"}
        </span>
      </div>
      {me.atWar && (
        <div className="mt-0.5 flex items-baseline justify-between text-[11.5px] text-parchment/55">
          <span>{me.existential ? "Fully mobilised" : "Mobilised"}</span>
          <span className="tabular-nums">
            {deployed} at the front · {me.reserve} in reserve
          </span>
        </div>
      )}
      {me.atWar && me.fronts.length === 0 && <Empty>No land front: forces held at home.</Empty>}
      {me.fronts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {me.fronts.map(({ frontId, divisions }) => {
            const front = result.fronts.find((f) => f.id === frontId);
            const ff = result.forces.fronts[frontId];
            if (!front || !ff) return null;
            const mine = ff.a.by.some((b) => b.tag === tag) ? ff.a : ff.b;
            const enemy = mine === ff.a ? ff.b : ff.a;
            const allied = mine.tag !== tag;
            return (
              <li key={frontId}>
                <button
                  onClick={() => getMap()?.focusOn(front.pairs.flat(), { maxZoom: 1.6 })}
                  title={`${name(tag)}: ~${divisions} divisions on ${frontName(enemy.tag, name(enemy.tag))} (est.)`}
                  className="flex w-full items-center gap-2 rounded border border-fail/25 bg-fail/[0.05] px-2 py-1.5 text-left text-[12px] hover:border-fail/50"
                >
                  <Icon name="swords" size={12} className="shrink-0 text-[#e08a80]" />
                  <span className="min-w-0 flex-1 truncate text-parchment/85">
                    {frontName(enemy.tag, name(enemy.tag)).replace(/^the /, "")}
                    {allied && <span className="text-parchment/45"> · with {name(mine.tag)}</span>}
                  </span>
                  <span className="shrink-0 font-semibold text-parchment tabular-nums">{divisions}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-parchment/50 tabular-nums" title={`${name(enemy.tag)} side: ~${enemy.divisions}`}>
                    vs <Flag country={countries.get(enemy.tag) ?? { tag: enemy.tag }} size={12} /> {enemy.divisions}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1.5 text-[10.5px] leading-snug text-parchment/35 italic">
        (estimated) Divisions derived from military, population, economy and war exhaustion; for display only.
      </p>
    </>
  );
}
