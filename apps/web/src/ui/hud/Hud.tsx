import { useState } from "react";
import { totalUnread } from "../../game/chatNotify.ts";
import { useGame } from "../../game/store.ts";
import { selectCountry, setLeftTab, toggleLeftTab } from "../../game/actions.ts";
import { navigate } from "../../router.ts";
import { IconButton } from "../common/ui.tsx";
import { TopBar } from "./TopBar.tsx";
import { AiMeter } from "./AiMeter.tsx";
import { MapModeSwitcher } from "./MapModeSwitcher.tsx";
import { OrdersPanel } from "../panels/OrdersPanel.tsx";
import { AdvisorPanel } from "../panels/AdvisorPanel.tsx";
import { OrgPanel } from "../panels/OrgPanel.tsx";
import { FormationPanel } from "../panels/FormationPanel.tsx";
import { HistoryPanel } from "../panels/HistoryPanel.tsx";
import { CountryPanel } from "../panels/CountryPanel.tsx";
import { EventFeed } from "../panels/EventFeed.tsx";
import { ChatDock, ChatList } from "../chat/ChatDock.tsx";
import { TurnResultModal } from "../turn/TurnResultModal.tsx";
import { PlaybackCard } from "../turn/PlaybackCard.tsx";

/** In-game HUD: left rail + sidebar, right country panel, bottom feed, chats and overlays. */
export function Hud() {
  const tab = useGame((s) => s.leftTab);
  const pendingConsents = useGame((s) => {
    const me = s.view?.you.country;
    if (!me || !s.view) return 0;
    return s.view.formations.filter((f) => f.status === "active" && f.founder !== me && f.consent.some((c) => c.country === me && c.human && c.accepted === undefined)).length;
  });
  const pendingVotes = useGame((s) => {
    const me = s.view?.you.country;
    if (!me || !s.view) return 0;
    return s.view.resolutions.filter((r) => r.status === "pending" && !r.votes?.[me] && s.view!.organizations.some((o) => o.id === r.orgId && o.members.includes(me))).length;
  });
  const orderCount = useGame((s) => s.orders.length);
  const awaitingReplies = useGame((s) => {
    const me = s.view?.you.country;
    if (!me || !s.view) return 0;
    return s.view.chats.filter((c) => c.messages.some((m) => m.proposal?.status === "open" && m.proposal.awaiting.includes(me))).length;
  });
  const unreadChats = useGame((s) => totalUnread(s.unread));
  const [chatList, setChatList] = useState(false);
  const isHost = useGame((s) => !!s.view?.you.isHost);
  const snapshotCount = useGame((s) => s.view?.snapshots?.length ?? 0);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Top-left: brand + navigation rail */}
      <div className="pointer-events-auto absolute top-3 left-3 flex flex-col items-center gap-1.5">
        <button
          onClick={() => {
            if (confirm("Return to the main menu? The game continues on the server.")) navigate("/");
          }}
          title="Main menu"
          className="hud-panel grid h-9 w-9 place-items-center font-display text-lg text-gold hover:text-gold-bright"
        >
          W
        </button>
        <div className="gilt-rule my-1 w-7" />
        <IconButton icon="scroll" label={`Orders${orderCount ? ` (${orderCount})` : ""}`} active={tab === "orders"} onClick={() => toggleLeftTab("orders")} />
        <IconButton icon="quill" label="Advisor" active={tab === "advisor"} onClick={() => toggleLeftTab("advisor")} />
        <IconButton icon="columns" label="Organisations" active={tab === "orgs"} onClick={() => toggleLeftTab("orgs")} badge={pendingVotes} />
        <IconButton icon="crown" label="Form a nation" active={tab === "formation"} onClick={() => toggleLeftTab("formation")} badge={pendingConsents} />
        {isHost && <IconButton icon="history" label={`History${snapshotCount ? ` (${snapshotCount} saved turns)` : ""} — rewind`} active={tab === "history"} onClick={() => toggleLeftTab("history")} />}
        <div className="gilt-rule my-1 w-7" />
        <IconButton icon="chat" label="Diplomatic channels" active={chatList} onClick={() => setChatList(!chatList)} badge={awaitingReplies + unreadChats} />
        <IconButton icon="flag" label="Your nation" onClick={() => selectCountry(null, { focus: true })} />
      </div>
      {chatList && <ChatList onClose={() => setChatList(false)} />}

      {tab && (
        <div className="absolute top-[60px] bottom-3 left-[60px] flex w-[312px] flex-col">
          {tab === "orders" && <OrdersPanel onClose={() => setLeftTab(null)} />}
          {tab === "advisor" && <AdvisorPanel onClose={() => setLeftTab(null)} />}
          {tab === "orgs" && <OrgPanel onClose={() => setLeftTab(null)} />}
          {tab === "formation" && <FormationPanel onClose={() => setLeftTab(null)} />}
          {tab === "history" && <HistoryPanel onClose={() => setLeftTab(null)} />}
        </div>
      )}

      <TopBar />
      <AiMeter />
      <CountryPanel />
      <EventFeed />
      <MapModeSwitcher />
      <ChatDock />
      <PlaybackCard />
      <TurnResultModal />
    </div>
  );
}
