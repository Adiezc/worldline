import { useEffect, useState } from "react";
import { connectGame, disconnectGame, retryConnection } from "../game/connection.ts";
import { handleMapClick } from "../game/actions.ts";
import { resetGame, useGame } from "../game/store.ts";
import { onMapClick } from "../map/controller.ts";
import { storage } from "../net/storage.ts";
import { navigate } from "../router.ts";
import { useMap } from "../store.ts";
import { Button, Field, Spinner } from "./common/ui.tsx";
import { Lobby } from "./lobby/Lobby.tsx";
import { Hud } from "./hud/Hud.tsx";

export function GameScreen({ gameId }: { gameId: string }) {
  const [named, setNamed] = useState(() => !!storage.name());

  useEffect(() => {
    if (!named) return;
    connectGame(gameId);
    const off = onMapClick(handleMapClick);
    return () => {
      off();
      disconnectGame();
      resetGame(null);
      useMap.getState().setSelected(0);
    };
  }, [gameId, named]);

  if (!named) return <NamePrompt onDone={() => setNamed(true)} />;
  return <GameContent />;
}

function GameContent() {
  const phase = useGame((s) => s.view?.phase);
  const status = useGame((s) => s.status);
  const detail = useGame((s) => s.statusDetail);

  if (!phase) {
    return (
      <div className="absolute inset-0 z-10 grid place-items-center bg-black/50">
        <div className="hud-panel w-[min(420px,calc(100%-2rem))] p-6 text-center">
          {status === "failed" ? (
            <>
              <h2 className="font-display text-lg tracking-[0.15em] text-gold-bright">Could not join</h2>
              <p className="mt-2 text-sm text-parchment/70">{detail ?? "The game server did not answer."}</p>
              <div className="mt-5 flex justify-center gap-2">
                <Button variant="ghost" onClick={() => navigate("/")}>
                  Main menu
                </Button>
                <Button variant="primary" onClick={retryConnection} icon="refresh">
                  Try again
                </Button>
              </div>
            </>
          ) : (
            <>
              <Spinner className="h-5 w-5 text-gold" />
              <p className="mt-3 font-display text-sm tracking-[0.2em] text-parchment/80 uppercase">
                {status === "reconnecting" ? "Reconnecting…" : "Joining the world…"}
              </p>
              {detail && <p className="mt-2 text-xs text-parchment/50">{detail}</p>}
              <Button variant="ghost" size="sm" className="mt-4" onClick={() => navigate("/")}>
                Back to menu
              </Button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {phase === "lobby" ? <Lobby /> : <Hud />}
      {(status === "reconnecting" || status === "connecting" || status === "failed") && (
        <div className="pointer-events-auto absolute top-[104px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-partial/60 bg-panel/95 px-4 py-1.5 text-xs text-[#f1d39a] shadow-lg">
          {status === "failed" ? (
            <>
              Connection lost.
              <button className="underline hover:text-parchment" onClick={retryConnection}>
                Retry
              </button>
            </>
          ) : (
            <>
              <Spinner /> Reconnecting to the server…
            </>
          )}
        </div>
      )}
    </>
  );
}

function NamePrompt({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-black/55">
      <form
        className="hud-panel w-[min(380px,calc(100%-2rem))] space-y-4 p-6"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          storage.setName(name);
          onDone();
        }}
      >
        <h2 className="font-display text-lg tracking-[0.15em] text-gold-bright">You have been invited</h2>
        <Field label="Your name">
          <input autoFocus className="hud-input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} placeholder="How other leaders will know you" />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => navigate("/")}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Enter the game
          </Button>
        </div>
      </form>
    </div>
  );
}
