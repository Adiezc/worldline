import type { Country, GameView } from "@worldline/shared";
import { claimCountry, openDiplomacy, selectCountry, selectOrg, setLeftTab } from "../../game/actions.ts";
import { fmtGdp, fmtPop, fmtRelation, fmtShortDate, relationWord } from "../../game/format.ts";
import { relationColor } from "../../game/mapModes.ts";
import { countryMap, focusTag, relationBetween, TREATY_LABELS } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { getMap } from "../../map/controller.ts";
import { provinceName, useMap } from "../../store.ts";
import { Badge, Bar, Button, CountryChip, Empty, Panel, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";
import { Icon } from "../common/Icon.tsx";
import { ForcesSection } from "./ForcesSection.tsx";

export function CountryPanel() {
  const open = useGame((s) => s.countryOpen);
  const view = useGame((s) => s.view)!;
  const tag = useGame(focusTag);
  if (!open || !tag) return null;
  const c = countryMap(view.countries).get(tag);
  if (!c) return null;
  return <CountryDetails view={view} c={c} />;
}

function CountryDetails({ view, c }: { view: GameView; c: Country }) {
  const me = view.you.country;
  const isMe = c.tag === me;
  const player = view.players.find((p) => p.country === c.tag);
  // Spectators, and players whose nation is gone, may take over one that nobody leads.
  const myNationAlive = !!me && countryMap(view.countries).get(me)?.alive !== false;
  const canTake = view.phase === "orders" && !myNationAlive && !player && c.alive !== false;
  const rel = me && !isMe ? relationBetween(view.relations, me, c.tag) : null;
  const atWarWithMe = !!me && !isMe && view.wars.some((w) =>
    (w.attackers.includes(me) && w.defenders.includes(c.tag)) || (w.defenders.includes(me) && w.attackers.includes(c.tag)));
  const treaties = view.treaties.filter((t) => t.members.includes(c.tag));
  const wars = view.wars.filter((w) => w.attackers.includes(c.tag) || w.defenders.includes(c.tag));
  const calls = view.wars.flatMap((w) => (w.calls ?? []).filter((k) => k.tag === c.tag).map((k) => ({ war: w, via: k.via })));
  const orgs = view.organizations.filter((o) => o.members.includes(c.tag) || o.observers.includes(c.tag) || o.candidates.some((k) => k.tag === c.tag));
  const sanctionsOn = view.sanctions.filter((s) => s.target === c.tag);
  const sanctionsBy = view.sanctions.filter((s) => s.by.includes(c.tag));
  const index = view.countries.indexOf(c);

  return (
    <Panel
      className="absolute top-[60px] right-3 max-h-[calc(100%-200px)] w-[316px]"
      onClose={() => useGame.setState({ countryOpen: false })}
      title={
        <span className="flex items-center gap-2">
          {c.name}
          {c.nuclear && (
            <span title="Nuclear-armed" className="text-partial">
              <Icon name="atom" size={14} />
            </span>
          )}
        </span>
      }
      subtitle={`${c.government} · ${c.leader}`}
      actions={
        <button title="Show on map" className="rounded p-1 text-parchment/50 hover:bg-white/5 hover:text-parchment" onClick={() => getMap()?.focusOn({ country: index }, { maxZoom: 1.6 })}>
          <Icon name="map" size={14} />
        </button>
      }
      bodyClassName="px-4 pb-4"
    >
      {/* Banner */}
      <div className="-mx-4 mb-3 flex items-center gap-3 px-4 py-3" style={{ background: `linear-gradient(90deg, ${c.color}50, transparent 85%)` }}>
        <Flag country={c} size={48} className="ring-1 ring-gold/40" />
        <div className="flex flex-wrap gap-1">
          {isMe && <Badge>Your nation</Badge>}
          {!isMe && player && <Badge tone="blue">Player · {player.name}</Badge>}
          {!player && <Badge tone="grey">AI nation</Badge>}
          {c.nuclear && <Badge tone="amber">Nuclear power</Badge>}
          {c.alive === false && <Badge tone="red">Dissolved</Badge>}
        </div>
      </div>

      <RegionLine view={view} tag={c.tag} />

      {rel !== null && (
        <div className="mb-3 flex items-center justify-between rounded border border-panel-edge/40 bg-black/20 px-3 py-2">
          <span className="hud-label">Relations with you</span>
          <span className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold tabular-nums" style={{ color: relationColor(rel) }}>
              {fmtRelation(rel)}
            </span>
            <span className="text-parchment/60">{relationWord(rel)}</span>
          </span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
        <Stat label="GDP" value={fmtGdp(c.gdp)} />
        <Stat label="Population" value={fmtPop(c.population)} />
      </dl>
      <div className="mt-2.5 space-y-2">
        <Meter label="Stability" value={c.stability} color={c.stability > 60 ? "#6fbf73" : c.stability > 35 ? "#d9a441" : "#d0574d"} />
        <Meter label="Military" value={c.military} color="#8fa9c9" />
        <Meter label="War exhaustion" value={c.warExhaustion} color={c.warExhaustion > 50 ? "#d0574d" : "#b98a5a"} />
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {canTake && (
          <Button size="sm" variant="primary" icon="flag" onClick={() => claimCountry(c.tag)} title="Lead this nation from now on">
            Play as {c.name}
          </Button>
        )}
        {!isMe && myNationAlive && (
          <>
            <Button size="sm" variant="primary" icon="chat" onClick={() => openDiplomacy(c.tag)}>
              Open diplomacy
            </Button>
            {/* At war, the treaty builder opens on peace terms; other kinds stay one click away. */}
            <Button size="sm" variant="secondary" icon="scroll" onClick={() => openDiplomacy(c.tag, true, atWarWithMe ? "peace" : undefined)}>
              {atWarWithMe ? "Propose peace treaty" : "Propose treaty"}
            </Button>
          </>
        )}
        {isMe && myNationAlive && (
          <Button size="sm" variant="secondary" icon="crown" onClick={() => setLeftTab("formation")}>
            Form a nation
          </Button>
        )}
      </div>

      {!player && c.agenda?.goals?.length > 0 && (
        <>
          <SectionTitle>Public agenda</SectionTitle>
          {c.agenda.persona && <p className="mb-1.5 text-[12px] leading-snug text-parchment/55 italic">{c.agenda.persona}</p>}
          <ul className="space-y-1">
            {c.agenda.goals.map((g, i) => (
              <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-parchment/80">
                <span className="mt-1.5 h-1 w-1 shrink-0 rotate-45 bg-gold" />
                {g}
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Wars</SectionTitle>
      {wars.length === 0 && calls.length === 0 && <Empty>At peace.</Empty>}
      <ul className="space-y-2">
        {wars.map((w) => {
          const attacker = w.attackers.includes(c.tag);
          const enemies = attacker ? w.defenders : w.attackers;
          return (
            <li key={w.id} className="rounded border border-fail/30 bg-fail/[0.06] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[12.5px] text-parchment">
                <Icon name="swords" size={13} className="text-[#e08a80]" />
                <span className="truncate font-display">{w.name}</span>
              </div>
              <div className="mt-1 text-[11px] text-parchment/50">
                {attacker ? "Attacking" : "Defending"} since {fmtShortDate(w.since)} · {w.goal}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {enemies.map((t) => (
                  <CountryChip key={t} tag={t} small />
                ))}
              </div>
              {(w.calls?.length ?? 0) > 0 && (
                <div className="mt-1.5 text-[11px] text-partial">
                  Called to arms: {w.calls!.map((k) => countryMap(view.countries).get(k.tag)?.name ?? k.tag).join(", ")}
                </div>
              )}
            </li>
          );
        })}
        {calls.map(({ war, via }) => (
          <li key={war.id + via} className="rounded border border-partial/40 bg-partial/[0.07] px-2.5 py-2 text-[12px] text-[#f1d39a]">
            Called to arms in <b className="font-semibold">{war.name}</b> via {via}
          </li>
        ))}
      </ul>

      <ForcesSection tag={c.tag} />

      <DisputesSection view={view} tag={c.tag} />

      <SectionTitle>Treaties</SectionTitle>
      {treaties.length === 0 && <Empty>No treaties.</Empty>}
      <ul className="space-y-1.5">
        {treaties.map((t) => (
          <li key={t.id} className="text-[12px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-parchment/90">{t.name ?? TREATY_LABELS[t.type] ?? t.type}</span>
              <span className="shrink-0 text-[10.5px] text-parchment/40">{TREATY_LABELS[t.type]}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {t.members
                .filter((m) => m !== c.tag)
                .slice(0, 8)
                .map((m) => (
                  <CountryChip key={m} tag={m} small />
                ))}
              {t.members.length > 9 && <span className="text-[10.5px] text-parchment/40">+{t.members.length - 9}</span>}
            </div>
          </li>
        ))}
      </ul>

      <SectionTitle>Organisations</SectionTitle>
      {orgs.length === 0 && <Empty>No memberships.</Empty>}
      <div className="flex flex-wrap gap-1.5">
        {orgs.map((o) => {
          const role = o.members.includes(c.tag) ? (o.suspended.includes(c.tag) ? "suspended" : "") : o.observers.includes(c.tag) ? "observer" : "candidate";
          return (
            <button
              key={o.id}
              onClick={() => selectOrg(o.id)}
              title={`${o.name}${role ? ` (${role})` : ""}`}
              className={`rounded-sm border px-2 py-0.5 text-[11.5px] font-semibold tracking-wide hover:border-gold hover:text-gold-bright ${
                role ? "border-dashed border-panel-edge/70 text-parchment/55" : "border-panel-edge bg-black/20 text-parchment/85"
              }`}
            >
              {o.abbrev}
              {role && <span className="ml-1 font-normal text-[10px] opacity-70">{role}</span>}
            </button>
          );
        })}
      </div>

      {(sanctionsOn.length > 0 || sanctionsBy.length > 0) && (
        <>
          <SectionTitle>Sanctions</SectionTitle>
          <ul className="space-y-1.5 text-[12px]">
            {sanctionsOn.map((s) => (
              <li key={s.id}>
                <span className="text-[#f0b2aa]">Sanctioned by</span> <span className="text-parchment/45">({s.source})</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.by.slice(0, 10).map((t) => (
                    <CountryChip key={t} tag={t} small />
                  ))}
                  {s.by.length > 10 && <span className="text-[10.5px] text-parchment/40">+{s.by.length - 10}</span>}
                </div>
              </li>
            ))}
            {sanctionsBy.length > 0 && (
              <li>
                <span className="text-parchment/60">Sanctioning</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {sanctionsBy.map((s) => (
                    <CountryChip key={s.id} tag={s.target} small />
                  ))}
                </div>
              </li>
            )}
          </ul>
        </>
      )}

      {!isMe && me && (
        <button className="mt-4 text-[11px] text-parchment/40 underline-offset-2 hover:text-parchment hover:underline" onClick={() => selectCountry(null)}>
          ← Back to your nation
        </button>
      )}
    </Panel>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-panel-edge/30 bg-black/15 px-2.5 py-1.5">
      <dt className="hud-label text-[9.5px]">{label}</dt>
      <dd className="mt-0.5 font-display text-[15px] text-parchment tabular-nums">{value}</dd>
    </div>
  );
}

function Meter({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11.5px]">
        <span className="text-parchment/60">{label}</span>
        <span className="text-parchment/85 tabular-nums">{Math.round(value)}</span>
      </div>
      <Bar value={value} color={color} />
    </div>
  );
}

/** The selected region, when it belongs to (or is occupied by) this country. */
function RegionLine({ view, tag }: { view: GameView; tag: string }) {
  const id = useMap((s) => s.selectedId);
  const meta = useMap((s) => s.meta);
  if (!id || !meta) return null;
  const p = meta.provinces[id - 1];
  const owner = view.countries[view.owners[id]];
  const ctl = view.countries[view.controllers[id]];
  if (!p || (owner?.tag !== tag && ctl?.tag !== tag)) return null;
  return (
    <div className="mb-3 flex items-center gap-2 text-[11.5px] text-parchment/60">
      <Flag country={owner} size={14} />
      <span className="truncate">
        <span className="text-parchment/85">{p.name}</span> · {p.areaKm2.toLocaleString()} km²{p.coastal ? " · coastal" : ""}
        {ctl && owner && ctl !== owner && <span className="text-[#f0b2aa]"> · occupied by {ctl.name}</span>}
      </span>
    </div>
  );
}

/** Territorial disputes this country is party to: what it claims, and what others claim of it. */
function DisputesSection({ view, tag }: { view: GameView; tag: string }) {
  const claims = view.claims ?? [];
  const idx = view.countries.findIndex((k) => k.tag === tag);
  const mine = claims.filter((cl) => cl.claimant === tag);
  const onUs = claims.filter((cl) => cl.claimant !== tag && cl.provinces.some((id) => view.owners[id] === idx));
  if (!mine.length && !onUs.length) return null;
  const byTag = countryMap(view.countries);
  const row = (cl: (typeof claims)[number], label: string) => {
    const regions = cl.provinces.length <= 3 ? cl.provinces.map(provinceName).join(", ") : `${cl.provinces.length} regions`;
    return (
      <li key={cl.id}>
        <button
          type="button"
          onClick={() => getMap()?.focusOn(cl.provinces, { maxZoom: 1.6 })}
          className="w-full rounded border border-panel-edge/40 bg-black/15 px-2.5 py-1.5 text-left hover:border-gold/50"
          title="Show on the map"
        >
          <div className="text-[12px] text-parchment/85">
            {label} <span className="text-parchment">{regions}</span>
          </div>
          {cl.note && <div className="mt-0.5 text-[11px] leading-snug text-parchment/50">{cl.note}</div>}
        </button>
      </li>
    );
  };
  return (
    <>
      <SectionTitle>Territorial disputes</SectionTitle>
      <ul className="space-y-1.5">
        {mine.map((cl) => {
          const holders = [...new Set(cl.provinces.map((id) => view.countries[view.owners[id]]?.name).filter(Boolean))];
          return row(cl, `Claims from ${holders.join(" / ")}:`);
        })}
        {onUs.map((cl) => row(cl, `${byTag.get(cl.claimant)?.name ?? cl.claimant} claims:`))}
      </ul>
    </>
  );
}
