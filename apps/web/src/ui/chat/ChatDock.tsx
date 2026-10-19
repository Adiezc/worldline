import { useEffect, useRef, useState } from "react";
import type { Chat, ChatMessage, GameView, Proposal, ProposalDraft, TreatyType } from "@worldline/shared";
import { closeChat, openChat, respondProposal, sendChat, setChatBuilder, toggleChatMinimized } from "../../game/actions.ts";
import { fmtShortDate } from "../../game/format.ts";
import { countryMap, TREATY_LABELS } from "../../game/selectors.ts";
import { useGame, type ChatWindowState } from "../../game/store.ts";
import { Badge, Button, CountryChip, Field, Spinner, Swatch } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

/** Docked chat windows along the bottom edge, right of the chronicle. */
export function ChatDock() {
  const windows = useGame((s) => s.chats);
  const view = useGame((s) => s.view)!;
  const pending = useGame((s) => s.pendingChat);
  return (
    <div className="pointer-events-none absolute right-[332px] bottom-3 z-20 flex flex-row-reverse items-end gap-2">
      {pending && (
        <div className="hud-panel pointer-events-auto flex h-10 w-[300px] items-center gap-2 px-3 text-[12px] text-parchment/70">
          <Spinner className="text-gold" /> Opening channels…
        </div>
      )}
      {windows.map((w) => {
        const chat = view.chats.find((c) => c.id === w.chatId);
        return chat ? <ChatWindow key={w.chatId} chat={chat} win={w} view={view} /> : null;
      })}
    </div>
  );
}

function ChatWindow({ chat, win, view }: { chat: Chat; win: ChatWindowState; view: GameView }) {
  const me = view.you.country;
  const others = chat.members.filter((m) => m !== me);
  const byTag = countryMap(view.countries);
  const title = others.map((t) => byTag.get(t)?.name ?? t).join(", ") || "Chat";
  const typing = useTyping(chat.id);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, win.minimized, typing]);

  return (
    <section className={`hud-panel pointer-events-auto flex w-[300px] flex-col overflow-hidden animate-hud-in ${win.minimized ? "h-10" : "h-[420px] max-h-[calc(100vh-140px)]"}`}>
      <header className="flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b border-panel-edge/50 px-3" onClick={() => toggleChatMinimized(chat.id)}>
        <div className="flex -space-x-1">
          {others.slice(0, 3).map((t) => (
            <Swatch key={t} color={byTag.get(t)?.color} size={13} />
          ))}
        </div>
        <span className="min-w-0 flex-1 truncate font-display text-[13px] text-parchment">{title}</span>
        <button className="rounded p-1 text-parchment/50 hover:text-parchment" title={win.minimized ? "Expand" : "Minimise"}>
          <Icon name={win.minimized ? "chevronUp" : "chevronDown"} size={13} />
        </button>
        <button
          className="rounded p-1 text-parchment/50 hover:text-parchment"
          title="Close"
          onClick={(e) => {
            e.stopPropagation();
            closeChat(chat.id);
          }}
        >
          <Icon name="close" size={13} />
        </button>
      </header>
      {!win.minimized && (
        <>
          <div ref={listRef} className="hud-scroll min-h-0 flex-1 space-y-2.5 px-3 py-2.5">
            {chat.messages.length === 0 && <p className="py-6 text-center text-[11.5px] text-parchment/40 italic">The line is open. Speak, envoy.</p>}
            {chat.messages.map((m) => (
              <Message key={m.id} m={m} chatId={chat.id} view={view} mine={m.from === me} />
            ))}
            {typing && (
              <div className="flex items-center gap-1.5 text-[11px] text-parchment/50 italic">
                <Swatch color={byTag.get(typing)?.color} size={8} />
                {byTag.get(typing)?.name ?? typing} is typing
                <span className="animate-hud-pulse">…</span>
              </div>
            )}
          </div>
          <Composer chat={chat} win={win} view={view} />
        </>
      )}
    </section>
  );
}

function useTyping(chatId: string) {
  const t = useGame((s) => s.typing[chatId]);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!t) return;
    const ms = t.until - Date.now();
    if (ms <= 0) return;
    const timer = window.setTimeout(() => tick((n) => n + 1), ms + 50);
    return () => window.clearTimeout(timer);
  }, [t]);
  return t && t.until > Date.now() ? t.from : null;
}

function fmtAt(at: string) {
  if (!at) return "";
  if (at.length <= 10) return fmtShortDate(at);
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? at : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Message({ m, chatId, view, mine }: { m: ChatMessage; chatId: string; view: GameView; mine: boolean }) {
  const c = countryMap(view.countries).get(m.from);
  return (
    <div className={`flex gap-2 ${mine ? "flex-row-reverse" : ""}`}>
      <Swatch color={c?.color} size={10} className="mt-1" />
      <div className={`min-w-0 max-w-[85%] ${mine ? "items-end text-right" : ""} flex flex-col`}>
        <div className="flex items-baseline gap-1.5 text-[10.5px] text-parchment/45">
          <span className="font-semibold text-parchment/70">{c?.name ?? m.from}</span>
          <span>{fmtAt(m.at)}</span>
        </div>
        {m.text && (
          <div className={`mt-0.5 rounded px-2.5 py-1.5 text-left text-[12.5px] leading-snug whitespace-pre-line select-text ${mine ? "bg-gold/15 text-parchment" : "bg-black/30 text-parchment/90"}`}>
            {m.text}
          </div>
        )}
        {m.proposal && <ProposalCard p={m.proposal} chatId={chatId} view={view} />}
      </div>
    </div>
  );
}

const KIND_LABELS: Record<Proposal["kind"], string> = { treaty: "Treaty", endWar: "Peace terms", joinOrg: "Membership", custom: "Agreement" };

function ProposalCard({ p, chatId, view }: { p: Proposal; chatId: string; view: GameView }) {
  const me = view.you.country;
  const canAnswer = p.status === "open" && !!me && p.awaiting.includes(me);
  const tone = p.status === "accepted" ? "green" : p.status === "rejected" ? "red" : "amber";
  return (
    <div className="mt-1 w-full rounded border border-gold/45 bg-[linear-gradient(180deg,rgb(201_164_92/0.12),rgb(201_164_92/0.03))] px-2.5 py-2 text-left">
      <div className="flex items-center gap-1.5">
        <Icon name="scroll" size={13} className="text-gold" />
        <span className="font-display text-[12px] text-gold-bright">
          {KIND_LABELS[p.kind]}
          {p.kind === "treaty" && p.treatyType ? ` — ${TREATY_LABELS[p.treatyType]}` : ""}
        </span>
        <Badge tone={tone} className="ml-auto">
          {p.status}
        </Badge>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug whitespace-pre-line text-parchment/85 select-text">{p.terms}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {p.members.map((t) => (
          <CountryChip key={t} tag={t} small />
        ))}
      </div>
      {p.status === "open" && p.awaiting.length > 0 && (
        <div className="mt-1 text-[10.5px] text-parchment/45">Awaiting: {p.awaiting.map((t) => countryMap(view.countries).get(t)?.name ?? t).join(", ")}</div>
      )}
      {canAnswer && (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="success" className="flex-1" onClick={() => respondProposal(chatId, p.id, true)}>
            Accept
          </Button>
          <Button size="sm" variant="danger" className="flex-1" onClick={() => respondProposal(chatId, p.id, false)}>
            Reject
          </Button>
        </div>
      )}
    </div>
  );
}

function Composer({ chat, win, view }: { chat: Chat; win: ChatWindowState; view: GameView }) {
  const me = view.you.country;
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Proposal["kind"]>("treaty");
  const [treatyType, setTreatyType] = useState<TreatyType>("trade");
  const [members, setMembers] = useState<string[]>(chat.members);
  const [terms, setTerms] = useState("");
  const byTag = countryMap(view.countries);

  if (!me) return <div className="border-t border-panel-edge/40 px-3 py-2 text-[11px] text-parchment/40 italic">Spectators cannot speak.</div>;

  const submit = () => {
    const proposal: ProposalDraft | undefined = win.builder && terms.trim() ? { kind, treatyType: kind === "treaty" ? treatyType : undefined, members, terms: terms.trim() } : undefined;
    if (!text.trim() && !proposal) return;
    sendChat(chat.id, text.trim(), proposal);
    setText("");
    if (proposal) {
      setTerms("");
      setChatBuilder(chat.id, false);
    }
  };

  return (
    <div className="shrink-0 border-t border-panel-edge/40 p-2">
      {win.builder && (
        <div className="hud-scroll mb-2 max-h-56 space-y-2 rounded border border-gold/40 bg-gold/[0.04] p-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <select className="hud-input py-1 text-[12px]" value={kind} onChange={(e) => setKind(e.target.value as Proposal["kind"])}>
                {Object.entries(KIND_LABELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {kind === "treaty" && (
              <Field label="Treaty">
                <select className="hud-input py-1 text-[12px]" value={treatyType} onChange={(e) => setTreatyType(e.target.value as TreatyType)}>
                  {Object.entries(TREATY_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <div>
            <span className="hud-label mb-1 block">Parties</span>
            <div className="flex flex-wrap gap-1">
              {chat.members.map((t) => {
                const on = members.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={t === me}
                    onClick={() => setMembers(on ? members.filter((x) => x !== t) : [...members, t])}
                    className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${on ? "border-gold/70 bg-gold/15 text-parchment" : "border-panel-edge/50 text-parchment/45"}`}
                  >
                    <Swatch color={byTag.get(t)?.color} size={8} />
                    {byTag.get(t)?.name ?? t}
                  </button>
                );
              })}
            </div>
          </div>
          <Field label="Terms">
            <textarea className="hud-input min-h-14 resize-none text-[12px]" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Both parties agree to…" />
          </Field>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <button
          type="button"
          onClick={() => setChatBuilder(chat.id, !win.builder)}
          title="Attach a formal proposal"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded border ${win.builder ? "border-gold bg-gold/15 text-gold-bright" : "border-panel-edge/70 text-parchment/50 hover:text-parchment"}`}
        >
          <Icon name="scroll" size={14} />
        </button>
        <textarea
          autoFocus
          value={text}
          rows={1}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={win.builder ? "Covering note (optional)…" : "Write a message…"}
          className="hud-input max-h-24 min-h-8 resize-none py-1.5 text-[12.5px]"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() && !(win.builder && terms.trim())}
          className="grid h-8 w-8 shrink-0 place-items-center rounded border border-gold/70 bg-gold/20 text-gold-bright hover:bg-gold/30 disabled:opacity-40"
          title="Send"
        >
          <Icon name="send" size={14} />
        </button>
      </div>
    </div>
  );
}

/** Popover listing every conversation, opened from the left rail. */
export function ChatList({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const me = view.you.country;
  const byTag = countryMap(view.countries);
  const chats = [...view.chats].sort((a, b) => b.lastTurn - a.lastTurn);
  return (
    <div className="hud-panel pointer-events-auto absolute top-[60px] left-[60px] z-30 w-[260px] p-2 animate-hud-in">
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <span className="hud-label">Diplomatic channels</span>
        <button onClick={onClose} className="text-parchment/40 hover:text-parchment">
          <Icon name="close" size={12} />
        </button>
      </div>
      {chats.length === 0 && <p className="px-1.5 py-2 text-[11.5px] text-parchment/45 italic">No conversations yet. Select a country and choose “Open diplomacy”.</p>}
      <ul className="hud-scroll max-h-80">
        {chats.map((c) => {
          const others = c.members.filter((m) => m !== me);
          const last = c.messages[c.messages.length - 1];
          const open = c.messages.some((m) => m.proposal?.status === "open" && me && m.proposal.awaiting.includes(me));
          return (
            <li key={c.id}>
              <button
                className="flex w-full items-center gap-2 rounded px-1.5 py-1.5 text-left hover:bg-white/5"
                onClick={() => {
                  openChat(c.id);
                  onClose();
                }}
              >
                <Swatch color={byTag.get(others[0])?.color} size={11} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-parchment">{others.map((t) => byTag.get(t)?.name ?? t).join(", ")}</div>
                  {last && <div className="truncate text-[10.5px] text-parchment/45">{last.text || "Proposal"}</div>}
                </div>
                {open && <Badge tone="amber">Reply</Badge>}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
