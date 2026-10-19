// Publish the edited seed (POST /api/scenarios, signed in), then offer to play it.
import { useState } from "react";
import { createPortal } from "react-dom";
import { api, ApiError, errorText } from "../net/api.ts";
import { refreshMe, useAuth } from "../net/auth.ts";
import { invalidateScenarios } from "../net/scenarios.ts";
import { storage } from "../net/storage.ts";
import { navigate } from "../router.ts";
import { Button, Modal } from "../ui/common/ui.tsx";
import { Icon } from "../ui/common/Icon.tsx";
import { AuthForm } from "../ui/common/AuthForm.tsx";
import { buildRequest, localIssues, useEditor } from "./editorStore.ts";

export function SaveDialog({ onClose }: { onClose: () => void }) {
  const seed = useEditor((s) => s.seed)!;
  const savedId = useEditor((s) => s.savedId);
  const dirty = useEditor((s) => s.dirty);
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; details: string[] } | null>(null);
  const [starting, setStarting] = useState(false);
  const { errors, warnings } = localIssues(seed);
  const justSaved = !!savedId && !dirty;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.saveScenario(buildRequest(seed));
      invalidateScenarios();
      useEditor.setState({ savedId: id, dirty: false });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setError({ message: "Your session has expired — sign in again.", details: [] });
        void refreshMe(); // drops the stale token, which brings back the sign-in form
      }
      else if (e instanceof ApiError && (e.status === 404 || e.status === 405)) setError({ message: "This server can't store scenarios yet. Use Export JSON to keep your work.", details: [] });
      else setError({ message: errorText(e), details: e instanceof ApiError ? e.details : [] });
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    if (!savedId) return;
    setStarting(true);
    setError(null);
    try {
      if (!storage.name() && user) storage.setName(user.username);
      const { gameId } = await api.createGame({ name: seed.name.trim() || "Custom World", scenarioId: savedId });
      storage.touchRecent({ id: gameId, name: seed.name.trim() || "Custom World" });
      navigate(`/game/${encodeURIComponent(gameId)}`);
    } catch (e) {
      setError({ message: errorText(e), details: [] });
      setStarting(false);
    }
  }

  return createPortal(
    <Modal onClose={onClose} className="flex w-[min(480px,calc(100%-2rem))] flex-col">
      <header className="border-b border-panel-edge/50 px-5 pt-4 pb-3">
        <div className="hud-label">Publish scenario</div>
        <h2 className="mt-0.5 truncate font-display text-[18px] tracking-[0.1em] text-gold-bright">{seed.name || "Untitled"}</h2>
        <p className="text-[11.5px] text-parchment/50">
          {seed.countries.length} nations · starts {seed.date}
        </p>
      </header>
      <div className="hud-scroll min-h-0 space-y-3 px-5 py-4">
        {justSaved ? (
          <div className="rounded border border-success/50 bg-success/10 px-3 py-2.5 text-[12.5px] text-[#bfe6c0]">
            <div className="flex items-center gap-2 font-display tracking-[0.08em]">
              <Icon name="check" size={14} /> Saved
            </div>
            <p className="mt-1 text-[11.5px] text-parchment/65">
              It now appears in the New Game scenario list as <code className="text-parchment/85">{savedId}</code>. Each further save publishes a new copy.
            </p>
          </div>
        ) : (
          <>
            {errors.length > 0 && (
              <ul className="space-y-1 rounded border border-fail/50 bg-fail/10 px-3 py-2 text-[12px] text-[#f0b2aa]">
                {errors.map((x) => (
                  <li key={x}>• {x}</li>
                ))}
              </ul>
            )}
            {warnings.length > 0 && (
              <ul className="space-y-1 rounded border border-partial/40 bg-partial/[0.07] px-3 py-2 text-[11.5px] text-[#f1d39a]">
                {warnings.map((x) => (
                  <li key={x}>• {x}</li>
                ))}
              </ul>
            )}
            {!token ? (
              <div className="rounded border border-panel-edge/50 bg-black/20 p-3">
                <p className="mb-2 text-[12.5px] text-parchment/75">Sign in to publish your scenario under your name.</p>
                <AuthForm />
              </div>
            ) : (
              <p className="text-[12px] text-parchment/60">
                Publishing as <b className="text-parchment">{user?.username ?? "you"}</b>. Other players will be able to start games in it.
              </p>
            )}
          </>
        )}
        {error && (
          <div className="rounded border border-fail/50 bg-fail/10 px-3 py-2 text-[12px] text-[#f0b2aa]">
            {error.message}
            {error.details.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-[11px] text-[#f0b2aa]/85">
                {error.details.map((d) => (
                  <li key={d}>• {d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-panel-edge/50 px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          {justSaved ? "Keep editing" : "Cancel"}
        </Button>
        {justSaved ? (
          <Button variant="primary" icon="play" busy={starting} onClick={play}>
            Play this scenario
          </Button>
        ) : (
          <Button variant="primary" icon="save" busy={busy} disabled={!token || errors.length > 0} onClick={save}>
            Save scenario
          </Button>
        )}
      </footer>
    </Modal>,
    document.body,
  );
}
