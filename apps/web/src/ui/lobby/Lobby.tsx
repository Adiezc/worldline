import { useState } from "react";
import type { GameView } from "@worldline/shared";
import { claimCountry, startGame } from "../../game/actions.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { fmtDate } from "../../game/format.ts";
import { gameUrl, navigate } from "../../router.ts";
import { Badge, Button, Panel, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";
import { Government } from "../common/Government.tsx";
import { NationStats } from "../common/NationStats.tsx";
import { SettingsForm } from "./SettingsForm.tsx";

export function Lobby() {
  const view = useGame((s) => s.view)!;
  const me = view.players.find((p) => p.id === view.you.playerId);
  const myCountry = view.you.country ? countryMap(view.countries).get(view.you.country) : undefined;
  const claimed = view.players.filter((p) => p.country).length;
  const canStart = view.you.isHost && claimed > 0;

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* Title strip */}
      <div className="absolute inset-x-0 top-0 flex justify-center p-3">
        <div className="hud-panel pointer-events-auto flex items-center gap-4 rounded-t-none border-t-0 px-6 py-2">
          <span className="font-display text-lg tracking-[0.25em] text-gold">WORLDLINE</span>
          <span className="h-5 w-px bg-panel-edge" />
          <span className="font-display text-base text-parchment">{view.name}</span>
          <span className="text-xs tracking-wider text-parchment/50 uppercase">{fmtDate(view.date)}</span>
        </div>
      </div>

      {/* Claim hint */}
      <div className="absolute top-[68px] left-1/2 -translate-x-1/2">
        <div className="rounded-full border border-gold/40 bg-panel/85 px-4 py-1.5 text-center font-display text-[12px] tracking-[0.18em] text-gold-bright uppercase shadow-lg backdrop-blur">
          {myCountry ? `You lead ${myCountry.name} — click another country to switch` : "Click a country on the map to claim it"}
        </div>
      </div>

      {/* Players */}
      <Panel
        title="The Gathering"
        subtitle={`${view.players.length} player${view.players.length === 1 ? "" : "s"} · ${claimed} nation${claimed === 1 ? "" : "s"} claimed`}
        className="absolute top-16 left-3 max-h-[calc(100%-5rem)] w-[340px]"
        bodyClassName="p-4"
      >
        <ul className="space-y-1.5">
          {view.players.map((p) => {
            const c = p.country ? countryMap(view.countries).get(p.country) : undefined;
            return (
              <li key={p.id} className={`flex items-center gap-2.5 rounded border px-2.5 py-2 ${p.id === view.you.playerId ? "border-gold/40 bg-gold/[0.06]" : "border-panel-edge/40 bg-black/15"}`}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${p.connected ? "bg-success" : "bg-parchment/25"}`} title={p.connected ? "Connected" : "Offline"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-[13px] text-parchment">
                    {p.name}
                    {p.id === view.you.playerId && <span className="text-[11px] text-parchment/40">(you)</span>}
                  </div>
                  <div className="flex items-center gap-1.5 truncate text-[11.5px] text-parchment/55">
                    {c ? (
                      <>
                        <Flag country={c} size={13} /> {c.name}
                      </>
                    ) : (
                      <span className="italic">Spectating</span>
                    )}
                  </div>
                </div>
                {p.isHost && <Badge>Host</Badge>}
              </li>
            );
          })}
        </ul>

        {myCountry && (
          <>
            <SectionTitle>Your nation</SectionTitle>
            <div className="rounded border border-panel-edge/50 p-3" style={{ background: `linear-gradient(90deg, ${myCountry.color}33, transparent)` }}>
              <div className="flex items-center gap-2">
                <Flag country={myCountry} size={40} className="ring-1 ring-gold/40" />
                <div className="min-w-0 truncate font-display text-[15px] text-parchment" title={myCountry.name}>{myCountry.name}</div>
              </div>
              <Government country={myCountry} className="mt-2.5" />
              <NationTraits view={view} tag={myCountry.tag} />
              <div className="mt-3">
                <NationStats country={myCountry} rank={gdpRank(view, myCountry.tag)} />
              </div>
              <p className="mt-3 text-[11.5px] leading-snug text-parchment/55 italic">{myCountry.agenda?.persona}</p>
            </div>
          </>
        )}
        <div className="mt-3 flex gap-2">
          {me?.country ? (
            <Button variant="ghost" size="sm" onClick={() => claimCountry(null)}>
              Release &amp; spectate
            </Button>
          ) : (
            <span className="text-[11.5px] text-parchment/45 italic">Without a nation you will watch as a spectator.</span>
          )}
        </div>

        <SectionTitle>Invite</SectionTitle>
        <ShareLink id={view.id} />

        <div className="mt-5 flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            Leave
          </Button>
          <div className="flex-1" />
          {view.you.isHost ? (
            <Button variant="primary" size="lg" disabled={!canStart} onClick={startGame} title={canStart ? undefined : "At least one nation must be claimed"}>
              Begin
            </Button>
          ) : (
            <span className="text-xs text-parchment/50 italic">Waiting for the host to begin…</span>
          )}
        </div>
      </Panel>

      <SettingsForm />
    </div>
  );
}

function ShareLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const url = gameUrl(id);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement("textarea");
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  return (
    <div className="flex gap-2">
      <input readOnly value={url} className="hud-input font-mono text-[11.5px] select-all" onFocus={(e) => e.currentTarget.select()} />
      <Button onClick={copy} variant={copied ? "success" : "secondary"} icon={copied ? "check" : "copy"}>
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

/** Place among living nations by GDP (1 = largest economy). */
const gdpRank = (view: GameView, tag: string) =>
  view.countries.filter((c) => c.alive).sort((a, b) => b.gdp - a.gdp).findIndex((c) => c.tag === tag) + 1;

/** What sets a nation apart before the first turn: the bomb, its wars, and the clubs it belongs to. */
function NationTraits({ view, tag }: { view: GameView; tag: string }) {
  const c = countryMap(view.countries).get(tag);
  const wars = view.wars.filter((w) => w.attackers.includes(tag) || w.defenders.includes(tag));
  const orgs = view.organizations.filter((o) => o.members.includes(tag));
  if (!c?.nuclear && !wars.length && !orgs.length) return null;
  const MAX_ORGS = 6;
  return (
    <div className="mt-2.5 flex flex-wrap gap-1">
      {c?.nuclear && <Badge tone="amber">Nuclear power</Badge>}
      {wars.map((w) => (
        <Badge key={w.id} tone="red" className="max-w-full overflow-hidden" title={`${w.name}: ${w.goal}`}>
          <span className="truncate">At war · {w.name}</span>
        </Badge>
      ))}
      {orgs.slice(0, MAX_ORGS).map((o) => (
        <Badge key={o.id} tone="grey" title={o.name}>{o.abbrev}</Badge>
      ))}
      {orgs.length > MAX_ORGS && <Badge tone="grey" title={orgs.slice(MAX_ORGS).map((o) => o.abbrev).join(", ")}>+{orgs.length - MAX_ORGS}</Badge>}
    </div>
  );
}
