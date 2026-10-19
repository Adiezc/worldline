import { skipPlayback } from "../../game/actions.ts";
import { fmtDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { Button, CountryChip } from "../common/ui.tsx";
import { InterveneButton } from "./Intervene.tsx";

/** Headline card shown while the turn's events replay on the map. */
export function PlaybackCard() {
  const pb = useGame((s) => s.playback);
  if (!pb) return null;
  const i = Math.max(0, Math.min(pb.index, pb.events.length - 1));
  const e = pb.events[i];
  const started = pb.index >= 0;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[60px] z-30 flex justify-center">
      <div className="hud-panel pointer-events-auto w-[min(460px,calc(100%-2rem))] overflow-hidden">
        <div className="h-0.5 bg-black/40">
          <div className="h-full bg-gold transition-[width] duration-700" style={{ width: `${((pb.index + 1) / pb.events.length) * 100}%` }} />
        </div>
        <div key={e?.id} className="px-4 py-3 animate-hud-in">
          <div className="flex items-center gap-2">
            <span className="hud-label">{started ? fmtDate(e.date) : "Rewinding the map…"}</span>
            <span className="ml-auto text-[10.5px] text-parchment/40 tabular-nums">
              {Math.max(1, pb.index + 1)} / {pb.events.length}
            </span>
          </div>
          {started && e && (
            <>
              <h3 className="mt-1 font-display text-[15px] leading-snug text-parchment">{e.headline}</h3>
              {e.body && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-parchment/60">{e.body}</p>}
              {e.countries.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {e.countries.slice(0, 6).map((t) => (
                    <CountryChip key={t} tag={t} small />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-1 border-t border-panel-edge/40 px-3 py-1.5">
          {pb.paused && <span className="mr-auto text-[10.5px] tracking-wider text-parchment/40 uppercase">Paused</span>}
          {started && e && <InterveneButton event={e} inPlayback />}
          <Button size="sm" variant="ghost" icon="skip" onClick={skipPlayback}>
            Skip
          </Button>
        </div>
      </div>
    </div>
  );
}
