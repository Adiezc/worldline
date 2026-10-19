// Pick a generated flag: a pattern plus 2–3 colours, with a live preview. Value and output are
// "gen:<pattern>:<c1>,<c2>[,<c3>]" references.
import { FLAG_PATTERNS, genFlag, parseFlag, type FlagPattern } from "@worldline/shared";
import { Flag } from "./Flag.tsx";

const PATTERN_LABELS: Record<FlagPattern, string> = {
  vertical: "Vertical tricolour",
  horizontal: "Horizontal tricolour",
  "bicolor-v": "Vertical bicolour",
  "bicolor-h": "Horizontal bicolour",
  nordic: "Nordic cross",
  canton: "Canton",
  diagonal: "Diagonal",
  "triband-star": "Band and star",
};

export function FlagDesigner({ value, onChange, tag = "NEW", name }: { value: string; onChange: (flag: string) => void; tag?: string; name?: string }) {
  const parsed = parseFlag(value);
  const pattern: FlagPattern = parsed?.kind === "gen" ? parsed.pattern : "vertical";
  const colors = parsed?.kind === "gen" ? parsed.colors : ["#1f4fa0", "#f4f1e8", "#c8102e"];
  const set = (p: FlagPattern, cs: string[]) => onChange(genFlag(p, cs));

  return (
    <div className="flex gap-3">
      <Flag country={{ tag, flag: genFlag(pattern, colors), name: name || "the new nation" }} size={72} className="mt-0.5 ring-1 ring-gold/40" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Flag pattern">
          {FLAG_PATTERNS.map((p) => (
            <button
              key={p}
              type="button"
              role="radio"
              aria-checked={p === pattern}
              title={PATTERN_LABELS[p]}
              onClick={() => set(p, colors)}
              className={`rounded-[3px] p-[2px] ${p === pattern ? "bg-gold/70" : "hover:bg-white/15"}`}
            >
              <Flag country={{ tag, flag: genFlag(p, colors) }} size={22} title={false} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {colors.map((c, i) => (
            <input
              key={i}
              type="color"
              value={c}
              aria-label={`Flag colour ${i + 1}`}
              onChange={(e) => set(pattern, colors.map((x, k) => (k === i ? e.target.value : x)))}
              className="h-7 w-9 cursor-pointer rounded border border-panel-edge bg-transparent p-0.5"
            />
          ))}
          {colors.length < 3 ? (
            <button type="button" onClick={() => set(pattern, [...colors, "#e9b72c"])} className="rounded px-1.5 text-[11px] text-parchment/50 hover:text-parchment">
              + colour
            </button>
          ) : (
            <button type="button" onClick={() => set(pattern, colors.slice(0, 2))} className="rounded px-1.5 text-[11px] text-parchment/50 hover:text-parchment">
              − colour
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
