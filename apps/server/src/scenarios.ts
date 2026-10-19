// Scenario registry: built-in seeds under packages/scenarios/<id>/seed.json (re-scanned on every
// listing, since new ones can be generated while the server runs) and custom seeds saved from the
// editor into SQLite. Parsed seeds are cached; built-ins are re-read when their file changes.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  relKey,
  type CalendarEntry, type Country, type CustomScenarioRequest, type EraTheme, type Formable, type Organization, type OrgBody,
  type ResolutionType, type Sanction, type ScenarioInfo, type ScenarioSeed, type Treaty, type War,
} from "@worldline/shared";
import { listScenarios, loadScenario, saveScenario } from "./db.ts";

export class ScenarioRegistry {
  private builtins = new Map<string, { mtime: number; seed: ScenarioSeed }>();
  private custom = new Map<string, ScenarioSeed>();

  constructor(private dir: string, private provinceCount: number) {}

  /** Built-ins first (latest start date first, so Modern Day leads), then custom scenarios, newest first. */
  list(): ScenarioInfo[] {
    const out: ScenarioInfo[] = [];
    for (const id of this.builtinIds()) {
      const s = this.builtin(id);
      if (!s) continue;
      out.push({
        id: s.id, name: s.name, date: s.date, description: s.description ?? "", theme: s.theme ?? "modern",
        custom: false, author: s.author, countries: s.countries.length,
      });
    }
    out.sort((a, b) => b.date.localeCompare(a.date));
    for (const r of listScenarios()) {
      out.push({
        id: r.id, name: r.name, date: r.date, description: r.description ?? "", theme: asTheme(r.theme), custom: true,
        author: r.author ?? undefined, countries: r.countries,
      });
    }
    return out;
  }

  get(id: string): ScenarioSeed | null {
    if (id.startsWith("custom-")) {
      let s = this.custom.get(id);
      if (!s) {
        const raw = loadScenario(id);
        if (!raw) return null;
        s = JSON.parse(raw) as ScenarioSeed;
        this.custom.set(id, s);
      }
      return s;
    }
    return /^[a-z0-9][a-z0-9-]*$/.test(id) ? this.builtin(id) : null;
  }

  /** For RoomDeps: throws when the scenario does not exist. */
  seed(id: string): ScenarioSeed {
    const s = this.get(id);
    if (!s) throw new Error(`Unknown scenario "${id}"`);
    return s;
  }

  /** Validate and store an editor scenario. Returns the new id, or throws ScenarioError. */
  create(body: unknown, author: { id: string; username: string }): string {
    const seed = validateScenario(body, this.provinceCount);
    seed.id = `custom-${randomId(8)}`;
    seed.author = author.username;
    saveScenario(seed.id, author.id, seed.name, JSON.stringify(seed));
    this.custom.set(seed.id, seed);
    return seed.id;
  }

  private builtinIds() {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && existsSync(join(this.dir, d.name, "seed.json")))
      .map((d) => d.name)
      .sort();
  }

  private builtin(id: string): ScenarioSeed | null {
    const path = join(this.dir, id, "seed.json");
    if (!existsSync(path)) return null;
    const mtime = statSync(path).mtimeMs;
    const hit = this.builtins.get(id);
    if (hit && hit.mtime === mtime) return hit.seed;
    try {
      const seed = JSON.parse(readFileSync(path, "utf8")) as ScenarioSeed;
      // The directory name is the id the server addresses it by.
      seed.id = id;
      this.builtins.set(id, { mtime, seed });
      return seed;
    } catch (err) {
      // A seed being written by the generator may be half-finished; keep the last good copy.
      console.warn(`[scenarios] ${id}/seed.json unreadable: ${err instanceof Error ? err.message : err}`);
      return hit?.seed ?? null;
    }
  }
}

export class ScenarioError extends Error {}

// ---------------------------------------------------------------------------------------------
// Validation of editor scenarios. Structural problems (bad tags, colours, map indices) are
// rejected with a message; numbers are clamped and dangling references are dropped.

const TAG = /^[A-Z][A-Z0-9]{1,7}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const TREATY_TYPES = new Set(["alliance", "defensive", "trade", "nonaggression", "vassal", "customs_union"]);
const ORG_KINDS = new Set(["global", "regional", "military", "economic", "forum"]);
const RULES = new Set(["consensus", "simpleMajority", "twoThirds", "qualifiedMajority", "vetoMajority"]);
const RES_TYPES = new Set<ResolutionType>([
  "sanction", "condemn", "peacekeeping", "admitMember", "suspendMember", "expelMember", "tradePolicy", "authorizeForce", "custom",
]);
const CAL_KINDS = new Set(["election", "summit", "deadline", "event"]);
const STATS = { gdp: [0.01, 1e6, 10], population: [0.001, 5000, 5], stability: [0, 100, 50], military: [0, 100, 20], warExhaustion: [0, 100, 0] } as const;

const fail = (msg: string): never => {
  throw new ScenarioError(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

function validDate(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

export function validateScenario(body: unknown, provinceCount: number): ScenarioSeed {
  if (!isObj(body)) fail("Scenario must be a JSON object.");
  const b = body as Partial<CustomScenarioRequest> & Record<string, unknown>;

  const name = str(b.name, 80);
  if (!name) fail("The scenario needs a name.");
  if (!validDate(b.date)) fail("date must be a valid YYYY-MM-DD date.");
  const date = b.date as string;

  // ---- countries ----
  const rawCountries = arr(b.countries);
  if (rawCountries.length < 2) fail("A scenario needs at least two countries.");
  if (rawCountries.length > 400) fail("At most 400 countries.");
  const tags = new Set<string>();
  const countries: Country[] = rawCountries.map((raw, i) => {
    if (!isObj(raw)) fail(`Country #${i + 1} is not an object.`);
    const c = raw as Record<string, unknown>;
    const tag = typeof c.tag === "string" ? c.tag : "";
    if (!TAG.test(tag)) fail(`Country #${i + 1}: tag "${tag}" must be 2–8 capital letters or digits, starting with a letter.`);
    if (tags.has(tag)) fail(`Duplicate country tag ${tag}.`);
    tags.add(tag);
    const cname = str(c.name, 80);
    if (!cname) fail(`Country ${tag} needs a name.`);
    if (typeof c.color !== "string" || !COLOR.test(c.color)) fail(`Country ${tag}: colour must look like #1a2b3c.`);
    const agenda = isObj(c.agenda) ? c.agenda : {};
    const out: Country = {
      tag, name: cname, color: (c.color as string).toLowerCase(),
      government: str(c.government, 80, "Republic") || "Republic",
      leader: str(c.leader, 120, "Head of government") || "Head of government",
      gdp: num(c.gdp, ...STATS.gdp), population: num(c.population, ...STATS.population),
      stability: num(c.stability, ...STATS.stability), military: num(c.military, ...STATS.military),
      warExhaustion: num(c.warExhaustion, ...STATS.warExhaustion),
      agenda: {
        persona: str(agenda.persona, 600) || `${cname} pursues security and prosperity.`,
        goals: arr(agenda.goals).map((g) => str(g, 200)).filter(Boolean).slice(0, 4),
      },
      alive: true,
    };
    if (!out.agenda.goals.length) out.agenda.goals = ["Grow the economy", "Keep the country secure"];
    if (c.nuclear === true) out.nuclear = true;
    return out;
  });
  const valid = (t: unknown): t is string => typeof t === "string" && tags.has(t);
  const validList = (v: unknown) => [...new Set(arr(v).filter(valid))];

  // ---- map ----
  const mapArray = (v: unknown, label: string) => {
    if (!Array.isArray(v) || v.length !== provinceCount + 1) fail(`${label} must have ${provinceCount + 1} entries (index 0 unused).`);
    return (v as unknown[]).map((x, id) => {
      if (id === 0) return -1;
      if (typeof x !== "number" || !Number.isInteger(x) || x < -1 || x >= countries.length) {
        fail(`${label}[${id}] = ${JSON.stringify(x)} is not a country index (-1..${countries.length - 1}).`);
      }
      return x as number;
    });
  };
  const owners = mapArray(b.owners, "owners");
  const controllers = b.controllers == null ? [...owners] : mapArray(b.controllers, "controllers");
  // Unowned land cannot be controlled.
  for (let p = 1; p < owners.length; p++) {
    if (owners[p] < 0) controllers[p] = -1;
    else if (controllers[p] < 0) controllers[p] = owners[p];
  }
  const held = new Set(owners.filter((o) => o >= 0));
  countries.forEach((c, i) => (c.alive = held.has(i)));
  if (countries.filter((c) => c.alive).length < 2) fail("At least two countries must own a region on the map.");
  const alive = (t: unknown): t is string => valid(t) && countries.find((c) => c.tag === t)!.alive;

  // ---- relations ----
  const relations: Record<string, number> = {};
  if (isObj(b.relations)) {
    for (const [k, v] of Object.entries(b.relations)) {
      const [x, y] = k.split("|");
      if (!valid(x) || !valid(y) || x === y) continue;
      const n = num(v, -100, 100, 0);
      if (n) relations[relKey(x, y)] = Math.round(n);
    }
  }

  // ---- treaties, wars, sanctions ----
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;
  const treaties: Treaty[] = arr(b.treaties).filter(isObj).flatMap((t) => {
    const members = validList(t.members);
    if (members.length < 2 || !TREATY_TYPES.has(String(t.type))) return [];
    return [{
      id: str(t.id, 40) || id("t"), type: t.type as Treaty["type"], members,
      name: str(t.name, 80) || undefined, since: validDate(t.since) ? (t.since as string) : date,
    }];
  });
  const wars: War[] = arr(b.wars).filter(isObj).flatMap((w) => {
    const attackers = validList(w.attackers).filter(alive);
    const defenders = validList(w.defenders).filter((t) => alive(t) && !attackers.includes(t));
    if (!attackers.length || !defenders.length) return [];
    return [{
      id: str(w.id, 40) || id("war"), name: str(w.name, 120) || "War", attackers, defenders,
      goal: str(w.goal, 400), since: validDate(w.since) ? (w.since as string) : date,
    }];
  });
  const sanctions: Sanction[] = arr(b.sanctions).filter(isObj).flatMap((s) => {
    const by = validList(s.by).filter((t) => t !== s.target);
    if (!valid(s.target) || !by.length) return [];
    return [{ id: str(s.id, 40) || id("s"), target: s.target, by, source: str(s.source, 120) || "Sanctions", since: validDate(s.since) ? (s.since as string) : date }];
  });

  // ---- organisations ----
  const organizations: Organization[] = arr(b.organizations).filter(isObj).flatMap((o) => {
    const members = validList(o.members);
    const abbrev = str(o.abbrev, 16);
    if (!members.length || !abbrev) return [];
    const bodies: OrgBody[] = arr(o.bodies).filter(isObj).flatMap((bd) => {
      if (!RULES.has(String(bd.rule))) return [];
      const seats = validList(bd.seats).filter((t) => members.includes(t));
      const veto = validList(bd.veto).filter((t) => (seats.length ? seats : members).includes(t));
      const handles = arr(bd.handles).filter((h): h is ResolutionType => RES_TYPES.has(h as ResolutionType));
      return [{
        id: str(bd.id, 40) || id("body"), name: str(bd.name, 80) || "Council", seats, rule: bd.rule as OrgBody["rule"],
        ...(veto.length ? { veto } : {}), ...(handles.length ? { handles } : {}),
      }];
    });
    if (!bodies.length) bodies.push({ id: id("body"), name: "Council", seats: [], rule: "consensus" });
    const effects = isObj(o.effects) ? o.effects : {};
    return [{
      id: str(o.id, 40) || id("org"), abbrev, name: str(o.name, 120) || abbrev,
      kind: (ORG_KINDS.has(String(o.kind)) ? o.kind : "regional") as Organization["kind"],
      members, observers: validList(o.observers).filter((t) => !members.includes(t)),
      candidates: arr(o.candidates).filter(isObj).filter((c) => valid(c.tag) && !members.includes(c.tag as string))
        .map((c) => ({ tag: c.tag as string, since: validDate(c.since) ? (c.since as string) : date, ...(c.note ? { note: str(c.note, 200) } : {}) })),
      suspended: validList(o.suspended).filter((t) => members.includes(t)),
      bodies,
      powers: arr(o.powers).filter((p): p is ResolutionType => RES_TYPES.has(p as ResolutionType)),
      effects: { tradeBloc: effects.tradeBloc === true || undefined, mutualDefense: effects.mutualDefense === true || undefined, forum: effects.forum === true || undefined },
      cohesion: num(o.cohesion, 0, 100, 70),
      ...(validDate(o.founded) ? { founded: o.founded as string } : {}),
    }];
  });
  // Org ids must be unique: the engine addresses them by id.
  const orgIds = new Set<string>();
  for (const o of organizations) {
    while (orgIds.has(o.id)) o.id = id("org");
    orgIds.add(o.id);
  }

  const calendar: CalendarEntry[] = arr(b.calendar).filter(isObj).flatMap((e) => {
    const title = str(e.title, 160);
    if (!validDate(e.date) || !title) return [];
    return [{
      date: e.date as string, title, kind: (CAL_KINDS.has(String(e.kind)) ? e.kind : "event") as CalendarEntry["kind"],
      countries: validList(e.countries), ...(e.note ? { note: str(e.note, 400) } : {}),
    }];
  }).sort((a, b2) => a.date.localeCompare(b2.date)).slice(0, 300);

  const formables: Formable[] = arr(b.formables).filter(isObj).flatMap((f) => {
    const fname = str(f.name, 80);
    const fc = validList(f.countries);
    return fname && fc.length ? [{ name: fname, concept: str(f.concept, 400), countries: fc }] : [];
  }).slice(0, 50);

  return {
    id: "",
    name,
    date,
    description: str(b.description, 400),
    // Editors may pick an era look; anything unknown falls back to the neutral custom theme.
    theme: asTheme(b.theme),
    countries,
    owners,
    controllers,
    relations,
    treaties,
    wars,
    sanctions,
    organizations,
    calendar,
    worldBrief: str(b.worldBrief, 20000) || `${name}, ${date}.`,
    rules: str(b.rules, 20000),
    formables,
  };
}

function randomId(n: number) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (const x of crypto.getRandomValues(new Uint8Array(n))) out += alphabet[x % alphabet.length];
  return out;
}

function asTheme(v: unknown): EraTheme {
  return v === "modern" || v === "coldwar" ? v : "custom";
}
