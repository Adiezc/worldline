// Scenario editor state. The working seed's owners/controllers arrays are mutated in place
// while painting (one texel write per province on the GPU); `rev` bumps when they change so
// React views (region counts, hover) can follow. Everything else is updated immutably.
import { create } from "zustand";
import type { Country, CustomScenarioRequest, EraTheme, ScenarioSeed, TreatyType } from "@worldline/shared";
import { colorDistance } from "@worldline/shared";
import { getMap } from "../map/controller.ts";
import { useMap } from "../store.ts";
import { loadSeed } from "../net/scenarios.ts";
import { errorText } from "../net/api.ts";

export type Tool = "paint" | "erase" | "fill" | "pick";

interface Stroke {
  ids: number[];
  prev: [number, number][];
  next: [number, number][];
}

export interface EditorState {
  status: "idle" | "loading" | "ready" | "error";
  error?: string;
  /** Shown above the panels, e.g. "server offline: editing the bundled scenario". */
  notice?: string;
  baseId: string | null;
  seed: ScenarioSeed | null;
  /** Bumps on every ownership change. */
  rev: number;
  selected: number;
  tool: Tool;
  undo: Stroke[];
  redo: Stroke[];
  dirty: boolean;
  savedId: string | null;
}

const initial: EditorState = {
  status: "idle",
  baseId: null,
  seed: null,
  rev: 0,
  selected: -1,
  tool: "paint",
  undo: [],
  redo: [],
  dirty: false,
  savedId: null,
};

export const useEditor = create<EditorState>(() => ({ ...initial }));

const MAX_UNDO = 100;
export const TAG_RE = /^[A-Z][A-Z0-9]{1,7}$/;

// --- Loading -----------------------------------------------------------------------------------

let loadSeq = 0;
export async function loadBase(id: string) {
  const seq = ++loadSeq;
  useEditor.setState({ ...initial, status: "loading", baseId: id });
  try {
    const base = await loadSeed(id);
    if (seq !== loadSeq) return;
    const { fromBundle, ...rest } = base;
    const seed: ScenarioSeed = structuredClone(rest);
    seed.description ??= "";
    seed.theme ??= "modern";
    delete seed.author;
    seed.owners = Array.from(seed.owners);
    seed.controllers = Array.from(seed.controllers);
    useEditor.setState({
      status: "ready",
      seed,
      notice: fromBundle ? "The server is offline or has no scenario API yet: editing the bundled Modern Day scenario. Saving needs the server." : undefined,
    });
    useMap.setState({ theme: seed.theme ?? "modern" });
    redrawAll();
  } catch (e) {
    if (seq !== loadSeq) return;
    useEditor.setState({ status: "error", error: errorText(e) });
  }
}

export const resetEditor = () => {
  loadSeq++;
  window.clearTimeout(labelTimer);
  useEditor.setState({ ...initial }, true);
};

// --- Map bridge ----------------------------------------------------------------------------------

let labelTimer = 0;
/** Recompute curved labels after edits, debounced so a long stroke triggers one pass. */
export function scheduleLabels(delay = 350) {
  window.clearTimeout(labelTimer);
  labelTimer = window.setTimeout(() => {
    const seed = useEditor.getState().seed;
    if (seed) getMap()?.recomputeLabels(seed.owners);
  }, delay);
}

/** Palette + label names/inks from the current countries. */
export function pushStyle() {
  const { seed } = useEditor.getState();
  const map = getMap();
  if (!seed || !map) return;
  map.setPalette(seed.countries.map((c) => c.color));
  map.setLabelStyle(seed.countries.map((c) => c.name), seed.countries.map((c) => c.color));
}

export function redrawAll() {
  const { seed } = useEditor.getState();
  const map = getMap();
  if (!seed || !map) return;
  pushStyle();
  map.setOwnership(seed.owners, seed.controllers);
  map.recomputeLabels(seed.owners);
}

// --- Painting ------------------------------------------------------------------------------------

let stroke: Stroke | null = null;

function setProv(id: number, owner: number, controller: number) {
  const seed = useEditor.getState().seed!;
  if (stroke) {
    const at = stroke.ids.indexOf(id);
    if (at >= 0) stroke.next[at] = [owner, controller];
    else {
      stroke.ids.push(id);
      stroke.prev.push([seed.owners[id], seed.controllers[id]]);
      stroke.next.push([owner, controller]);
    }
  }
  seed.owners[id] = owner;
  seed.controllers[id] = controller;
  getMap()?.setProvince(id, owner, controller);
}

export function beginStroke() {
  stroke = { ids: [], prev: [], next: [] };
}

/** Apply the active tool to one province (0 = sea, ignored). */
export function applyTool(id: number, first: boolean) {
  const st = useEditor.getState();
  const seed = st.seed;
  if (!seed || id <= 0 || id >= seed.owners.length) return;
  const sel = st.selected;
  switch (st.tool) {
    case "paint":
      if (sel < 0) return;
      if (seed.owners[id] !== sel || seed.controllers[id] !== sel) setProv(id, sel, sel);
      break;
    case "erase":
      if (seed.owners[id] !== -1 || seed.controllers[id] !== -1) setProv(id, -1, -1);
      break;
    case "fill": {
      if (!first || sel < 0) return;
      const from = seed.owners[id];
      if (from === sel) return;
      for (let p = 1; p < seed.owners.length; p++) if (seed.owners[p] === from) setProv(p, sel, sel);
      break;
    }
    case "pick":
      if (!first) return;
      useEditor.setState({ selected: seed.owners[id], tool: seed.owners[id] >= 0 ? "paint" : st.tool });
      break;
  }
}

export function endStroke() {
  const s = stroke;
  stroke = null;
  if (!s || !s.ids.length) return;
  useEditor.setState((st) => ({ undo: [...st.undo.slice(-(MAX_UNDO - 1)), s], redo: [], rev: st.rev + 1, dirty: true }));
  scheduleLabels();
}

function replay(s: Stroke, which: "prev" | "next") {
  const seed = useEditor.getState().seed;
  const map = getMap();
  if (!seed) return;
  s.ids.forEach((id, i) => {
    const [o, c] = s[which][i];
    seed.owners[id] = o;
    seed.controllers[id] = c;
    if (s.ids.length <= 64) map?.setProvince(id, o, c);
  });
  if (s.ids.length > 64) map?.setOwnership(seed.owners, seed.controllers);
  scheduleLabels(120);
}

export function undo() {
  const { undo: u } = useEditor.getState();
  const s = u[u.length - 1];
  if (!s) return;
  replay(s, "prev");
  useEditor.setState((st) => ({ undo: st.undo.slice(0, -1), redo: [...st.redo, s], rev: st.rev + 1, dirty: true }));
}

export function redo() {
  const { redo: r } = useEditor.getState();
  const s = r[r.length - 1];
  if (!s) return;
  replay(s, "next");
  useEditor.setState((st) => ({ redo: st.redo.slice(0, -1), undo: [...st.undo, s], rev: st.rev + 1, dirty: true }));
}

export const setTool = (tool: Tool) => useEditor.setState({ tool });
export const selectCountryIdx = (selected: number) => useEditor.setState({ selected });

// --- Seed edits ----------------------------------------------------------------------------------

function patchSeed(fn: (seed: ScenarioSeed) => ScenarioSeed) {
  useEditor.setState((st) => (st.seed ? { seed: fn(st.seed), dirty: true } : {}));
}

export function updateMeta(patch: Partial<Pick<ScenarioSeed, "name" | "date" | "description" | "worldBrief" | "rules" | "theme">>) {
  patchSeed((s) => ({ ...s, ...patch }));
  if (patch.theme) useMap.setState({ theme: patch.theme as EraTheme });
}

export function updateCountry(idx: number, patch: Partial<Country>) {
  const seed = useEditor.getState().seed;
  if (!seed || !seed.countries[idx]) return;
  const old = seed.countries[idx];
  let next = { ...seed, countries: seed.countries.map((c, i) => (i === idx ? { ...c, ...patch } : c)) };
  if (patch.tag && patch.tag !== old.tag) next = renameTag(next, old.tag, patch.tag);
  useEditor.setState({ seed: next, dirty: true });
  if (patch.color || patch.name !== undefined) pushStyle();
  if (patch.name !== undefined && patch.name.length !== old.name.length) scheduleLabels(500);
}

export function tagIsFree(tag: string, except = -1) {
  const seed = useEditor.getState().seed;
  return !!seed && !seed.countries.some((c, i) => i !== except && c.tag === tag);
}

function uniqueTag(seed: ScenarioSeed) {
  const used = new Set(seed.countries.map((c) => c.tag));
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  for (const first of "XQZ") for (const b of A) for (const c of A) if (!used.has(first + b + c)) return first + b + c;
  return `N${seed.countries.length}`;
}

function hsl(h: number, s: number, l: number) {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [f(0), f(8), f(4)].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");
}

/** A muted map colour as far as possible from every existing one. */
export function contrastingColor(existing: string[]) {
  let best = "#8a7f6a", score = -1;
  for (let h = 0; h < 360; h += 7) {
    for (const [s, l] of [[0.42, 0.56], [0.34, 0.64], [0.4, 0.46], [0.5, 0.6]]) {
      const c = hsl(h, s, l);
      let d = Infinity;
      for (const e of existing) d = Math.min(d, colorDistance(c, e));
      if (d > score) {
        score = d;
        best = c;
      }
    }
  }
  return best;
}

export function addCountry() {
  const seed = useEditor.getState().seed;
  if (!seed) return;
  const tag = uniqueTag(seed);
  const country: Country = {
    tag,
    name: "New Nation",
    color: contrastingColor(seed.countries.map((c) => c.color)),
    government: "Republic",
    leader: "Unknown",
    gdp: 10,
    population: 5,
    stability: 60,
    military: 20,
    warExhaustion: 0,
    agenda: { persona: "", goals: [] },
    alive: true,
  };
  useEditor.setState({ seed: { ...seed, countries: [...seed.countries, country] }, selected: seed.countries.length, tool: "paint", dirty: true });
  pushStyle();
}

/**
 * Remove a country. Its regions go to `heir` (an index into the current list) or become
 * unowned (-1). Indices above it shift down, so the paint history is cleared.
 */
export function deleteCountry(idx: number, heir: number) {
  const seed = useEditor.getState().seed;
  if (!seed || !seed.countries[idx]) return;
  const tag = seed.countries[idx].tag;
  const shift = (o: number) => (o === idx ? (heir < 0 ? -1 : heir > idx ? heir - 1 : heir) : o > idx ? o - 1 : o);
  const owners = seed.owners.map(shift);
  const controllers = seed.controllers.map(shift);
  let next: ScenarioSeed = { ...seed, owners, controllers, countries: seed.countries.filter((_, i) => i !== idx) };
  next = scrubTag(next, tag);
  useEditor.setState((st) => ({
    seed: next,
    selected: heir >= 0 ? (heir > idx ? heir - 1 : heir) : -1,
    undo: [],
    redo: [],
    rev: st.rev + 1,
    dirty: true,
  }));
  redrawAll();
}

/** Drop every reference to a removed tag (treaties, wars, organisations, …). */
export function scrubTag(seed: ScenarioSeed, tag: string): ScenarioSeed {
  const keep = (list: string[]) => list.filter((t) => t !== tag);
  return {
    ...seed,
    relations: Object.fromEntries(Object.entries(seed.relations).filter(([k]) => !k.split("|").includes(tag))),
    treaties: seed.treaties.map((t) => ({ ...t, members: keep(t.members) })).filter((t) => t.members.length >= 2),
    wars: seed.wars
      .map((w) => ({ ...w, attackers: keep(w.attackers), defenders: keep(w.defenders), calls: w.calls?.filter((c) => c.tag !== tag) }))
      .filter((w) => w.attackers.length > 0 && w.defenders.length > 0),
    sanctions: seed.sanctions.filter((s) => s.target !== tag).map((s) => ({ ...s, by: keep(s.by) })).filter((s) => s.by.length > 0),
    organizations: seed.organizations
      .map((o) => ({
        ...o,
        members: keep(o.members),
        observers: keep(o.observers),
        suspended: keep(o.suspended),
        candidates: o.candidates.filter((c) => c.tag !== tag),
        bodies: o.bodies.map((b) => ({ ...b, seats: keep(b.seats), veto: b.veto ? keep(b.veto) : b.veto })),
      }))
      .filter((o) => o.members.length > 0),
    calendar: seed.calendar.map((c) => ({ ...c, countries: keep(c.countries) })),
    formables: seed.formables.map((f) => ({ ...f, countries: keep(f.countries) })).filter((f) => f.countries.length > 0),
  };
}

/** Rename a tag everywhere it is referenced. */
function renameTag(seed: ScenarioSeed, from: string, to: string): ScenarioSeed {
  const r = (t: string) => (t === from ? to : t);
  const rl = (list: string[]) => list.map(r);
  return {
    ...seed,
    relations: Object.fromEntries(
      Object.entries(seed.relations).map(([k, v]) => {
        const [a, b] = k.split("|").map(r);
        return [a < b ? `${a}|${b}` : `${b}|${a}`, v];
      }),
    ),
    treaties: seed.treaties.map((t) => ({ ...t, members: rl(t.members) })),
    wars: seed.wars.map((w) => ({ ...w, attackers: rl(w.attackers), defenders: rl(w.defenders), calls: w.calls?.map((c) => ({ ...c, tag: r(c.tag) })) })),
    sanctions: seed.sanctions.map((s) => ({ ...s, target: r(s.target), by: rl(s.by) })),
    organizations: seed.organizations.map((o) => ({
      ...o,
      members: rl(o.members),
      observers: rl(o.observers),
      suspended: rl(o.suspended),
      candidates: o.candidates.map((c) => ({ ...c, tag: r(c.tag) })),
      bodies: o.bodies.map((b) => ({ ...b, seats: rl(b.seats), veto: b.veto ? rl(b.veto) : b.veto })),
    })),
    calendar: seed.calendar.map((c) => ({ ...c, countries: rl(c.countries) })),
    formables: seed.formables.map((f) => ({ ...f, countries: rl(f.countries) })),
  };
}

export const removeTreaty = (id: string) => patchSeed((s) => ({ ...s, treaties: s.treaties.filter((t) => t.id !== id) }));
export const removeWar = (id: string) => patchSeed((s) => ({ ...s, wars: s.wars.filter((w) => w.id !== id) }));
export const removeOrg = (id: string) => patchSeed((s) => ({ ...s, organizations: s.organizations.filter((o) => o.id !== id) }));
export const removeSanction = (id: string) => patchSeed((s) => ({ ...s, sanctions: s.sanctions.filter((x) => x.id !== id) }));

export function addTreaty(type: TreatyType, members: string[], name?: string) {
  patchSeed((s) => {
    let n = s.treaties.length + 1;
    while (s.treaties.some((t) => t.id === `t_ed_${n}`)) n++;
    return { ...s, treaties: [...s.treaties, { id: `t_ed_${n}`, type, members, name: name?.trim() || undefined, since: s.date }] };
  });
}

export function addWar(name: string, attackers: string[], defenders: string[], goal: string) {
  patchSeed((s) => {
    let n = s.wars.length + 1;
    while (s.wars.some((w) => w.id === `w_ed_${n}`)) n++;
    return { ...s, wars: [...s.wars, { id: `w_ed_${n}`, name: name.trim() || "War", attackers, defenders, goal: goal.trim() || "Unspecified", since: s.date }] };
  });
}

// --- Output --------------------------------------------------------------------------------------

/** The request body for POST /api/scenarios. */
export function buildRequest(seed: ScenarioSeed): CustomScenarioRequest {
  const { id: _id, author: _author, ...rest } = seed;
  return {
    ...rest,
    name: seed.name.trim(),
    description: seed.description?.trim() ?? "",
    owners: Array.from(seed.owners),
    controllers: Array.from(seed.controllers),
  };
}

/** Problems the server would reject anyway (errors), and things worth a second look (warnings). */
export function localIssues(seed: ScenarioSeed): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!seed.name.trim()) errors.push("The scenario needs a name.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(seed.date)) errors.push("The start date must be a full date.");
  const tags = new Set<string>();
  seed.countries.forEach((c) => {
    if (!TAG_RE.test(c.tag)) errors.push(`“${c.name}” has an invalid tag (${c.tag || "empty"}).`);
    if (tags.has(c.tag)) errors.push(`Tag ${c.tag} is used twice.`);
    tags.add(c.tag);
    if (!c.name.trim()) errors.push(`Country ${c.tag} has no name.`);
  });
  const counts = new Array(seed.countries.length).fill(0);
  let unowned = 0;
  for (let id = 1; id < seed.owners.length; id++) {
    if (seed.owners[id] >= 0) counts[seed.owners[id]]++;
    else unowned++;
  }
  const empty = seed.countries.filter((c, i) => counts[i] === 0 && c.alive !== false).map((c) => c.name);
  if (empty.length) warnings.push(`${empty.length} nation${empty.length === 1 ? " has" : "s have"} no regions: ${empty.slice(0, 4).join(", ")}${empty.length > 4 ? "…" : ""}.`);
  if (unowned) warnings.push(`${unowned} region${unowned === 1 ? " is" : "s are"} unowned.`);
  if (!seed.description?.trim()) warnings.push("A short description helps players pick your scenario.");
  return { errors, warnings };
}

export function exportJson(seed: ScenarioSeed, savedId: string | null) {
  const out = { ...seed, id: savedId ?? `custom-${slug(seed.name) || "draft"}` };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(seed.name) || "scenario"}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").slice(0, 48);
