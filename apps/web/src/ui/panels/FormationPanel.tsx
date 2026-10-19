import { useMemo, useState } from "react";
import type { Formable, FormationGoal, GameView } from "@worldline/shared";
import { abandonFormation, assessFormation, consentFormation, proclaimFormation, recheckFormation } from "../../game/actions.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { Badge, Button, CountryChip, Empty, Field, Panel, SectionTitle, Spinner, Swatch } from "../common/ui.tsx";
import { Icon } from "../common/Icon.tsx";

const GOVERNMENTS = ["Federal republic", "Unitary republic", "Parliamentary democracy", "Constitutional monarchy", "Confederation", "Presidential republic", "One-party state", "Absolute monarchy", "Theocracy", "Military junta"];

export function FormationPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const activeId = useGame((s) => s.activeFormationId);
  const assessing = useGame((s) => !!s.formationReq && !!s.requests[s.formationReq]);
  const [composing, setComposing] = useState(false);
  const me = view.you.country;

  const goal =
    view.formations.find((f) => f.id === activeId && f.status === "active") ??
    view.formations.find((f) => f.founder === me && f.status === "active");
  const invites = view.formations.filter((f) => f.status === "active" && f.founder !== me && f.consent.some((c) => c.country === me && c.human));

  return (
    <Panel title="Form a Nation" subtitle="Unite peoples under a new flag" onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {!me && <Empty>Spectators cannot found nations.</Empty>}
      {invites.map((f) => (
        <Invitation key={f.id} goal={f} me={me!} />
      ))}
      {me && assessing && (
        <div className="mb-3 flex items-center gap-2.5 rounded border border-gold/40 bg-gold/[0.06] px-3 py-3 text-[12.5px] text-parchment/80">
          <Spinner className="text-gold" />
          Your ministers are studying the proposal…
        </div>
      )}
      {me && goal && !composing ? (
        <GoalView goal={goal} view={view} busy={assessing} onNew={() => setComposing(true)} />
      ) : (
        me && <Composer view={view} me={me} busy={assessing} onSubmitted={() => setComposing(false)} onCancel={goal ? () => setComposing(false) : undefined} />
      )}
    </Panel>
  );
}

function Invitation({ goal, me }: { goal: FormationGoal; me: string }) {
  const entry = goal.consent.find((c) => c.country === me)!;
  return (
    <div className="mb-3 rounded border border-partial/50 bg-partial/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Swatch color={goal.color} size={12} />
        <span className="font-display text-[13px] text-parchment">{goal.name}</span>
      </div>
      <p className="mt-1 text-[11.5px] leading-snug text-parchment/60">
        <CountryChip tag={goal.founder} small /> invites you to join. {goal.concept}
      </p>
      {entry.accepted === undefined ? (
        <div className="mt-2 flex gap-1.5">
          <Button size="sm" variant="success" className="flex-1" onClick={() => consentFormation(goal.id, true)}>
            Accept
          </Button>
          <Button size="sm" variant="danger" className="flex-1" onClick={() => consentFormation(goal.id, false)}>
            Decline
          </Button>
        </div>
      ) : (
        <div className="mt-1.5 text-[11.5px] text-parchment/50">You have {entry.accepted ? "accepted" : "declined"}.</div>
      )}
    </div>
  );
}

const VERDICTS = {
  achievable: { tone: "green", label: "Achievable" },
  notYet: { tone: "amber", label: "Not yet" },
  unrealistic: { tone: "red", label: "Unrealistic" },
} as const;

function GoalView({ goal, view, busy, onNew }: { goal: FormationGoal; view: GameView; busy: boolean; onNew: () => void }) {
  const me = view.you.country!;
  const v = VERDICTS[goal.verdict];
  const unmet = goal.requirements.filter((r) => !r.met).length;
  const consentOk = goal.consent.every((c) => !c.needed || c.country === goal.founder || (c.human ? c.accepted === true : c.willing === true));
  const canProclaim = goal.founder === me && goal.verdict === "achievable" && unmet === 0 && consentOk;

  return (
    <div>
      <div className="rounded border border-panel-edge/50 p-3" style={{ background: `linear-gradient(110deg, ${goal.color}44, transparent 75%)` }}>
        <div className="flex items-center gap-2.5">
          <span className="h-8 w-11 shrink-0 rounded-[2px] border border-black/60" style={{ background: goal.color }} />
          <div className="min-w-0">
            <div className="font-display text-[15px] leading-tight text-parchment">{goal.name}</div>
            <div className="text-[11px] text-parchment/55">{goal.government}</div>
          </div>
          <div className="ml-auto">
            <Badge tone={v.tone}>{v.label}</Badge>
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-snug text-parchment/70">{goal.concept}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {[goal.founder, ...goal.countries].map((t) => (
            <CountryChip key={t} tag={t} small />
          ))}
          <span className="self-center text-[10.5px] text-parchment/40">{goal.provinces.length} regions</span>
        </div>
      </div>

      <SectionTitle right={<span className="text-[10.5px] text-parchment/45">{goal.requirements.length - unmet}/{goal.requirements.length}</span>}>Requirements</SectionTitle>
      {goal.requirements.length === 0 && <Empty>No requirements set.</Empty>}
      <ul className="space-y-1.5">
        {goal.requirements.map((r, i) => (
          <li key={i} className="flex gap-2 text-[12.5px] leading-snug" title={r.why}>
            <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm border ${r.met ? "border-success/70 bg-success/20 text-success" : "border-panel-edge text-transparent"}`}>
              <Icon name="check" size={11} strokeWidth={2.4} />
            </span>
            <span className={r.met ? "text-parchment/60 line-through decoration-parchment/30" : "text-parchment/90"}>
              {r.text}
              {r.why && <span className="block text-[11px] text-parchment/40 no-underline">{r.why}</span>}
            </span>
          </li>
        ))}
      </ul>

      <SectionTitle>Consent</SectionTitle>
      <ul className="space-y-1">
        {goal.consent.map((c) => {
          const state = c.country === goal.founder ? "Founder" : !c.needed ? "Not required" : c.human ? (c.accepted === undefined ? "Awaiting reply" : c.accepted ? "Accepted" : "Declined") : c.willing === null ? "Undecided" : c.willing ? "Willing" : "Unwilling";
          const tone = /Accepted|Willing|Founder/.test(state) ? "text-[#9fd6a1]" : /Declined|Unwilling/.test(state) ? "text-[#ec9d94]" : "text-parchment/50";
          return (
            <li key={c.country} className="flex items-center gap-2 text-[11.5px]">
              <CountryChip tag={c.country} small />
              {c.human && <Badge tone="blue">Player</Badge>}
              <span className={`ml-auto ${tone}`}>{state}</span>
            </li>
          );
        })}
      </ul>

      {goal.suggestedPath && (
        <>
          <SectionTitle>Suggested path</SectionTitle>
          <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-parchment/75 select-text">{goal.suggestedPath}</p>
        </>
      )}

      {goal.founder === me && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Button size="sm" variant="secondary" icon="refresh" busy={busy} onClick={() => recheckFormation(goal.id)}>
            Re-check
          </Button>
          <Button size="sm" variant="primary" icon="crown" disabled={!canProclaim} onClick={() => proclaimFormation(goal.id)} title={canProclaim ? "Proclaim the new nation" : "All requirements and consents must be met"}>
            Proclaim
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-[#e0948b] hover:text-[#f0b2aa]"
            onClick={() => {
              if (confirm(`Abandon the dream of ${goal.name}?`)) abandonFormation(goal.id);
            }}
          >
            Abandon
          </Button>
        </div>
      )}
      <button onClick={onNew} className="mt-3 text-[11px] text-parchment/40 hover:text-parchment">
        + Assess a different nation
      </button>
    </div>
  );
}

function Composer({ view, me, busy, onSubmitted, onCancel }: { view: GameView; me: string; busy: boolean; onSubmitted: () => void; onCancel?: () => void }) {
  const myColor = countryMap(view.countries).get(me)?.color ?? "#8a7a5a";
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [countries, setCountries] = useState<string[]>([]);
  const [color, setColor] = useState(myColor);
  const [government, setGovernment] = useState(GOVERNMENTS[0]);
  const formables = useMemo(
    () => [...view.formables].sort((a, b) => Number(b.countries.includes(me)) - Number(a.countries.includes(me))),
    [view.formables, me],
  );

  const use = (f: Formable) => {
    setName(f.name);
    setConcept(f.concept);
    setCountries(f.countries.filter((t) => t !== me));
  };

  return (
    <div>
      {formables.length > 0 && (
        <>
          <SectionTitle>Historic ambitions</SectionTitle>
          <ul className="hud-scroll -mx-1 max-h-52 space-y-1.5 px-1">
            {formables.map((f) => (
              <li key={f.name}>
                <button onClick={() => use(f)} className={`w-full rounded border px-2.5 py-2 text-left transition-colors hover:border-gold/60 ${name === f.name ? "border-gold/70 bg-gold/[0.07]" : "border-panel-edge/40 bg-black/15"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[12.5px] text-parchment">{f.name}</span>
                    {f.countries.includes(me) && <Badge>Includes you</Badge>}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-parchment/55">{f.concept}</p>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <SectionTitle>Your design</SectionTitle>
      <form
        className="space-y-2.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !concept.trim()) return;
          assessFormation({ name: name.trim(), concept: concept.trim(), countries, color, government });
          onSubmitted();
        }}
      >
        <Field label="Name">
          <input className="hud-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. United States of Europe" maxLength={60} />
        </Field>
        <Field label="Concept">
          <textarea className="hud-input min-h-16 resize-none" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder="Why should these peoples unite, and how?" />
        </Field>
        <Field label="Countries joining">
          <CountryMultiSelect view={view} exclude={me} value={countries} onChange={setCountries} />
        </Field>
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <Field label="Colour">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-[31px] w-14 cursor-pointer rounded border border-panel-edge bg-transparent p-0.5" />
          </Field>
          <Field label="Government">
            <select className="hud-input" value={government} onChange={(e) => setGovernment(e.target.value)}>
              {GOVERNMENTS.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          {onCancel && (
            <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
              Back
            </Button>
          )}
          <Button type="submit" size="sm" variant="primary" icon="crown" busy={busy} disabled={!name.trim() || !concept.trim()}>
            Assess feasibility
          </Button>
        </div>
      </form>
    </div>
  );
}

function CountryMultiSelect({ view, exclude, value, onChange }: { view: GameView; exclude: string; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    return view.countries
      .filter((c) => c.alive !== false && c.tag !== exclude && !value.includes(c.tag) && (c.name.toLowerCase().includes(s) || c.tag.toLowerCase() === s))
      .slice(0, 6);
  }, [q, view.countries, exclude, value]);
  return (
    <div>
      {value.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {value.map((t) => (
            <span key={t} className="inline-flex items-center">
              <CountryChip tag={t} small onClick={() => onChange(value.filter((x) => x !== t))} />
            </span>
          ))}
          <span className="self-center text-[10px] text-parchment/35">click to remove</span>
        </div>
      )}
      <div className="relative">
        <input
          className="hud-input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search a country to add…"
          onKeyDown={(e) => {
            if (e.key === "Enter" && matches[0]) {
              e.preventDefault();
              onChange([...value, matches[0].tag]);
              setQ("");
            }
          }}
        />
        {matches.length > 0 && (
          <ul className="hud-panel absolute inset-x-0 top-full z-10 mt-1 py-1">
            {matches.map((c) => (
              <li key={c.tag}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-[12.5px] text-parchment/85 hover:bg-gold/10"
                  onClick={() => {
                    onChange([...value, c.tag]);
                    setQ("");
                  }}
                >
                  <Swatch color={c.color} size={9} /> {c.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
