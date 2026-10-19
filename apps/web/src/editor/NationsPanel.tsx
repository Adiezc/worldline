// Left editor column: scenario details and the searchable list of nations.
import { useMemo, useState } from "react";
import type { EraTheme } from "@worldline/shared";
import { Field } from "../ui/common/ui.tsx";
import { Flag } from "../ui/common/Flag.tsx";
import { Icon } from "../ui/common/Icon.tsx";
import { getMap } from "../map/controller.ts";
import { addCountry, selectCountryIdx, updateMeta, useEditor } from "./editorStore.ts";

const THEMES: { id: EraTheme; label: string }[] = [
  { id: "modern", label: "Modern" },
  { id: "coldwar", label: "Cold War" },
  { id: "custom", label: "Custom" },
];

export function NationsPanel() {
  const seed = useEditor((s) => s.seed)!;
  const rev = useEditor((s) => s.rev);
  const selected = useEditor((s) => s.selected);
  const [query, setQuery] = useState("");
  const [metaOpen, setMetaOpen] = useState(true);
  const [briefOpen, setBriefOpen] = useState(false);

  const counts = useMemo(() => {
    const out = new Array<number>(seed.countries.length).fill(0);
    for (let id = 1; id < seed.owners.length; id++) if (seed.owners[id] >= 0) out[seed.owners[id]]++;
    return out;
    // `rev` tracks in-place paint edits of seed.owners.
  }, [rev, seed.owners, seed.countries.length]);

  const q = query.trim().toLowerCase();
  const rows = seed.countries
    .map((c, i) => ({ c, i, n: counts[i] ?? 0 }))
    .filter(({ c }) => !q || c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q))
    .sort((a, b) => a.c.name.localeCompare(b.c.name));

  return (
    <section className="hud-panel pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden">
      <button className="flex shrink-0 items-center gap-2 border-b border-panel-edge/50 px-4 py-2.5 text-left" onClick={() => setMetaOpen(!metaOpen)}>
        <h2 className="flex-1 font-display text-[15px] tracking-[0.12em] text-gold-bright">Scenario</h2>
        <Icon name={metaOpen ? "chevronUp" : "chevronDown"} size={14} className="text-parchment/50" />
      </button>
      {metaOpen && (
        <div className="hud-scroll max-h-[46%] shrink-0 space-y-2.5 border-b border-panel-edge/50 px-4 py-3">
          <Field label="Name">
            <input className="hud-input" value={seed.name} maxLength={80} onChange={(e) => updateMeta({ name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Field label="Start date">
              <input type="date" className="hud-input [color-scheme:dark]" value={seed.date} onChange={(e) => e.target.value && updateMeta({ date: e.target.value })} />
            </Field>
            <Field label="Era look">
              <select className="hud-input" value={seed.theme ?? "modern"} onChange={(e) => updateMeta({ theme: e.target.value as EraTheme })}>
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className="hud-input min-h-[52px] resize-none text-[12px] leading-snug" rows={2} maxLength={400} value={seed.description ?? ""} placeholder="One or two sentences for the scenario picker." onChange={(e) => updateMeta({ description: e.target.value })} />
          </Field>
          <div>
            <button className="flex w-full items-center gap-1.5 text-left" onClick={() => setBriefOpen(!briefOpen)}>
              <span className="hud-label flex-1">World brief for the AI</span>
              <Icon name={briefOpen ? "chevronUp" : "chevronDown"} size={12} className="text-parchment/45" />
            </button>
            {briefOpen && (
              <textarea
                className="hud-input mt-1 min-h-[110px] resize-y text-[11.5px] leading-snug"
                value={seed.worldBrief}
                onChange={(e) => updateMeta({ worldBrief: e.target.value })}
                placeholder="The state of the world at the start date, as the AI should understand it."
              />
            )}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-2 px-4 pt-3 pb-2">
        <h3 className="hud-label flex-1">Nations · {seed.countries.length}</h3>
        <button onClick={addCountry} className="flex items-center gap-1 rounded border border-gold/50 px-2 py-0.5 text-[11px] text-gold-bright hover:bg-gold/10" title="Create a new nation and start painting it">
          <Icon name="plus" size={11} /> Add country
        </button>
      </div>
      <div className="shrink-0 px-4 pb-2">
        <div className="relative">
          <Icon name="search" size={12} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-parchment/40" />
          <input className="hud-input py-1 pl-7 text-[12px]" value={query} placeholder="Search nations…" onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <ul className="hud-scroll min-h-0 flex-1 px-2 pb-2">
        {rows.map(({ c, i, n }) => (
          <li key={c.tag + i}>
            <button
              onClick={() => selectCountryIdx(i === selected ? -1 : i)}
              onDoubleClick={() => getMap()?.focusOn({ country: i }, { maxZoom: 2 })}
              title="Click to select · double-click to find on the map"
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${i === selected ? "bg-gold/15 ring-1 ring-gold/50" : "hover:bg-white/[0.04]"}`}
            >
              <Flag country={c} size={16} />
              <span className={`min-w-0 flex-1 truncate text-[12.5px] ${n === 0 ? "text-parchment/40 italic" : "text-parchment/90"}`}>{c.name}</span>
              <span className="w-9 text-right text-[10px] text-parchment/35">{c.tag}</span>
              <span className="w-8 text-right text-[11px] text-parchment/55 tabular-nums" title={`${n} region${n === 1 ? "" : "s"}`}>
                {n}
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="px-2 py-2 text-[11.5px] text-parchment/40 italic">No nation matches.</li>}
      </ul>
    </section>
  );
}
