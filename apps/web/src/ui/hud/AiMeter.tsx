import { useGame } from "../../game/store.ts";

/** Top-right: AI provider badge and today's request budget. */
export function AiMeter() {
  const ai = useGame((s) => s.view!.ai);
  const status = useGame((s) => s.status);
  const pct = ai.dailyLimit > 0 ? Math.min(100, (ai.usedToday / ai.dailyLimit) * 100) : 0;
  const color = pct > 90 ? "#d0574d" : pct > 70 ? "#d9a441" : "#c9a45c";
  return (
    <div
      className="hud-panel pointer-events-auto absolute top-3 right-3 flex h-9 items-center gap-2.5 px-3"
      title={ai.dailyLimit > 0 ? `${ai.usedToday} of ${ai.dailyLimit} AI requests used today` : `${ai.usedToday} AI requests today`}
    >
      <span className={`h-2 w-2 rounded-full ${status === "open" ? "bg-success" : "animate-hud-pulse bg-partial"}`} title={status === "open" ? "Connected" : "Reconnecting"} />
      <span
        className={`rounded-sm border px-1.5 py-px text-[9.5px] font-semibold tracking-[0.12em] uppercase ${
          ai.provider === "mock" ? "border-white/20 text-parchment/60" : "border-gold/60 text-gold-bright"
        }`}
      >
        {ai.provider === "mock" ? "Mock AI" : "OpenRouter"}
      </span>
      <div className="w-20">
        <div className="h-1 overflow-hidden rounded-full bg-black/50">
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
        </div>
        <div className="mt-0.5 text-[9.5px] text-parchment/50 tabular-nums">
          {ai.usedToday.toLocaleString()}{ai.dailyLimit > 0 ? ` / ${ai.dailyLimit.toLocaleString()}` : " requests"} today
        </div>
      </div>
    </div>
  );
}
