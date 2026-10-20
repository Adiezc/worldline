import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { markRead, requestNotificationPermission } from "../../game/chatNotify.ts";
import { createPortal } from "react-dom";
import type { Chat, ChatMessage, GameView, PeaceTerms, Proposal, ProposalCession, ProposalDraft, TreatyType, War } from "@worldline/shared";
import { closeChat, openChat, openConference, respondProposal, sendChat, setChatBuilder, toggleChatMinimized } from "../../game/actions.ts";
import { fmtShortDate } from "../../game/format.ts";
import { countryMap, TREATY_LABELS } from "../../game/selectors.ts";
import { toast, useGame, type ChatWindowState } from "../../game/store.ts";
import { getMap, setPickHandler } from "../../map/controller.ts";
import { provinceName } from "../../store.ts";
import { Badge, Button, CountryChip, Field, Modal, Spinner } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";
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
  const group = others.length >= 2;
  const title = group ? `Conference · ${others.length + (me ? 1 : 0)} nations` : others.map((t) => byTag.get(t)?.name ?? t).join(", ") || "Chat";
  const typing = useTyping(chat.id);
  const listRef = useRef<HTMLDivElement>(null);
  // A visible window means the messages are read.
  useEffect(() => {
    if (!win.minimized) markRead(chat.id);
  }, [win.minimized, chat.id, chat.messages.length]);
  const humans = useMemo(() => new Set(view.players.map((p) => p.country).filter(Boolean)), [view.players]);
  const aiMembers = others.filter((t) => !humans.has(t));
  const [speaker, setSpeaker] = useState("");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, win.minimized, typing]);

  return (
    <section className={`hud-panel pointer-events-auto flex ${group ? "w-[330px]" : "w-[300px]"} flex-col overflow-hidden animate-hud-in ${win.minimized ? "h-10" : "h-[440px] max-h-[calc(100vh-140px)]"}`}>
      <header className="flex h-10 shrink-0 cursor-pointer items-center gap-2 border-b border-panel-edge/50 px-3" onClick={() => toggleChatMinimized(chat.id)}>
        <div className="flex items-center -space-x-1.5">
          {group && <Icon name="users" size={14} className="mr-2.5 text-gold" />}
          {others.slice(0, group ? 5 : 3).map((t) => (
            <Flag key={t} country={byTag.get(t) ?? { tag: t }} size={group ? 18 : 22} />
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
      {!win.minimized && group && (
        <div className="flex shrink-0 items-start gap-2 border-b border-panel-edge/40 bg-black/15 px-3 py-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5">
            {chat.members.map((t) => (
              <span key={t} className="flex items-center gap-1 text-[10.5px] text-parchment/70" title={humans.has(t) ? "Player" : "AI nation"}>
                <Flag country={byTag.get(t) ?? { tag: t }} size={12} />
                <span className="max-w-[90px] truncate">{t === me ? "You" : byTag.get(t)?.name ?? t}</span>
                {humans.has(t) && t !== me && <Icon name="user" size={9} className="text-gold/70" />}
              </span>
            ))}
          </div>
          {me && aiMembers.length > 0 && (
            <label className="flex shrink-0 items-center gap-1" title="Which AI delegation answers your next message">
              <span className="text-[9.5px] tracking-wider text-parchment/40 uppercase">Speaker</span>
              <select className="hud-input h-6 w-[92px] py-0 pr-5 pl-1.5 text-[11px]" value={speaker} onChange={(e) => setSpeaker(e.target.value)}>
                <option value="">Auto</option>
                {aiMembers.map((t) => (
                  <option key={t} value={t}>
                    {byTag.get(t)?.name ?? t}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
      {!win.minimized && (
        <>
          <div ref={listRef} className="hud-scroll min-h-0 flex-1 space-y-2.5 px-3 py-2.5">
            {chat.messages.length === 0 && <p className="py-6 text-center text-[11.5px] text-parchment/40 italic">The line is open. Speak, envoy.</p>}
            {chat.messages.map((m) => (
              <Message key={m.id} m={m} chatId={chat.id} view={view} mine={m.from === me} />
            ))}
            {typing && (
              <div className="flex items-center gap-1.5 text-[11px] text-parchment/50 italic">
                <Flag country={byTag.get(typing) ?? { tag: typing }} size={12} />
                {byTag.get(typing)?.name ?? typing} is typing
                <span className="animate-hud-pulse">…</span>
              </div>
            )}
          </div>
          <Composer chat={chat} win={win} view={view} speaker={aiMembers.includes(speaker) ? speaker : undefined} />
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
      <Flag country={c ?? { tag: m.from }} size={18} className="mt-0.5" />
      <div className={`min-w-0 max-w-[85%] ${mine ? "items-end text-right" : ""} flex flex-col`}>
        <div className="flex items-baseline gap-1.5 text-[10.5px] text-parchment/45">
          <span className="font-semibold text-parchment/70">{c?.name ?? m.from}</span>
          <span>{fmtAt(m.at)}</span>
          {m.unprompted && <span className="italic text-gold/70">reached out</span>}
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

/** Standard peace terms; the text becomes the treaty's terms when the player writes none. */
const PEACE_LABELS: Record<PeaceTerms, { label: string; terms: string }> = {
  white: { label: "Returns to owner", terms: "All other occupied territory returns to its pre-war owner." },
  keep_occupied: { label: "Stays with holder", terms: "Each side keeps the other territory it occupies when the fighting stops." },
};

const KIND_LABELS: Record<Proposal["kind"], string> = { treaty: "Treaty", endWar: "Peace treaty", joinOrg: "Membership", custom: "Agreement" };

const MAX_PICKED = 150;

/** The war between me and another member of this conversation, with the enemies present. */
function warInChat(view: GameView, me: string | null | undefined, members: string[]): { war: War; enemies: string[] } | null {
  if (!me) return null;
  for (const war of view.wars) {
    const enemySide = war.attackers.includes(me) ? war.defenders : war.defenders.includes(me) ? war.attackers : null;
    const enemies = enemySide?.filter((t) => members.includes(t)) ?? [];
    if (enemies.length) return { war, enemies };
  }
  return null;
}

/** Picked regions grouped into cessions: enemy land comes to me, my own land goes to the enemy. */
function cessionsFor(view: GameView, me: string, enemies: string[], parties: string[], picked: number[]): ProposalCession[] {
  const groups = new Map<string, ProposalCession>();
  const enemy = enemies.find((t) => parties.includes(t));
  for (const id of picked) {
    const owner = view.countries[view.owners[id]]?.tag;
    if (!owner) continue;
    const [from, to] = owner === me ? [me, enemy] : [owner, me];
    if (!to || !parties.includes(from) || (owner !== me && !enemies.includes(owner))) continue;
    const key = `${from}>${to}`;
    if (!groups.has(key)) groups.set(key, { from, to, provinces: [] });
    groups.get(key)!.provinces.push(id);
  }
  return [...groups.values()];
}

/** "Russia cedes Kursk, Belgorod and 3 more to Ukraine." */
function cessionSentence(view: GameView, c: ProposalCession) {
  const byTag = countryMap(view.countries);
  const names = c.provinces.slice(0, 6).map(provinceName);
  const more = c.provinces.length > 6 ? ` and ${c.provinces.length - 6} more` : "";
  return `${byTag.get(c.from)?.name ?? c.from} cedes ${names.join(", ")}${more} to ${byTag.get(c.to)?.name ?? c.to}.`;
}

/** Regions of a cession the receiving side does not already occupy. */
function unheld(view: GameView, war: War | undefined, c: ProposalCession) {
  if (!war) return [];
  const side = new Set((war.attackers.includes(c.to) ? war.attackers : war.defenders).map((t) => view.countries.findIndex((k) => k.tag === t)));
  return c.provinces.filter((id) => !side.has(view.controllers[id]));
}

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
      {p.cessions?.map((c) => (
        <button
          key={`${c.from}>${c.to}`}
          type="button"
          onClick={() => getMap()?.focusOn(c.provinces)}
          title="Show these regions on the map"
          className="mt-1 flex w-full items-start gap-1.5 rounded-sm border border-gold/25 bg-black/15 px-1.5 py-1 text-left text-[11.5px] leading-snug text-parchment/80 hover:border-gold/60"
        >
          <Icon name="map" size={12} className="mt-0.5 shrink-0 text-gold" />
          <span>
            {countryMap(view.countries).get(c.from)?.name ?? c.from} → {countryMap(view.countries).get(c.to)?.name ?? c.to}: {c.provinces.length} region{c.provinces.length === 1 ? "" : "s"}
            <span className="text-parchment/45"> · show on map</span>
          </span>
        </button>
      ))}
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

/** The land clauses of a peace treaty: regions picked on the map, grouped by who cedes them. */
function TerritoryPicker(props: {
  view: GameView; me: string; cessions: ProposalCession[]; war: War | undefined; unheldCount: number;
  picking: boolean; onTogglePicking: () => void; onRemove: (id: number) => void; onClear: () => void;
}) {
  const { view, me, cessions, war } = props;
  const byTag = countryMap(view.countries);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="hud-label">Territory</span>
        <div className="flex gap-1">
          {cessions.length > 0 && (
            <Button size="sm" variant="ghost" onClick={props.onClear}>
              Clear
            </Button>
          )}
          <Button size="sm" variant={props.picking ? "primary" : "secondary"} icon="map" onClick={props.onTogglePicking}>
            {props.picking ? "Done picking" : "Pick on map"}
          </Button>
        </div>
      </div>
      {props.picking && (
        <p className="mb-1 text-[11px] leading-snug text-gold-bright/80">
          Click enemy regions to demand them, or your own to offer them. Click again to remove.
        </p>
      )}
      {cessions.length === 0 && !props.picking && (
        <p className="text-[11px] leading-snug text-parchment/45 italic">No land named. Pick regions on the map to demand any enemy territory, held or not.</p>
      )}
      {cessions.map((c) => {
        const notHeld = new Set(c.to === me ? unheld(view, war, c) : []);
        return (
          <div key={`${c.from}>${c.to}`} className="mb-1.5">
            <div className="mb-1 flex items-center gap-1 text-[11px] text-parchment/65">
              <Flag country={byTag.get(c.from) ?? { tag: c.from }} size={12} />
              {byTag.get(c.from)?.name ?? c.from} cedes to {byTag.get(c.to)?.name ?? c.to} ({c.provinces.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {c.provinces.map((id) => (
                <span
                  key={id}
                  title={notHeld.has(id) ? "Not occupied by your forces" : "Occupied by your side"}
                  className={`flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${notHeld.has(id) ? "border-dashed border-amber-400/60 text-amber-200/90" : "border-gold/50 text-parchment"}`}
                >
                  <button type="button" className="hover:underline" onClick={() => getMap()?.focusOn(id, { zoom: "keep" })}>
                    {provinceName(id)}
                  </button>
                  <button type="button" aria-label={`Remove ${provinceName(id)}`} className="text-parchment/50 hover:text-parchment" onClick={() => props.onRemove(id)}>
                    <Icon name="close" size={10} />
                  </button>
                </span>
              ))}
            </div>
          </div>
        );
      })}
      {props.unheldCount > 0 && (
        <p className="text-[11px] leading-snug text-amber-200/80">
          {props.unheldCount} demanded region{props.unheldCount === 1 ? " is" : "s are"} not under your control. Expect a refusal unless they are close to collapse.
        </p>
      )}
    </div>
  );
}

function Composer({ chat, win, view, speaker }: { chat: Chat; win: ChatWindowState; view: GameView; speaker?: string }) {
  const me = view.you.country;
  const [text, setText] = useState("");
  // Grow the message box with its text (up to ~8 lines, then scroll) so nothing is clipped.
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = 168; // about 8 lines
    el.style.height = `${Math.min(el.scrollHeight + 2, max)}px`;
    el.style.overflowY = el.scrollHeight + 2 > max ? "auto" : "hidden";
  }, [text]);
  const fight = warInChat(view, me, chat.members);
  const [kind, setKind] = useState<Proposal["kind"]>(win.preset === "peace" || fight ? "endWar" : "treaty");
  const [peace, setPeace] = useState<PeaceTerms>("white");
  useEffect(() => {
    if (win.preset === "peace") setKind("endWar");
  }, [win.preset]);
  // Peace treaties only exist between warring parties.
  useEffect(() => {
    if (!fight && kind === "endWar") setKind("treaty");
  }, [fight, kind]);
  const [picked, setPicked] = useState<number[]>([]);
  /** Message count when a proposal was sent; cleared once it appears in the chat. */
  const [sentAt, setSentAt] = useState<number | null>(null);
  useEffect(() => {
    if (sentAt === null) return;
    if (chat.messages.slice(sentAt).some((m) => m.from === me && m.proposal)) {
      setSentAt(null);
      setTerms("");
      setPicked([]);
      setPicking(false);
      setChatBuilder(chat.id, false);
    }
  }, [chat.messages, chat.id, sentAt, me]);
  const [picking, setPicking] = useState(false);
  const peaceOpen = win.builder && kind === "endWar" && !!fight;
  const [treatyType, setTreatyType] = useState<TreatyType>("trade");
  const [members, setMembers] = useState<string[]>(chat.members);
  // A conference's proposal names every delegation by default.
  const memberKey = chat.members.join(",");
  useEffect(() => setMembers(memberKey.split(",")), [memberKey]);
  const [terms, setTerms] = useState("");
  const byTag = countryMap(view.countries);

  // Region picking: map clicks toggle regions while the peace builder is picking.
  useEffect(() => {
    if (!peaceOpen || !picking || !me || !fight) return;
    setPickHandler((id) => {
      const owner = view.countries[view.owners[id]];
      if (!owner || (owner.tag !== me && !fight.enemies.includes(owner.tag))) {
        toast(`${provinceName(id)} belongs to ${owner?.name ?? "no one"}, which is not on the other side of this war.`, "warn");
        return;
      }
      setPicked((list) => {
        if (list.includes(id)) return list.filter((x) => x !== id);
        if (list.length >= MAX_PICKED) {
          toast(`A peace treaty can name at most ${MAX_PICKED} regions.`, "warn");
          return list;
        }
        return [...list, id];
      });
    });
    return () => setPickHandler(null);
  }, [peaceOpen, picking, me, fight, view]);
  useEffect(() => {
    if (!peaceOpen || !picked.length) return;
    getMap()?.setMarked(picked);
    return () => getMap()?.setMarked([]);
  }, [peaceOpen, picked]);
  useEffect(() => {
    if (!peaceOpen) setPicking(false);
  }, [peaceOpen]);

  if (!me) return <div className="border-t border-panel-edge/40 px-3 py-2 text-[11px] text-parchment/40 italic">Spectators cannot speak.</div>;

  const cessions = peaceOpen && fight ? cessionsFor(view, me, fight.enemies, members, picked) : [];
  const unheldCount = cessions.reduce((n, c) => n + (c.to === me ? unheld(view, fight?.war, c).length : 0), 0);

  const submit = () => {
    // Without written terms, the treaty text spells out the land clauses and the base terms.
    const peaceText = kind === "endWar" && !terms.trim()
      ? [...cessions.map((c) => cessionSentence(view, c)), PEACE_LABELS[peace].terms].join(" ")
      : terms.trim();
    const proposal: ProposalDraft | undefined = win.builder && peaceText
      ? {
        kind, treatyType: kind === "treaty" ? treatyType : undefined, peace: kind === "endWar" ? peace : undefined,
        cessions: kind === "endWar" && cessions.length ? cessions : undefined, members, terms: peaceText,
      }
      : undefined;
    if (!text.trim() && !proposal) return;
    sendChat(chat.id, text.trim(), proposal, speaker);
    setText("");
    // The builder stays as it is until the proposal arrives, so a refusal loses nothing.
    if (proposal) setSentAt(chat.messages.length);
  };

  return (
    <div className="shrink-0 border-t border-panel-edge/40 p-2">
      {win.builder && (
        <div className="hud-scroll mb-2 max-h-80 space-y-2 rounded border border-gold/40 bg-gold/[0.04] p-2">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Kind">
              <select className="hud-input py-1 text-[12px]" value={kind} onChange={(e) => setKind(e.target.value as Proposal["kind"])}>
                {Object.entries(KIND_LABELS).filter(([k]) => k !== "endWar" || fight).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            {kind === "endWar" && (
              <Field label="Other occupied land">
                <select className="hud-input py-1 text-[12px]" value={peace} onChange={(e) => setPeace(e.target.value as PeaceTerms)}>
                  {Object.entries(PEACE_LABELS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
            )}
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
                    <Flag country={byTag.get(t) ?? { tag: t }} size={12} />
                    {byTag.get(t)?.name ?? t}
                  </button>
                );
              })}
            </div>
          </div>
          {peaceOpen && (
            <TerritoryPicker
              view={view}
              me={me}
              cessions={cessions}
              war={fight?.war}
              unheldCount={unheldCount}
              picking={picking}
              onTogglePicking={() => setPicking((v) => !v)}
              onRemove={(id) => setPicked((list) => list.filter((x) => x !== id))}
              onClear={() => setPicked([])}
            />
          )}
          <Field label={kind === "endWar" ? "Treaty text (optional)" : "Terms"}>
            <textarea className="hud-input min-h-14 resize-none text-[12px]" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder={kind === "endWar" ? "Written from the clauses above if left empty" : chat.members.length > 2 ? "All parties agree to…" : "Both parties agree to…"} />
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
          ref={boxRef}
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
          className="hud-input min-h-8 resize-none py-1.5 text-[12.5px] leading-snug"
        />
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() && !(win.builder && (terms.trim() || kind === "endWar"))}
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
  const [conference, setConference] = useState(false);
  const unread = useGame((s) => s.unread);
  useEffect(requestNotificationPermission, []);
  return (
    <div className="hud-panel pointer-events-auto absolute top-[60px] left-[60px] z-30 w-[270px] p-2 animate-hud-in">
      <div className="flex items-center justify-between px-1.5 pb-1.5">
        <span className="hud-label">Diplomatic channels</span>
        <button onClick={onClose} className="text-parchment/40 hover:text-parchment">
          <Icon name="close" size={12} />
        </button>
      </div>
      {me && (
        <Button size="sm" variant="secondary" icon="users" className="mb-1.5 w-full" onClick={() => setConference(true)}>
          New conference
        </Button>
      )}
      {conference && (
        <ConferenceDialog
          onClose={() => setConference(false)}
          onConvene={(tags) => {
            openConference(tags);
            setConference(false);
            onClose();
          }}
        />
      )}
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
                {others.length > 1 ? (
                  <span className="relative h-[16px] w-[20px] shrink-0">
                    <Flag country={byTag.get(others[0]) ?? { tag: others[0] }} size={14} className="absolute top-0 left-0" />
                    <Flag country={byTag.get(others[1]) ?? { tag: others[1] }} size={14} className="absolute right-0 bottom-0" />
                  </span>
                ) : (
                  <Flag country={byTag.get(others[0]) ?? { tag: others[0] }} size={16} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] text-parchment">{others.map((t) => byTag.get(t)?.name ?? t).join(", ")}</div>
                  {last && <div className="truncate text-[10.5px] text-parchment/45">{last.text || "Proposal"}</div>}
                </div>
                {open && <Badge tone="amber">Reply</Badge>}
                {!!unread[c.id] && (
                  <span className="grid h-4 min-w-4 place-items-center rounded-full bg-fail px-1 text-[10px] font-semibold text-white">{unread[c.id]}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Pick two or more delegations for a multilateral conference. */
function ConferenceDialog({ onClose, onConvene }: { onClose: () => void; onConvene: (tags: string[]) => void }) {
  const view = useGame((s) => s.view)!;
  const me = view.you.country;
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const byTag = countryMap(view.countries);
  const humans = new Set(view.players.map((p) => p.country).filter(Boolean));
  const q = query.trim().toLowerCase();
  const options = view.countries
    .filter((c) => c.alive !== false && c.tag !== me)
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.tag.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  const toggle = (tag: string) => setPicked((p) => (p.includes(tag) ? p.filter((t) => t !== tag) : [...p, tag]));

  return createPortal(
    <Modal onClose={onClose} className="flex w-[min(440px,calc(100%-2rem))] flex-col">
      <header className="border-b border-panel-edge/50 px-5 pt-4 pb-3">
        <h2 className="font-display text-[16px] tracking-[0.12em] text-gold-bright">Convene a conference</h2>
        <p className="mt-1 text-[12px] text-parchment/55">Invite two or more nations to one table. AI delegations answer in turn; you can ask a specific one to speak.</p>
      </header>
      <div className="flex min-h-0 flex-col gap-2 px-5 py-3">
        <div className="relative">
          <Icon name="search" size={13} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-parchment/40" />
          <input autoFocus className="hud-input pl-8" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nations…" />
        </div>
        <div className="flex min-h-7 flex-wrap gap-1">
          {picked.length === 0 && <span className="text-[11.5px] text-parchment/40 italic">No delegations invited yet.</span>}
          {picked.map((t) => (
            <button key={t} onClick={() => toggle(t)} className="flex items-center gap-1 rounded-sm border border-gold/60 bg-gold/15 px-1.5 py-0.5 text-[11px] text-parchment hover:border-fail/60" title="Remove">
              <Flag country={byTag.get(t) ?? { tag: t }} size={12} />
              {byTag.get(t)?.name ?? t}
              <Icon name="close" size={9} className="text-parchment/50" />
            </button>
          ))}
        </div>
        <ul className="hud-scroll -mx-1 h-[280px] rounded border border-panel-edge/40 bg-black/20 p-1">
          {options.map((c) => {
            const on = picked.includes(c.tag);
            return (
              <li key={c.tag}>
                <button onClick={() => toggle(c.tag)} className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[12.5px] ${on ? "bg-gold/12 text-parchment" : "text-parchment/75 hover:bg-white/5"}`}>
                  <span className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${on ? "border-gold bg-gold/40" : "border-panel-edge"}`}>{on && <Icon name="check" size={10} />}</span>
                  <Flag country={c} size={14} />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  {humans.has(c.tag) && <Badge tone="grey">Player</Badge>}
                </button>
              </li>
            );
          })}
          {options.length === 0 && <li className="px-2 py-3 text-[11.5px] text-parchment/40 italic">No nation matches.</li>}
        </ul>
      </div>
      <footer className="flex items-center justify-end gap-2 border-t border-panel-edge/50 px-5 py-3">
        <span className="mr-auto text-[11px] text-parchment/45">{picked.length < 2 ? "Pick at least two nations" : `${picked.length + 1} delegations including yours`}</span>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon="users" disabled={picked.length < 2} onClick={() => onConvene(picked)}>
          Convene
        </Button>
      </footer>
    </Modal>,
    document.body,
  );
}
