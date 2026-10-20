import { governmentTraits, parseLeaders, type Country, type TraitTone } from "@worldline/shared";
import { Badge } from "./ui.tsx";
import { Icon } from "./Icon.tsx";

const TONE: Record<TraitTone, "grey" | "blue" | "amber" | "red"> = { neutral: "grey", ideology: "blue", warning: "amber", danger: "red" };

/**
 * How a nation is governed and by whom: the form of government, its system and the traits its
 * label names (federal, ideology, authoritarian, dominant party…) as chips, then each office-holder
 * with their title. The full label stays one hover away.
 */
export function Government({ country: c, className = "" }: { country: Pick<Country, "government" | "leader">; className?: string }) {
  const g = governmentTraits(c.government);
  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1" title={c.government}>
        <Badge tone="gold">{g.form}</Badge>
        {g.system && <Badge tone="grey">{g.system}</Badge>}
        {g.traits.map((t) => (
          <Badge key={t.label} tone={TONE[t.tone]}>{t.label}</Badge>
        ))}
      </div>
      <ul className="mt-2 space-y-0.5">
        {parseLeaders(c.leader).map((l, i) => (
          <li key={i} className="flex items-baseline gap-1.5 text-[12px] leading-snug">
            <Icon name="user" size={11} className="shrink-0 translate-y-px text-parchment/40" />
            <span className="text-parchment/90">{l.name}</span>
            {l.title && <span className="text-[11px] text-parchment/50">{l.title}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
