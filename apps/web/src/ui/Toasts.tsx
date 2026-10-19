import { useEffect } from "react";
import { dismissToast, useGame, type Toast } from "../game/store.ts";
import { openChat } from "../game/actions.ts";
import { markRead } from "../game/chatNotify.ts";
import { Flag } from "./common/Flag.tsx";

const TONES: Record<Toast["level"], string> = {
  info: "border-gold/50",
  success: "border-success/70",
  warn: "border-partial/70",
  error: "border-fail/80",
};
const DOTS: Record<Toast["level"], string> = { info: "bg-gold", success: "bg-success", warn: "bg-partial", error: "bg-fail" };

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed top-16 right-3 z-50 flex w-80 flex-col items-end gap-2">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const ms = toast.level === "error" || toast.chatId ? 7000 : 4500;
    const timer = window.setTimeout(() => dismissToast(toast.id), ms);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.level]);
  return (
    <button
      onClick={() => {
        if (toast.chatId) {
          openChat(toast.chatId);
          markRead(toast.chatId);
        }
        dismissToast(toast.id);
      }}
      className={`hud-panel pointer-events-auto flex max-w-full items-start gap-2.5 border-l-[3px] px-3 py-2 text-left text-[13px] text-parchment/90 animate-hud-in ${TONES[toast.level]}`}
    >
      {toast.chatId ? (
        <MessageFlag tag={toast.from} />
      ) : (
        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[toast.level]}`} />
      )}
      <span className="select-text">{toast.text}</span>
    </button>
  );
}

function MessageFlag({ tag }: { tag?: string }) {
  const country = useGame((s) => s.view?.countries.find((c) => c.tag === tag));
  return <Flag country={country ?? { tag: tag ?? "?" }} size={18} className="mt-0.5 shrink-0" />;
}
