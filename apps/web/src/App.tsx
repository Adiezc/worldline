import { MapView } from "./map/MapView.tsx";
import { MapSync } from "./game/MapSync.tsx";
import { Tooltip } from "./ui/Tooltip.tsx";
import { Toasts } from "./ui/Toasts.tsx";
import { MainMenu } from "./ui/menu/MainMenu.tsx";
import { GameScreen } from "./ui/GameScreen.tsx";
import { EditorScreen } from "./editor/EditorScreen.tsx";
import { useMap } from "./store.ts";
import { useRoute } from "./router.ts";

export function App() {
  const route = useRoute();
  const status = useMap((s) => s.status);
  const error = useMap((s) => s.error);
  return (
    <div className="relative h-full w-full select-none">
      <MapView />
      <MapSync />
      {status !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#16222d]">
          <h1 className="font-display text-5xl tracking-[0.3em] text-gold">WORLDLINE</h1>
          <p className="mt-4 text-sm tracking-widest text-parchment/60 uppercase">
            {status === "error" ? `Could not load the map: ${error}` : "Drawing the world…"}
          </p>
        </div>
      )}
      {route.name === "menu" && <MainMenu />}
      {route.name === "game" && <GameScreen key={route.id} gameId={route.id} />}
      {route.name === "editor" && <EditorScreen base={route.base} />}
      {route.name !== "editor" && <Tooltip />}
      <Toasts />
    </div>
  );
}
