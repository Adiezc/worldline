import { useState } from "react";
import type { Snapshot } from "@worldline/shared";
import { rewindTo } from "../../game/actions.ts";
import { fmtDate, fmtShortDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { errorText } from "../../net/api.ts";
import { exportGame } from "../../net/gameFile.ts";
import { Badge, Button, ConfirmDialog, Empty, Panel, SectionTitle } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

/** Host-only: per-turn snapshots the world can be rewound to. */
export function HistoryPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const pending = useGame((s) => !!s.timeTravel && Date.now() - s.timeTravel.at < 20_000);
  const [confirm, setConfirm] = useState<Snapshot | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const isHost = view.you.isHost;
  const resolving = view.phase === "resolving";
  const snapshots = [...view.snapshots].sort((a, b) => b.turn - a.turn);

  async function download() {
    setExporting(true);
    setExportError(null);
    setExportNote(null);
    try {
      const secret = useGame.getState().secret;
      if (!secret) throw new Error("Reconnect to the game, then export.");
      const dropped = await exportGame(view.id, view.you.playerId, secret);
      if (dropped) setExportNote(`To keep the file importable, it leaves out the ${dropped} oldest rewind point${dropped === 1 ? "" : "s"}.`);
    } catch (err) {
      setExportError(errorText(err, "The game server"));
    }
    setExporting(false);
  }

  return (
    <Panel title="History" subtitle={isHost ? "Rewind the world to an earlier turn" : "Kept by the host"} onClose={onClose} className="h-full" bodyClassName="p-4">
      <div className="flex items-center gap-3 rounded border border-gold/40 bg-gold/[0.06] px-3 py-2.5">
        <Icon name="clock" size={18} className="text-gold" />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] text-parchment">{fmtDate(view.date)}</div>
          <div className="text-[11px] text-parchment/50">Turn {view.turn} · the present</div>
        </div>
      </div>

      {!isHost ? (
        <p className="mt-4 text-[12px] leading-relaxed text-parchment/55 italic">Only the host can turn back the clock. If they do, everyone returns to the restored date together.</p>
      ) : (
        <>
          <SectionTitle>Saved turns</SectionTitle>
          {snapshots.length === 0 && <Empty>Nothing to rewind to yet. A snapshot is kept at the start of every turn.</Empty>}
          <ol className="relative space-y-1.5 border-l border-panel-edge/60 pl-3">
            {snapshots.map((s) => {
              const current = s.turn === view.turn;
              return (
                <li key={s.turn} className="group relative">
                  <span className={`absolute top-3 -left-[17px] h-2 w-2 rounded-full ring-2 ring-panel ${current ? "bg-gold" : "bg-panel-edge"}`} />
                  <div className="flex items-center gap-2 rounded border border-panel-edge/35 bg-black/20 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-display text-[13px] text-parchment">Turn {s.turn}</span>
                        {current && <Badge tone="grey">This turn</Badge>}
                      </div>
                      <div className="text-[11px] text-parchment/50 tabular-nums">{fmtShortDate(s.date)}</div>
                    </div>
                    <Button size="sm" variant="secondary" icon="history" disabled={resolving || pending} onClick={() => setConfirm(s)} title={current ? "Restart this turn from its first day" : `Return to ${fmtDate(s.date)}`}>
                      {current ? "Restart" : "Rewind"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
          {resolving && <p className="mt-3 text-[11px] text-parchment/45 italic">Wait for the current turn to finish resolving.</p>}

          <SectionTitle>Saved game</SectionTitle>
          <p className="text-[11.5px] leading-relaxed text-parchment/55">
            One file with the world and every saved turn. Import it from the main menu to carry on elsewhere; players pick their countries again.
          </p>
          <Button size="sm" variant="secondary" icon="download" className="mt-2" busy={exporting} disabled={resolving} onClick={() => void download()}>
            Export game
          </Button>
          {exportError && <p className="mt-2 text-xs text-[#f0b2aa]">{exportError}</p>}
          {exportNote && <p className="mt-2 text-xs text-parchment/55">{exportNote}</p>}
        </>
      )}

      {confirm && (
        <ConfirmDialog
          title={`Rewind to turn ${confirm.turn}?`}
          confirmLabel="Rewind to this turn"
          tone="danger"
          icon="history"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            rewindTo(confirm.turn);
            setConfirm(null);
          }}
        >
          <p>
            The world returns to <b className="text-parchment">{fmtDate(confirm.date)}</b>, the start of turn {confirm.turn}.
          </p>
          <p className="mt-2">
            {confirm.turn < view.turn
              ? `Everything after that — turns ${confirm.turn} to ${view.turn - 1}, their events, map changes, chats and votes — is discarded for every player.`
              : "This turn's orders, chats and votes are discarded for every player."}{" "}
            This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </Panel>
  );
}
