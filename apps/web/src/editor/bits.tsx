// Small editor-only widgets: country chips and a searchable tag multi-picker over the seed.
import { useMemo, useState } from "react";
import type { Country } from "@worldline/shared";
import { Flag } from "../ui/common/Flag.tsx";
import { Icon } from "../ui/common/Icon.tsx";
import { useEditor } from "./editorStore.ts";

export function useSeedCountries() {
  return useEditor((s) => s.seed?.countries ?? EMPTY);
}
const EMPTY: Country[] = [];

export function useTagMap() {
  const countries = useSeedCountries();
  return useMemo(() => new Map(countries.map((c) => [c.tag, c])), [countries]);
}

export function TagChip({ tag, onRemove }: { tag: string; onRemove?: () => void }) {
  const c = useTagMap().get(tag);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-sm border border-panel-edge/50 bg-black/20 px-1.5 py-px text-[10.5px] text-parchment/80" title={c?.name ?? tag}>
      <Flag country={c ?? { tag }} size={12} title={false} />
      <span className="truncate">{c?.name ?? tag}</span>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-parchment/40 hover:text-[#f0b2aa]" aria-label={`Remove ${c?.name ?? tag}`}>
          <Icon name="close" size={9} />
        </button>
      )}
    </span>
  );
}

/** Searchable multi-select of nations in the working seed. */
export function TagPicker({ value, onChange, placeholder = "Add a nation…", exclude = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; exclude?: string[] }) {
  const countries = useSeedCountries();
  const [q, setQ] = useState("");
  const query = q.trim().toLowerCase();
  const hits = query
    ? countries.filter((c) => !value.includes(c.tag) && !exclude.includes(c.tag) && (c.name.toLowerCase().includes(query) || c.tag.toLowerCase() === query)).slice(0, 6)
    : [];
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1">
          {value.map((t) => (
            <TagChip key={t} tag={t} onRemove={() => onChange(value.filter((x) => x !== t))} />
          ))}
        </div>
      )}
      <div className="relative">
        <input
          className="hud-input py-1 text-[12px]"
          value={q}
          placeholder={placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (hits[0]) {
                onChange([...value, hits[0].tag]);
                setQ("");
              }
            }
          }}
        />
        {hits.length > 0 && (
          <ul className="absolute inset-x-0 top-full z-20 mt-0.5 rounded border border-panel-edge bg-panel py-0.5 shadow-xl">
            {hits.map((c) => (
              <li key={c.tag}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-[12px] text-parchment/85 hover:bg-white/5"
                  onClick={() => {
                    onChange([...value, c.tag]);
                    setQ("");
                  }}
                >
                  <Flag country={c} size={13} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-[10px] text-parchment/35">{c.tag}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
