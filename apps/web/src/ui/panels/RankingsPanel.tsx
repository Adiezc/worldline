import { useState } from "react";
import { rankChange, RANK_WEIGHTS, TIER_LABELS, TIER_RULES, type NationRank, type PowerTier, type RankComponent } from "@worldline/shared";
import { selectCountry } from "../../game/actions.ts";
import { TIER_COLORS, TIER_TONES, useRanking } from "../../game/ranking.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { Badge, Bar, Empty, Panel, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";

const PARTS: { key: RankComponent; label: string; color: string }[] = [
  { key: "economy", label: "Economy", color: "#c9a45c" },
  { key: "military", label: "Military", color: "#8fa9c9" },
  { key: "population", label: "Population", color: "#b98a5a" },
  { key: "territory", label: "Territory", color: "#7f9a6a" },
  { key: "nuclear", label: "Nuclear arsenal", color: "#d9822b" },
  { key: "diplomacy", label: "Diplomatic weight", color: "#a58ac9" },
];

const TIERS: PowerTier[] = ["great", "major", "regional", "minor"];

/** Places gained (▲) or lost (▼) since last turn; nothing when there is no record of last turn. */
export function RankChange({ change, className = "" }: { change: number | null; className?: string }) {
  if (change === null) return null;
  const title = change === 0 ? "Unchanged since last turn" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} since last turn`;
  if (change === 0) return <span title={title} className={`text-[10px] text-parchment/35 ${className}`}>–</span>;
  return (
    <span title={title} className={`text-[10px] tabular-nums ${change > 0 ? "text-[#8fd18f]" : "text-[#e08a80]"} ${className}`}>
      {change > 0 ? "▲" : "▼"}
      {Math.abs(change)}
    </span>
  );
}

/** One line of breakdown for tooltips: "Economy 14.4 · Military 14.4 · …". */
export const partsTitle = (r: NationRank) =>
  `Score ${r.score}: ${PARTS.filter((p) => r.parts[p.key] > 0).map((p) => `${p.label} ${r.parts[p.key]}`).join(" · ")} · stability ×${r.cohesion}`;

/**
 * Paradox-style power ranking: every nation's place, tier and score, worked out each turn from
 * economy, military, population, territory, nuclear arms and diplomatic weight.
 */
export function RankingsPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const { list } = useRanking();
  const me = view.you.country;
  const mine = list.find((r) => r.tag === me) ?? null;
  const [showMinor, setShowMinor] = useState(false);
  const lead = list[0]?.score || 1;

  return (
    <Panel title="Power Rankings" subtitle={`${list.length} nations · turn ${view.turn}`} onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {mine && <MyRank r={mine} change={rankChange(view, mine.tag, mine.rank)} />}
      {me && !mine && <Empty>Your nation is no longer ranked.</Empty>}

      {TIERS.map((tier) => {
        const rows = list.filter((r) => r.tier === tier);
        if (!rows.length) return null;
        const hidden = tier === "minor" && !showMinor;
        return (
          <div key={tier}>
            <SectionTitle right={<span className="text-[10.5px] text-parchment/40 tabular-nums">{rows.length}</span>}>
              <span style={{ color: TIER_COLORS[tier] }}>{TIER_LABELS[tier]}s</span>
            </SectionTitle>
            {hidden ? (
              <button className="text-[11.5px] text-parchment/50 underline-offset-2 hover:text-parchment hover:underline" onClick={() => setShowMinor(true)}>
                Show {rows.length} minor powers
              </button>
            ) : (
              <ul className="space-y-px">
                {rows.map((r) => (
                  <RankRow key={r.tag} r={r} lead={lead} me={r.tag === me} change={rankChange(view, r.tag, r.rank)} />
                ))}
              </ul>
            )}
          </div>
        );
      })}

      <p className="mt-4 text-[10.5px] leading-snug text-parchment/40">
        Great Powers are the top {TIER_RULES[0].maxRank}, Major Powers the top {TIER_RULES[1].maxRank} and Regional Powers the top {TIER_RULES[2].maxRank}, each
        needing a fair share of the leader's score. Stability scales the total; war weariness drags it down.
      </p>
    </Panel>
  );
}

function MyRank({ r, change }: { r: NationRank; change: number | null }) {
  return (
    <div className="mb-1 rounded border border-gold/40 bg-gold/[0.06] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-display text-[22px] leading-none text-gold-bright tabular-nums">#{r.rank}</span>
        <RankChange change={change} className="text-[11px]" />
        <Badge tone={TIER_TONES[r.tier]} className="ml-auto">{TIER_LABELS[r.tier]}</Badge>
      </div>
      <div className="mt-1 text-[11px] text-parchment/55">
        Score <span className="text-parchment/85 tabular-nums">{r.score}</span> · stability and war weariness ×{r.cohesion}
      </div>
      <div className="mt-2 space-y-1.5">
        {PARTS.map((p) => (
          <div key={p.key}>
            <div className="mb-0.5 flex justify-between text-[11px]">
              <span className="text-parchment/60">{p.label}</span>
              <span className="text-parchment/80 tabular-nums">
                {r.parts[p.key]} <span className="text-parchment/35">/ {RANK_WEIGHTS[p.key]}</span>
              </span>
            </div>
            <Bar value={r.parts[p.key]} max={RANK_WEIGHTS[p.key]} color={p.color} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RankRow({ r, lead, me, change }: { r: NationRank; lead: number; me: boolean; change: number | null }) {
  const c = useGame((s) => (s.view ? countryMap(s.view.countries).get(r.tag) : undefined));
  return (
    <li>
      <button
        onClick={() => selectCountry(r.tag, { focus: true })}
        title={partsTitle(r)}
        className={`w-full rounded-sm px-1.5 py-1 text-left ${me ? "bg-gold/15 ring-1 ring-gold/50" : "hover:bg-white/5"}`}
      >
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="w-6 shrink-0 text-right text-parchment/50 tabular-nums">{r.rank}</span>
          <span className="w-6 shrink-0">
            <RankChange change={change} />
          </span>
          <Flag country={c ?? { tag: r.tag }} size={14} title={false} />
          <span className={`min-w-0 flex-1 truncate ${me ? "text-gold-bright" : "text-parchment/85"}`}>{c?.name ?? r.tag}</span>
          <span className="shrink-0 text-parchment/70 tabular-nums">{r.score.toFixed(1)}</span>
        </div>
        {/* What the score is made of, scaled to the leader's. */}
        <div className="mt-0.5 ml-[60px] flex h-[3px] overflow-hidden rounded-full bg-black/30" style={{ width: `calc((100% - 60px) * ${Math.min(1, r.score / lead).toFixed(3)})` }}>
          {PARTS.map((p) => (
            <span key={p.key} style={{ flexGrow: r.parts[p.key], background: p.color }} />
          ))}
        </div>
      </button>
    </li>
  );
}
