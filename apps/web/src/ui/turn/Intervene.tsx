import { useState } from "react";
import type { GameEvent } from "@worldline/shared";
import { interveneAt, pausePlayback } from "../../game/actions.ts";
import { fmtDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { Button, ConfirmDialog } from "../common/ui.tsx";

/** Host-only "Intervene here" for an event of the last resolved turn. */
export function InterveneButton({ event, inPlayback }: { event: Pick<GameEvent, "id" | "date" | "headline">; inPlayback?: boolean }) {
  const allowed = useGame((s) => !!s.view?.you.isHost && (s.view.intervenable ?? []).includes(event.id) && s.view.phase !== "resolving");
  const [open, setOpen] = useState(false);
  if (!allowed) return null;

  const close = () => {
    setOpen(false);
    if (inPlayback) pausePlayback(false);
  };

  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        icon="pause"
        className="h-6 px-1.5 text-[10.5px] text-gold/80 hover:text-gold-bright"
        title="Stop time at this event and give new orders"
        onClick={(e) => {
          e.stopPropagation();
          if (inPlayback) pausePlayback(true);
          setOpen(true);
        }}
      >
        Intervene here
      </Button>
      {open && (
        <ConfirmDialog
          title="Intervene here?"
          confirmLabel="Stop time here"
          tone="danger"
          icon="pause"
          onCancel={close}
          onConfirm={() => {
            setOpen(false);
            interveneAt(event.id);
          }}
        >
          <p className="font-display text-[13px] text-parchment/90">“{event.headline}”</p>
          <p className="mt-2">
            Time stops at this event; everything after it is discarded and you can give new orders from <b className="text-parchment">{fmtDate(event.date)}</b>.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
