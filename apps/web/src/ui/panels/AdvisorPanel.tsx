import { useState } from "react";
import { askAdvisor } from "../../game/actions.ts";
import { fmtDate } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { Button, Empty, Panel } from "../common/ui.tsx";

/** Ask the chief advisor; replies are set as letters. */
export function AdvisorPanel({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const log = useGame((s) => s.advisorLog);
  const busy = useGame((s) => Object.values(s.requests).some((r) => r.kind === "advisor"));
  const ask = (text: string) => {
    askAdvisor(text);
    setQ("");
  };

  return (
    <Panel title="Chief Advisor" subtitle="Counsel in confidence" onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) ask(q);
        }}
      >
        <textarea
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (q.trim()) ask(q);
            }
          }}
          placeholder="What would you ask your advisor? e.g. “Can we afford to confront Russia?”"
          className="hud-input min-h-16 resize-none leading-snug"
        />
        <div className="mt-2 flex gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => ask("")}>
            Assess my situation
          </Button>
          <div className="flex-1" />
          <Button type="submit" variant="primary" size="sm" icon="quill" busy={busy} disabled={!q.trim()}>
            Ask
          </Button>
        </div>
      </form>

      <div className="mt-4 space-y-4">
        {log.length === 0 && <Empty>Your advisor awaits your questions.</Empty>}
        {[...log].reverse().map((l) => (
          <Letter key={l.reqId} reqId={l.reqId} question={l.question} />
        ))}
      </div>
    </Panel>
  );
}

function Letter({ reqId, question }: { reqId: string; question: string }) {
  const reply = useGame((s) => s.replies[reqId]);
  const date = useGame((s) => s.view?.date ?? "");
  const leader = useGame((s) => {
    const tag = s.view?.you.country;
    return s.view?.countries.find((c) => c.tag === tag)?.leader;
  });

  return (
    <article className="letter px-4 pt-3 pb-4 animate-hud-in">
      <div className="flex justify-between text-[10.5px] tracking-wide text-[#6b5636] uppercase">
        <span>Private &amp; confidential</span>
        <span>{fmtDate(date)}</span>
      </div>
      {question && <p className="mt-2 border-l-2 border-[#b89a63] pl-2 text-[12px] text-[#5a4630] italic">“{question}”</p>}
      <p className="mt-3 font-display text-[13px] text-[#3a2c1c]">{leader ? `Dear ${leader},` : "Your Excellency,"}</p>
      {!reply ? (
        <p className="mt-2 animate-hud-pulse text-[13px] text-[#5a4630] italic">Your advisor is composing a reply…</p>
      ) : reply.ok ? (
        <div className="mt-2 space-y-2 text-[13.5px] leading-relaxed select-text">
          {(reply.text ?? "").split(/\n{2,}/).map((para, i) => (
            <p key={i} className="whitespace-pre-line">
              {para}
            </p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[13px] text-[#8a2f26] italic">The letter never arrived. {reply.error}</p>
      )}
      {reply?.ok && <p className="mt-3 text-right font-display text-[12.5px] text-[#3a2c1c] italic">— Your humble servant, the Chief Advisor</p>}
    </article>
  );
}
