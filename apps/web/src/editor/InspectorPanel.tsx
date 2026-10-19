// Right editor column: the selected nation's form, and the diplomatic web carried over from the base.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Country, TreatyType } from "@worldline/shared";
import { Badge, Button, Field, Modal, SectionTitle, Toggle } from "../ui/common/ui.tsx";
import { Flag } from "../ui/common/Flag.tsx";
import { Icon } from "../ui/common/Icon.tsx";
import { getMap } from "../map/controller.ts";
import { ORG_KIND_LABELS, TREATY_LABELS } from "../game/selectors.ts";
import {
  addTreaty, addWar, deleteCountry, removeOrg, removeSanction, removeTreaty, removeWar, selectCountryIdx, setTool, TAG_RE, tagIsFree,
  updateCountry, useEditor,
} from "./editorStore.ts";
import { TagChip, TagPicker } from "./bits.tsx";
import { FlagField } from "./FlagField.tsx";

type Tab = "nation" | "world";

export function InspectorPanel() {
  const selected = useEditor((s) => s.selected);
  const selTag = useEditor((s) => s.seed?.countries[s.selected]?.tag ?? "");
  const [tab, setTab] = useState<Tab>("nation");
  useEffect(() => {
    if (selected >= 0) setTab("nation");
  }, [selected]);

  return (
    <section className="hud-panel pointer-events-auto flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 items-center gap-1 border-b border-panel-edge/50 px-3 py-2">
        <TabButton active={tab === "nation"} onClick={() => setTab("nation")}>
          Nation
        </TabButton>
        <TabButton active={tab === "world"} onClick={() => setTab("world")}>
          Diplomacy
        </TabButton>
      </header>
      <div className="hud-scroll min-h-0 flex-1 px-4 py-3">{tab === "nation" ? selected >= 0 ? <CountryForm key={`${selected}-${selTag}`} idx={selected} /> : <NoSelection /> : <WorldLists />}</div>
    </section>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-3 py-1 font-display text-[12px] tracking-[0.12em] transition-colors ${active ? "bg-gold/15 text-gold-bright ring-1 ring-gold/50" : "text-parchment/55 hover:text-parchment"}`}
    >
      {children}
    </button>
  );
}

function NoSelection() {
  return (
    <div className="py-6 text-center text-[12px] leading-relaxed text-parchment/50">
      <Icon name="flag" size={22} className="mx-auto mb-2 text-gold/50" />
      Select a nation from the list, or pick one on the map with the eyedropper <kbd className="rounded border border-panel-edge px-1 text-[10px]">I</kbd>.
      <p className="mt-3 text-[11px] text-parchment/40">Then paint regions with the brush <kbd className="rounded border border-panel-edge px-1 text-[10px]">B</kbd> — drag to paint, right-drag to pan.</p>
    </div>
  );
}

const num = (v: string, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min;
};

function CountryForm({ idx }: { idx: number }) {
  const c = useEditor((s) => s.seed?.countries[idx]);
  const rev = useEditor((s) => s.rev);
  const owners = useEditor((s) => s.seed?.owners);
  const [tagDraft, setTagDraft] = useState(c?.tag ?? "");
  const [goals, setGoals] = useState((c?.agenda.goals ?? []).join("\n"));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const regions = useMemo(() => {
    let n = 0;
    if (owners) for (let id = 1; id < owners.length; id++) if (owners[id] === idx) n++;
    return n;
    // `rev` tracks in-place paint edits.
  }, [owners, idx, rev]);
  if (!c) return null;

  const tagValid = TAG_RE.test(tagDraft);
  const tagFree = tagIsFree(tagDraft, idx);
  const commitTag = () => {
    if (tagDraft === c.tag) return;
    if (tagValid && tagFree) updateCountry(idx, { tag: tagDraft });
  };
  const set = (patch: Partial<Country>) => updateCountry(idx, patch);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded border border-panel-edge/50 p-2.5" style={{ background: `linear-gradient(90deg, ${c.color}40, transparent)` }}>
        <Flag country={c} size={48} className="ring-1 ring-gold/40" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] text-parchment">{c.name || "Unnamed"}</div>
          <div className="text-[11px] text-parchment/55">
            {regions} region{regions === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Button size="sm" variant="secondary" icon="brush" onClick={() => setTool("paint")} title="Paint regions for this nation (B)">
            Paint
          </Button>
          <Button size="sm" variant="ghost" icon="map" onClick={() => getMap()?.focusOn({ country: idx }, { maxZoom: 2 })} disabled={!regions}>
            Find
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-[76px_1fr] gap-2">
        <Field label="Tag">
          <input
            className={`hud-input font-mono uppercase ${tagValid && tagFree ? "" : "border-fail/70"}`}
            value={tagDraft}
            maxLength={8}
            onChange={(e) => setTagDraft(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
            onBlur={commitTag}
            onKeyDown={(e) => e.key === "Enter" && commitTag()}
          />
        </Field>
        <Field label="Name">
          <input className="hud-input" value={c.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
        </Field>
      </div>
      {(!tagValid || !tagFree) && <p className="-mt-2 text-[11px] text-[#f0b2aa]">{!tagValid ? "2–8 capitals or digits, starting with a letter." : "Another nation already uses this tag."}</p>}

      <Field label="Colour">
        <div className="flex gap-2">
          <input type="color" className="h-8 w-10 shrink-0 cursor-pointer rounded border border-panel-edge bg-transparent p-0.5" value={c.color} onChange={(e) => set({ color: e.target.value })} />
          <input
            className="hud-input font-mono text-[12px]"
            defaultValue={c.color}
            key={c.color}
            maxLength={7}
            onBlur={(e) => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && set({ color: e.target.value.toLowerCase() })}
          />
        </div>
      </Field>
      <div>
        <span className="hud-label mb-1 block">Flag</span>
        <FlagField key={idx} country={c} onChange={(flag) => set({ flag })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Government">
          <input className="hud-input" value={c.government} onChange={(e) => set({ government: e.target.value })} />
        </Field>
        <Field label="Leader">
          <input className="hud-input" value={c.leader} onChange={(e) => set({ leader: e.target.value })} />
        </Field>
        <Field label="GDP (USD bn)">
          <input type="number" min={0} step="any" className="hud-input" value={c.gdp} onChange={(e) => set({ gdp: num(e.target.value, 0, 1e6) })} />
        </Field>
        <Field label="Population (m)">
          <input type="number" min={0} step="any" className="hud-input" value={c.population} onChange={(e) => set({ population: num(e.target.value, 0, 1e5) })} />
        </Field>
        <Field label={`Stability · ${c.stability}`}>
          <input type="range" min={0} max={100} className="w-full accent-[#c9a45c]" value={c.stability} onChange={(e) => set({ stability: Number(e.target.value) })} />
        </Field>
        <Field label={`Military · ${c.military}`}>
          <input type="range" min={0} max={100} className="w-full accent-[#c9a45c]" value={c.military} onChange={(e) => set({ military: Number(e.target.value) })} />
        </Field>
      </div>
      <Toggle label="Nuclear-armed" checked={!!c.nuclear} onChange={(v) => set({ nuclear: v })} />

      <SectionTitle>Agenda</SectionTitle>
      <Field label="Persona" hint="How the AI should play this nation.">
        <textarea className="hud-input min-h-[64px] resize-y text-[12px] leading-snug" value={c.agenda.persona} onChange={(e) => set({ agenda: { ...c.agenda, persona: e.target.value } })} />
      </Field>
      <Field label="Goals" hint="One per line.">
        <textarea
          className="hud-input min-h-[64px] resize-y text-[12px] leading-snug"
          value={goals}
          onChange={(e) => setGoals(e.target.value)}
          onBlur={() => set({ agenda: { ...c.agenda, goals: goals.split("\n").map((g) => g.trim()).filter(Boolean) } })}
        />
      </Field>

      <div className="flex justify-between pt-2">
        <Button size="sm" variant="ghost" onClick={() => selectCountryIdx(-1)}>
          Deselect
        </Button>
        <Button size="sm" variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
          Delete nation…
        </Button>
      </div>
      {confirmDelete && <DeleteDialog idx={idx} regions={regions} onClose={() => setConfirmDelete(false)} />}
    </div>
  );
}

function DeleteDialog({ idx, regions, onClose }: { idx: number; regions: number; onClose: () => void }) {
  const countries = useEditor((s) => s.seed!.countries);
  const c = countries[idx];
  const [heir, setHeir] = useState<string>("");
  const others = countries.map((x, i) => ({ x, i })).filter(({ i }) => i !== idx).sort((a, b) => a.x.name.localeCompare(b.x.name));

  return createPortal(
    <Modal onClose={onClose} className="w-[min(420px,calc(100%-2rem))]">
      <div className="px-5 pt-4 pb-3">
        <h2 className="font-display text-[16px] tracking-[0.12em] text-gold-bright">Delete {c.name}?</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-parchment/75">
          {regions ? `Its ${regions} region${regions === 1 ? "" : "s"} must go somewhere.` : "It owns no regions."} Treaties, wars, organisation seats and relations that mention it are removed. The paint undo history is cleared.
        </p>
        {regions > 0 && (
          <Field label="Regions pass to">
            <select className="hud-input mt-0.5" value={heir} onChange={(e) => setHeir(e.target.value)}>
              <option value="">— Leave them unowned —</option>
              {others.map(({ x, i }) => (
                <option key={x.tag} value={String(i)}>
                  {x.name} ({x.tag})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <footer className="flex justify-end gap-2 border-t border-panel-edge/50 px-5 py-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="danger"
          icon="trash"
          onClick={() => {
            deleteCountry(idx, heir === "" ? -1 : Number(heir));
            onClose();
          }}
        >
          Delete nation
        </Button>
      </footer>
    </Modal>,
    document.body,
  );
}

// --- Diplomacy -----------------------------------------------------------------------------------

function Row({ children, onDelete, title }: { children: ReactNode; onDelete: () => void; title: string }) {
  return (
    <li className="group flex items-start gap-2 rounded border border-panel-edge/35 bg-black/20 px-2.5 py-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      <button onClick={onDelete} className="mt-0.5 rounded p-0.5 text-parchment/30 hover:text-[#f0b2aa]" title={title} aria-label={title}>
        <Icon name="trash" size={12} />
      </button>
    </li>
  );
}

function WorldLists() {
  const seed = useEditor((s) => s.seed)!;
  const [adding, setAdding] = useState<"treaty" | "war" | null>(null);
  return (
    <div>
      <SectionTitle right={<AddLink onClick={() => setAdding(adding === "treaty" ? null : "treaty")} open={adding === "treaty"} />}>Treaties · {seed.treaties.length}</SectionTitle>
      {adding === "treaty" && <TreatyForm onDone={() => setAdding(null)} />}
      <ul className="space-y-1">
        {seed.treaties.map((t) => (
          <Row key={t.id} onDelete={() => removeTreaty(t.id)} title="Remove treaty">
            <div className="flex items-center gap-1.5">
              <Badge tone="grey">{TREATY_LABELS[t.type] ?? t.type}</Badge>
              <span className="min-w-0 truncate text-[11.5px] text-parchment/80">{t.name ?? ""}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {t.members.slice(0, 8).map((m) => (
                <TagChip key={m} tag={m} />
              ))}
              {t.members.length > 8 && <span className="text-[10.5px] text-parchment/40">+{t.members.length - 8}</span>}
            </div>
          </Row>
        ))}
      </ul>

      <SectionTitle right={<AddLink onClick={() => setAdding(adding === "war" ? null : "war")} open={adding === "war"} />}>Wars · {seed.wars.length}</SectionTitle>
      {adding === "war" && <WarForm onDone={() => setAdding(null)} />}
      <ul className="space-y-1">
        {seed.wars.length === 0 && <li className="text-[11.5px] text-parchment/40 italic">At peace.</li>}
        {seed.wars.map((w) => (
          <Row key={w.id} onDelete={() => removeWar(w.id)} title="Remove war">
            <div className="text-[12px] text-parchment/90">{w.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {w.attackers.map((m) => (
                <TagChip key={m} tag={m} />
              ))}
              <Icon name="swords" size={11} className="text-fail" />
              {w.defenders.map((m) => (
                <TagChip key={m} tag={m} />
              ))}
            </div>
          </Row>
        ))}
      </ul>

      <SectionTitle>Organisations · {seed.organizations.length}</SectionTitle>
      <ul className="space-y-1">
        {seed.organizations.map((o) => (
          <Row key={o.id} onDelete={() => removeOrg(o.id)} title="Remove organisation">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-[12px] font-bold text-parchment">{o.abbrev}</span>
              <span className="min-w-0 truncate text-[11.5px] text-parchment/65">{o.name}</span>
            </div>
            <div className="text-[10.5px] text-parchment/45">
              {ORG_KIND_LABELS[o.kind] ?? o.kind} · {o.members.length} member{o.members.length === 1 ? "" : "s"}
            </div>
          </Row>
        ))}
      </ul>

      <SectionTitle>Sanctions · {seed.sanctions.length}</SectionTitle>
      <ul className="space-y-1">
        {seed.sanctions.length === 0 && <li className="text-[11.5px] text-parchment/40 italic">None.</li>}
        {seed.sanctions.map((s) => (
          <Row key={s.id} onDelete={() => removeSanction(s.id)} title="Lift sanctions">
            <div className="flex items-center gap-1.5 text-[11.5px] text-parchment/70">
              <TagChip tag={s.target} /> sanctioned by {s.by.length} nation{s.by.length === 1 ? "" : "s"}
            </div>
          </Row>
        ))}
      </ul>
      <p className="mt-4 text-[10.5px] leading-snug text-parchment/35">Entries naming a deleted nation are removed automatically. Relations, calendar and formable nations carry over from the base scenario.</p>
    </div>
  );
}

function AddLink({ onClick, open }: { onClick: () => void; open: boolean }) {
  return (
    <button onClick={onClick} className="flex items-center gap-0.5 text-[10.5px] tracking-wider text-gold/80 uppercase hover:text-gold-bright">
      <Icon name={open ? "close" : "plus"} size={10} /> {open ? "Cancel" : "Add"}
    </button>
  );
}

function TreatyForm({ onDone }: { onDone: () => void }) {
  const [type, setType] = useState<TreatyType>("alliance");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<string[]>([]);
  return (
    <div className="mb-2 space-y-2 rounded border border-gold/40 bg-gold/[0.04] p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Type">
          <select className="hud-input py-1 text-[12px]" value={type} onChange={(e) => setType(e.target.value as TreatyType)}>
            {Object.entries(TREATY_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name (optional)">
          <input className="hud-input py-1 text-[12px]" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <div>
        <span className="hud-label mb-1 block">Members</span>
        <TagPicker value={members} onChange={setMembers} />
      </div>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={members.length < 2}
          onClick={() => {
            addTreaty(type, members, name);
            onDone();
          }}
        >
          Add treaty
        </Button>
      </div>
    </div>
  );
}

function WarForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [attackers, setAttackers] = useState<string[]>([]);
  const [defenders, setDefenders] = useState<string[]>([]);
  return (
    <div className="mb-2 space-y-2 rounded border border-gold/40 bg-gold/[0.04] p-2.5">
      <Field label="Name">
        <input className="hud-input py-1 text-[12px]" value={name} placeholder="e.g. Second Korean War" onChange={(e) => setName(e.target.value)} />
      </Field>
      <div>
        <span className="hud-label mb-1 block">Attackers</span>
        <TagPicker value={attackers} onChange={setAttackers} exclude={defenders} />
      </div>
      <div>
        <span className="hud-label mb-1 block">Defenders</span>
        <TagPicker value={defenders} onChange={setDefenders} exclude={attackers} />
      </div>
      <Field label="War goal">
        <input className="hud-input py-1 text-[12px]" value={goal} onChange={(e) => setGoal(e.target.value)} />
      </Field>
      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          disabled={!attackers.length || !defenders.length}
          onClick={() => {
            addWar(name, attackers, defenders, goal);
            onDone();
          }}
        >
          Add war
        </Button>
      </div>
    </div>
  );
}
