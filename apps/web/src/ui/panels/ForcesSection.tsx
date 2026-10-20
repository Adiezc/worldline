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

/** Country panel section: how mobilised the country is and the fronts it fights on, by name. */
export function ForcesSection({ tag }: { tag: string }) {
  const view = useGame((s) => s.view);
  const meta = useMap((s) => s.meta);
  const result = useMemo(() => (view && meta ? frontsForView(view, meta) : null), [view, meta]);
  if (!view || !result) return null;
  const me = result.forces.countries[tag];
  if (!me?.atWar) return null;
  const countries = countryMap(view.countries);
  const name = (t: string) => countries.get(t)?.name ?? t;

  return (
    <>
      <SectionTitle>Forces</SectionTitle>
      <div className="text-[12.5px] text-parchment/60">{me.existential ? "Fully mobilised" : "Mobilised"}</div>
      {me.fronts.length === 0 && <Empty>No land front: forces held at home.</Empty>}
      {me.fronts.length > 0 && (
        <ul className="mt-2 space-y-1">
          {me.fronts.map(({ frontId }) => {
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
                  title="Show this front on the map"
                  className="flex w-full items-center gap-2 rounded border border-fail/25 bg-fail/[0.05] px-2 py-1.5 text-left text-[12px] hover:border-fail/50"
                >
                  <Icon name="swords" size={12} className="shrink-0 text-[#e08a80]" />
                  <span className="min-w-0 flex-1 truncate text-parchment/85">
                    {frontName(enemy.tag, name(enemy.tag)).replace(/^the /, "")}
                    {allied && <span className="text-parchment/45"> · with {name(mine.tag)}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-parchment/50">
                    vs <Flag country={countries.get(enemy.tag) ?? { tag: enemy.tag }} size={12} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
