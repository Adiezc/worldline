import { useMap } from "../store.ts";

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function TopBar() {
  const scenario = useMap((s) => s.scenario);
  if (!scenario) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center p-3">
      <div className="pointer-events-auto flex items-center gap-5 whitespace-nowrap rounded-b-md border border-t-0 border-panel-edge bg-panel/90 px-6 py-2 shadow-lg backdrop-blur">
        <span className="font-display text-lg tracking-[0.25em] text-gold">WORLDLINE</span>
        <span className="h-5 w-px bg-panel-edge" />
        <span className="font-display text-base text-parchment">{fmt.format(new Date(scenario.date))}</span>
        <span className="hidden text-xs tracking-wider text-parchment/50 uppercase sm:inline">{scenario.name}</span>
      </div>
    </div>
  );
}
