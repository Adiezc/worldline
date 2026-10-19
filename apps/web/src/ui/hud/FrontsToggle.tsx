import { setShowFronts, useGame } from "../../game/store.ts";
import { Icon } from "../common/Icon.tsx";

/** Map control: show or hide front lines and troop counters (remembered per browser). */
export function FrontsToggle({ className = "" }: { className?: string }) {
  const on = useGame((s) => s.showFronts);
  const wars = useGame((s) => s.view?.wars.length ?? 0);
  return (
    <button
      onClick={() => setShowFronts(!on)}
      title={on ? "Hide front lines and troop estimates" : "Show front lines and troop estimates"}
      aria-pressed={on}
      className={`hud-panel pointer-events-auto flex h-8 items-center gap-1.5 px-2 text-[11px] transition-colors ${
        on ? "text-[#e8a092] ring-1 ring-[#b8483a]/60" : "text-parchment/55 hover:text-parchment"
      } ${className}`}
    >
      <Icon name="swords" size={14} />
      <span>Fronts</span>
      {on && wars > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#c4473a]" />}
    </button>
  );
}
