// Diplomatic-chat notifications: when a view brings new messages from other nations, raise a
// toast (click to open the conversation), count them as unread, show the count in the tab title,
// play a soft chime, and post a system notification when the tab is in the background.

import type { Chat, GameView } from "@worldline/shared";
import { useGame } from "./store.ts";

const MAX_PREVIEW = 90;

/** Compare the previous and next views; call before the new view is stored. */
export function notifyNewMessages(prev: GameView | null, next: GameView) {
  const me = next.you.country;
  if (!prev || !me || prev.id !== next.id) return; // first view of a game: nothing is "new"
  const before = new Map(prev.chats.map((c) => [c.id, c.messages.length]));
  const st = useGame.getState();
  const unread = { ...st.unread };
  let fresh = 0;

  for (const chat of next.chats) {
    const seen = before.get(chat.id) ?? 0;
    const incoming = chat.messages.slice(seen).filter((m) => m.from !== me);
    if (!incoming.length) continue;
    const window = st.chats.find((w) => w.chatId === chat.id);
    const watching = !!window && !window.minimized && document.hasFocus();
    if (watching) continue;
    unread[chat.id] = (unread[chat.id] ?? 0) + incoming.length;
    fresh += incoming.length;
    const last = incoming[incoming.length - 1];
    const sender = next.countries.find((c) => c.tag === last.from);
    const name = sender?.name ?? last.from;
    const text = last.proposal
      ? `${name} proposes: ${last.proposal.terms}`
      : `${name}: ${last.text}`;
    pushChatToast(chat, last.from, clip(text));
    systemNotification(name, clip(last.proposal ? `Proposal: ${last.proposal.terms}` : last.text));
  }

  if (fresh) {
    useGame.setState({ unread });
    chime();
  }
}

function pushChatToast(chat: Chat, from: string, text: string) {
  const st = useGame.getState();
  const id = Date.now() + Math.random();
  useGame.setState({ toasts: [...st.toasts.slice(-4), { id, level: "info", text, chatId: chat.id, from }] });
}

const clip = (s: string) => (s.length > MAX_PREVIEW ? `${s.slice(0, MAX_PREVIEW - 1)}…` : s);

/** Clear a conversation's unread count (when its window is shown). */
export function markRead(chatId: string) {
  const unread = useGame.getState().unread;
  if (!unread[chatId]) return;
  const next = { ...unread };
  delete next[chatId];
  useGame.setState({ unread: next });
}

export const totalUnread = (unread: Record<string, number>) => Object.values(unread).reduce((a, b) => a + b, 0);

// --- Tab title ---------------------------------------------------------------------------------

const BASE_TITLE = "Worldline";
useGame.subscribe((s, p) => {
  if (s.unread === p.unread) return;
  const n = totalUnread(s.unread);
  document.title = n ? `(${n}) ${BASE_TITLE}` : BASE_TITLE;
});

// --- Sound -------------------------------------------------------------------------------------

let audio: AudioContext | null = null;
function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime;
    // Two soft notes, like a small bell: unobtrusive but noticeable.
    for (const [freq, at] of [[880, 0], [1320, 0.12]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.08, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + at);
      osc.stop(t + at + 0.5);
    }
  } catch {
    // Audio is a nicety; browsers may block it until the first interaction.
  }
}

// --- System notifications (background tab) -------------------------------------------------------

/** Ask once, from a user gesture (e.g. opening the diplomacy list). */
export function requestNotificationPermission() {
  try {
    if ("Notification" in window && Notification.permission === "default") void Notification.requestPermission();
  } catch {
    // Unsupported or blocked: in-app toasts still work.
  }
}

function systemNotification(title: string, body: string) {
  try {
    if (!document.hidden || !("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(`Worldline: ${title}`, { body, tag: "worldline-chat" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Ignore: the toast and title badge still tell the player.
  }
}
