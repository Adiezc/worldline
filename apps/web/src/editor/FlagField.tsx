// Editor control for Country.flag: automatic, a real flag by ISO code, a historical flag or a generated design.
import { useState } from "react";
import { deriveFlag, parseFlag, type Country } from "@worldline/shared";
import { Flag, hasIsoFlag } from "../ui/common/Flag.tsx";
import { FlagDesigner } from "../ui/common/FlagDesigner.tsx";
import { HISTORICAL_FLAGS } from "../flags/historical.ts";

type Mode = "auto" | "iso" | "hist" | "gen";
const MODES: [Mode, string][] = [["auto", "Automatic"], ["iso", "Real (ISO)"], ["hist", "Historical"], ["gen", "Designed"]];
const HIST_IDS = Object.keys(HISTORICAL_FLAGS).sort();

export function FlagField({ country, onChange }: { country: Country; onChange: (flag: string | undefined) => void }) {
  const parsed = parseFlag(country.flag);
  // Local, so "Real (ISO)" can be chosen before a valid code is typed.
  const [mode, setMode] = useState<Mode>(parsed?.kind ?? "auto");
  const [isoDraft, setIsoDraft] = useState(parsed?.kind === "iso" ? parsed.code : "");
  const isoOk = hasIsoFlag(isoDraft);

  const switchTo = (m: Mode) => {
    if (m === mode) return;
    setMode(m);
    if (m === "auto") onChange(undefined);
    else if (m === "iso") isoOk && onChange(`iso:${isoDraft}`);
    else if (m === "hist") onChange(`hist:${HIST_IDS[0]}`);
    else onChange(deriveFlag(country.color, country.tag));
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Flag country={country} size={36} />
        <div className="flex flex-wrap gap-1">
          {MODES.map(([m, label]) => (
            <button
              key={m}
              type="button"
              onClick={() => switchTo(m)}
              className={`rounded-sm border px-1.5 py-0.5 text-[11px] ${m === mode ? "border-gold/70 bg-gold/15 text-parchment" : "border-panel-edge/50 text-parchment/55 hover:text-parchment"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === "auto" && <p className="text-[11px] text-parchment/40">Generated from the colour and tag.</p>}
      {mode === "iso" && (
        <div className="flex items-center gap-2">
          <input
            className={`hud-input w-20 font-mono lowercase ${isoDraft && !isoOk ? "border-fail/70" : ""}`}
            value={isoDraft}
            maxLength={6}
            placeholder="fr"
            aria-label="ISO 3166-1 alpha-2 code"
            onChange={(e) => {
              const v = e.target.value.toLowerCase().replace(/[^a-z-]/g, "");
              setIsoDraft(v);
              if (hasIsoFlag(v)) onChange(`iso:${v}`);
            }}
          />
          <span className="text-[11px] text-parchment/40">{isoDraft && !isoOk ? "No flag for this code." : "ISO 3166-1 alpha-2 code"}</span>
        </div>
      )}
      {mode === "hist" && (
        <select className="hud-input" value={parsed?.kind === "hist" ? parsed.id : ""} onChange={(e) => onChange(`hist:${e.target.value}`)}>
          {parsed?.kind === "hist" && !HISTORICAL_FLAGS[parsed.id] && <option value={parsed.id}>{parsed.id} (unknown)</option>}
          {HIST_IDS.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      )}
      {mode === "gen" && <FlagDesigner value={country.flag ?? ""} onChange={onChange} tag={country.tag} name={country.name} />}
    </div>
  );
}
