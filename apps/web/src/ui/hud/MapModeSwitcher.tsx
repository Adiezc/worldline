import { setMapMode } from "../../game/actions.ts";
import { legendFor, MAP_MODES, type MapMode } from "../../game/mapModes.ts";
import { countryMap, focusTag } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { Swatch } from "../common/ui.tsx";
import { Icon, type IconName } from "../common/Icon.tsx";
import { FrontsToggle } from "./FrontsToggle.tsx";

const ICONS: Record<MapMode, IconName> = {
  political: "map",
  relations: "user",
  orgs: "columns",
  wars: "swords",
  disputes: "globe",
  gdp: "sparkle",
  stability: "flag",
  rank: "podium",
};

/** Bottom-right: map mode buttons with a small legend. */
export function MapModeSwitcher() {
  const mode = useGame((s) => s.mapMode);
  const focusName = useGame((s) => {
    const t = focusTag(s);
    return t && s.view ? countryMap(s.view.countries).get(t)?.name ?? t : null;
  });
  const orgName = useGame((s) => {
    const me = s.view?.you.country;
    const id = s.selectedOrg ?? (me ? s.view?.organizations.find((o) => o.members.includes(me))?.id : undefined);
    const org = s.view?.organizations.find((o) => o.id === id);
    return org ? `${org.abbrev} — ${org.name}` : null;
  });
  const legend = legendFor(mode);
  const caption = mode === "relations" || mode === "wars" ? (focusName ? `Relative to ${focusName}` : null) : mode === "orgs" ? orgName ?? "Select an organisation" : null;

  return (
    <div className="pointer-events-auto absolute right-3 bottom-3 flex flex-col items-end gap-1.5">
      {legend && (
        <div className="hud-panel max-w-64 px-3 py-2 text-[11px] text-parchment/75 animate-hud-in">
          {caption && <div className="mb-1.5 truncate font-display text-[11px] tracking-[0.08em] text-gold-bright">{caption}</div>}
          {Array.isArray(legend) ? (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {legend.map((l) => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <Swatch color={l.color} size={9} /> {l.label}
                </span>
              ))}
            </div>
          ) : (
            <div>
              <div className="h-2 w-44 rounded-sm" style={{ background: `linear-gradient(90deg, ${legend.ramp.join(",")})` }} />
              <div className="mt-0.5 flex justify-between text-[10px] text-parchment/50">
                <span>{legend.lo}</span>
                <span>{legend.hi}</span>
              </div>
            </div>
          )}
        </div>
      )}
      <FrontsToggle />
      <div className="hud-panel flex gap-0.5 p-1">
        {MAP_MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => setMapMode(m.id)}
            title={`${m.label} map mode`}
            className={`flex h-8 items-center gap-1.5 rounded px-2 text-[11px] transition-colors ${
              mode === m.id ? "bg-gold/20 text-gold-bright ring-1 ring-gold/60" : "text-parchment/60 hover:bg-white/5 hover:text-parchment"
            }`}
          >
            <Icon name={ICONS[m.id]} size={14} />
            {mode === m.id && <span>{m.label}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}
