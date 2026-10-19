import { MapView } from "./map/MapView.tsx";
import { TopBar } from "./ui/TopBar.tsx";
import { ProvincePanel } from "./ui/ProvincePanel.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { useMap } from "./store.ts";

export function App() {
  const status = useMap((s) => s.status);
  const error = useMap((s) => s.error);
  return (
    <div className="relative h-full w-full select-none">
      <MapView />
      <TopBar />
      <ProvincePanel />
      <Tooltip />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#16222d]">
          <h1 className="font-display text-5xl tracking-[0.3em] text-gold">WORLDLINE</h1>
          <p className="mt-4 text-sm tracking-widest text-parchment/60 uppercase">
            {status === "error" ? `Could not load the map: ${error}` : "Drawing the world…"}
          </p>
        </div>
      )}
    </div>
  );
}
