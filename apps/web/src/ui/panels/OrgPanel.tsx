import { useMemo, useState } from "react";
import type { GameView, Organization, OrgBody, Resolution, ResolutionType } from "@worldline/shared";
import { proposeResolution, selectOrg, setMapMode, voteResolution } from "../../game/actions.ts";
import { fmtShortDate } from "../../game/format.ts";
import { countryMap, ORG_KIND_LABELS, RESOLUTION_LABELS, RULE_LABELS } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { Badge, Bar, Button, CountryChip, Empty, Field, Panel, SectionTitle, Swatch } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

export function OrgPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const orgId = useGame((s) => s.selectedOrg);
  const org = view.organizations.find((o) => o.id === orgId);
  return org ? (
    <OrgDetail view={view} org={org} onClose={onClose} />
  ) : (
    <OrgList view={view} onClose={onClose} />
  );
}

function OrgList({ view, onClose }: { view: GameView; onClose: () => void }) {
  const [q, setQ] = useState("");
  const me = view.you.country;
  const orgs = useMemo(() => {
    const s = q.trim().toLowerCase();
    return view.organizations
      .filter((o) => !s || o.abbrev.toLowerCase().includes(s) || o.name.toLowerCase().includes(s))
      .sort((a, b) => Number(!!me && b.members.includes(me)) - Number(!!me && a.members.includes(me)) || b.members.length - a.members.length);
  }, [view.organizations, q, me]);

  return (
    <Panel title="Organisations" subtitle={`${view.organizations.length} international bodies`} onClose={onClose} className="max-h-full" bodyClassName="px-3 py-3">
      <input className="hud-input mb-2" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="space-y-1">
        {orgs.map((o) => {
          const mine = !!me && o.members.includes(me);
          const pending = view.resolutions.filter((r) => r.orgId === o.id && r.status === "pending").length;
          return (
            <li key={o.id}>
              <button onClick={() => selectOrg(o.id)} className="w-full rounded border border-transparent px-2 py-1.5 text-left hover:border-panel-edge/60 hover:bg-white/[0.03]">
                <div className="flex items-center gap-2">
                  <span title={o.abbrev} className={`w-14 shrink-0 truncate font-display text-[12.5px] font-bold ${mine ? "text-gold-bright" : "text-parchment/85"}`}>{o.abbrev}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-parchment/75">{o.name}</span>
                  {pending > 0 && <Badge tone="amber">{pending} vote{pending > 1 ? "s" : ""}</Badge>}
                </div>
                <div className="mt-1 flex items-center gap-2 pl-16 text-[10.5px] text-parchment/45">
                  <span>{ORG_KIND_LABELS[o.kind]}</span>
                  <span>·</span>
                  <span>{o.members.length} members</span>
                  <Bar value={o.cohesion} color="#c9a45c" className="ml-auto w-14" />
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

const sitsIn = (org: Organization, body: OrgBody, tag: string) =>
  !org.suspended.includes(tag) && (body.seats.length ? body.seats.includes(tag) : org.members.includes(tag));

/** Which body decides a resolution (fallback: the first). */
const bodyFor = (org: Organization, r: Resolution) => org.bodies.find((b) => b.id === r.bodyId) ?? org.bodies.find((b) => b.handles?.includes(r.type)) ?? org.bodies[0];

function OrgDetail({ view, org, onClose }: { view: GameView; org: Organization; onClose: () => void }) {
  const me = view.you.country;
  const mapMode = useGame((s) => s.mapMode);
  const resolutions = view.resolutions.filter((r) => r.orgId === org.id);
  const pending = resolutions.filter((r) => r.status === "pending");
  const past = resolutions.filter((r) => r.status !== "pending").slice().reverse();

  return (
    <Panel
      title={
        <span>
          {org.abbrev} <span className="font-sans text-[11px] tracking-normal text-parchment/50">{ORG_KIND_LABELS[org.kind]}</span>
        </span>
      }
      subtitle={org.name}
      onClose={onClose}
      actions={
        <button title="Show members on the map" className={`rounded p-1 hover:bg-white/5 ${mapMode === "orgs" ? "text-gold-bright" : "text-parchment/50"}`} onClick={() => setMapMode(mapMode === "orgs" ? "political" : "orgs")}>
          <Icon name="map" size={14} />
        </button>
      }
      className="max-h-full"
      bodyClassName="px-4 py-3"
    >
      <button onClick={() => selectOrg(null)} className="mb-3 flex items-center gap-1 text-[11px] text-parchment/50 hover:text-parchment">
        <Icon name="chevronLeft" size={12} /> All organisations
      </button>

      <div className="flex items-center gap-3">
        <span className="hud-label">Cohesion</span>
        <Bar value={org.cohesion} color="#c9a45c" className="flex-1" />
        <span className="text-[11.5px] text-parchment/70 tabular-nums">{Math.round(org.cohesion)}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {org.effects.tradeBloc && <Badge tone="green">Trade bloc</Badge>}
        {org.effects.mutualDefense && <Badge tone="red">Mutual defence</Badge>}
        {org.effects.forum && <Badge tone="grey">Forum</Badge>}
        {org.founded && <Badge tone="grey">Founded {org.founded.slice(0, 4)}</Badge>}
      </div>

      <SectionTitle>Bodies</SectionTitle>
      <ul className="space-y-2">
        {org.bodies.map((b) => (
          <li key={b.id} className="rounded border border-panel-edge/35 bg-black/15 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-display text-[12.5px] text-parchment">{b.name}</span>
              {me && sitsIn(org, b, me) && <Badge>Your seat</Badge>}
            </div>
            <div className="mt-0.5 text-[11px] text-parchment/55">{RULE_LABELS[b.rule]}</div>
            <div className="mt-0.5 text-[11px] text-parchment/40">{b.seats.length ? `${b.seats.length} seats` : "All members sit"}</div>
            {b.veto && b.veto.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-1 text-[10.5px] text-parchment/50">
                Veto:
                {b.veto.map((t) => (
                  <CountryChip key={t} tag={t} small />
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <SectionTitle>Members ({org.members.length})</SectionTitle>
      <div className="flex flex-wrap gap-1">
        {org.members.map((t) => (
          <CountryChip key={t} tag={t} small />
        ))}
      </div>
      {org.observers.length > 0 && (
        <>
          <SectionTitle>Observers</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {org.observers.map((t) => (
              <CountryChip key={t} tag={t} small />
            ))}
          </div>
        </>
      )}
      {org.candidates.length > 0 && (
        <>
          <SectionTitle>Candidates</SectionTitle>
          <ul className="space-y-1">
            {org.candidates.map((c) => (
              <li key={c.tag} className="flex items-center gap-2 text-[11px] text-parchment/50">
                <CountryChip tag={c.tag} small />
                <span className="truncate">since {fmtShortDate(c.since)}{c.note ? ` · ${c.note}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {org.suspended.length > 0 && (
        <>
          <SectionTitle>Suspended</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {org.suspended.map((t) => (
              <CountryChip key={t} tag={t} small />
            ))}
          </div>
        </>
      )}

      <SectionTitle>On the agenda</SectionTitle>
      {pending.length === 0 && <Empty>No resolutions pending this turn.</Empty>}
      <ul className="space-y-2">
        {pending.map((r) => (
          <PendingResolution key={r.id} r={r} org={org} me={me} />
        ))}
      </ul>

      {me && org.members.includes(me) && !org.suspended.includes(me) && <ProposeForm view={view} org={org} />}

      <SectionTitle>Past resolutions</SectionTitle>
      {past.length === 0 && <Empty>None yet.</Empty>}
      <ul className="space-y-2">
        {past.map((r) => (
          <PastResolution key={r.id} r={r} />
        ))}
      </ul>
    </Panel>
  );
}

function ResolutionHead({ r }: { r: Resolution }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-display text-[12px] text-parchment">{RESOLUTION_LABELS[r.type] ?? r.type}</span>
        {r.target && (
          <>
            <span className="text-[10.5px] text-parchment/40">on</span>
            <CountryChip tag={r.target} small />
          </>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-snug text-parchment/70 select-text">{r.text}</p>
      <div className="mt-1 flex items-center gap-1 text-[10.5px] text-parchment/40">
        Proposed by <CountryChip tag={r.proposer} small /> · turn {r.turn}
      </div>
    </>
  );
}

function PendingResolution({ r, org, me }: { r: Resolution; org: Organization; me: string | null }) {
  const body = bodyFor(org, r);
  const canVote = !!me && !!body && sitsIn(org, body, me);
  const mine = me ? r.votes?.[me] : undefined;
  return (
    <li className="rounded border border-partial/35 bg-partial/[0.05] px-2.5 py-2">
      <ResolutionHead r={r} />
      {body && <div className="mt-1 text-[10.5px] text-parchment/40">{body.name} · {RULE_LABELS[body.rule]}</div>}
      {canVote && (
        <div className="mt-2 flex gap-1.5">
          {(["yes", "no", "abstain"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={mine === v ? (v === "yes" ? "success" : v === "no" ? "danger" : "primary") : "secondary"}
              onClick={() => voteResolution(r.id, v)}
              className="flex-1"
            >
              {v === "yes" ? "Yes" : v === "no" ? "No" : "Abstain"}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

const VOTE_COLORS = { yes: "#6fbf73", no: "#d0574d", abstain: "#8f8a7e" };

function PastResolution({ r }: { r: Resolution }) {
  const countries = useGame((s) => s.view!.countries);
  const votes = Object.entries(r.votes ?? {});
  const count = (v: string) => votes.filter(([, x]) => x === v).length;
  const tone = r.status === "passed" ? "green" : r.status === "vetoed" ? "amber" : "red";
  return (
    <li className="rounded border border-panel-edge/35 bg-black/15 px-2.5 py-2">
      <div className="mb-1 flex items-center justify-between">
        <Badge tone={tone}>{r.status}</Badge>
        {votes.length > 0 && (
          <span className="text-[10.5px] text-parchment/50 tabular-nums">
            <span className="text-[#9fd6a1]">{count("yes")} yes</span> · <span className="text-[#ec9d94]">{count("no")} no</span> · {count("abstain")} abst.
          </span>
        )}
      </div>
      <ResolutionHead r={r} />
      {votes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-[3px]">
          {votes.map(([tag, v]) => {
            const c = countryMap(countries).get(tag);
            const reason = r.reasons?.[tag];
            return (
              <span
                key={tag}
                title={`${c?.name ?? tag}: ${v}${reason ? ` — ${reason}` : ""}`}
                className="inline-flex items-center gap-1 rounded-sm border px-1 text-[9.5px] text-parchment/75"
                style={{ borderColor: VOTE_COLORS[v] + "aa", background: VOTE_COLORS[v] + "1f" }}
              >
                <Swatch color={c?.color} size={6} />
                {tag}
              </span>
            );
          })}
        </div>
      )}
    </li>
  );
}

function ProposeForm({ view, org }: { view: GameView; org: Organization }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ResolutionType>(org.powers[0] ?? "custom");
  const [target, setTarget] = useState("");
  const [text, setText] = useState("");
  const countries = useMemo(() => view.countries.filter((c) => c.alive !== false).sort((a, b) => a.name.localeCompare(b.name)), [view.countries]);
  const powers = org.powers.length ? org.powers : (["custom"] as ResolutionType[]);

  if (!open) {
    return (
      <Button size="sm" variant="secondary" icon="plus" className="mt-2 w-full" onClick={() => setOpen(true)}>
        Propose a resolution
      </Button>
    );
  }
  return (
    <form
      className="mt-3 space-y-2.5 rounded border border-gold/40 bg-gold/[0.04] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        proposeResolution(org.id, type, text.trim(), target || undefined);
        setText("");
        setTarget("");
        setOpen(false);
      }}
    >
      <div className="font-display text-[12.5px] tracking-wide text-gold-bright">New resolution — {org.abbrev}</div>
      <Field label="Type">
        <select className="hud-input" value={type} onChange={(e) => setType(e.target.value as ResolutionType)}>
          {powers.map((p) => (
            <option key={p} value={p}>
              {RESOLUTION_LABELS[p] ?? p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Target (optional)">
        <select className="hud-input" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— None —</option>
          {countries.map((c) => (
            <option key={c.tag} value={c.tag}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Text">
        <textarea className="hud-input min-h-16 resize-none" value={text} onChange={(e) => setText(e.target.value)} placeholder="The assembly calls upon…" />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button type="submit" size="sm" variant="primary" disabled={!text.trim()}>
          Table resolution
        </Button>
      </div>
    </form>
  );
}
