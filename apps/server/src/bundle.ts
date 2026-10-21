// Saved-game files: a game with every per-turn snapshot, exported by the host and imported as a
// new game. Imports are user-supplied, so everything the server and engine walk (lists, tags, map
// arrays, numbers) is checked; free text such as event bodies and chat messages is taken as is.

import { DEFAULT_SETTINGS, type GameBundle, type GameSettings, type GameState } from "@worldline/shared";
import { sanitizeSettings } from "./rooms.ts";

export const BUNDLE_FORMAT: GameBundle["format"] = "worldline-game/1";
/** Largest file the server imports; export stays under it so every file it writes can come back. */
export const MAX_BUNDLE_BYTES = 60 * 1024 * 1024;
const MAX_SNAPSHOTS = 5000;
const MAX_COUNTRIES = 1000;
const PHASES = new Set(["lobby", "orders", "resolving"]);

export class BundleError extends Error {}

/**
 * The file for a game. Player ids are swapped for aliases and seat secrets dropped; pending orders and
 * votes are dropped (an import clears them anyway). Snapshots come newest first, one stored row at a
 * time; when the file would outgrow the import limit the oldest are left out (`dropped`), so long
 * games lose early rewind points rather than becoming unimportable.
 */
export function exportBundle(game: GameState, snapshotsNewestFirst: Iterable<string>, limit = MAX_BUNDLE_BYTES) {
  const aliases = new Map<string, string>();
  const alias = (id: string) => {
    if (!aliases.has(id)) aliases.set(id, `player${aliases.size + 1}`);
  };
  game.players.forEach((p) => alias(p.id));
  // Ids are UUIDs, so a plain replace cannot hit anything else (chat messages also carry them).
  const scrub = (text: string) => {
    for (const [id, a] of aliases) text = text.split(id).join(a);
    return text;
  };

  const head = scrub(JSON.stringify({
    format: BUNDLE_FORMAT,
    exportedAt: new Date().toISOString(),
    // Seat secrets resume a seat in the original game, so they never leave the server.
    game: { ...game, players: game.players.map(({ secret: _, ...p }) => ({ ...p, connected: false, ready: false })), orders: {}, jumpVotes: {}, turnDeadline: undefined },
  }));
  let size = Buffer.byteLength(head) + 32;
  if (size > limit) throw new BundleError(`This game is too large to export (${Math.ceil(size / 1024 / 1024)} MB; ${limit / 1024 / 1024} MB max).`);

  const kept: string[] = [];
  let dropped = 0;
  for (const raw of snapshotsNewestFirst) {
    if (dropped) { dropped++; continue; }
    const s = JSON.parse(raw) as GameState;
    s.players.forEach((p) => alias(p.id));
    const text = scrub(JSON.stringify({ ...s, players: [], orders: {}, jumpVotes: {}, turnDeadline: undefined }));
    const bytes = Buffer.byteLength(text) + 1;
    if (size + bytes > limit) { dropped = 1; continue; }
    size += bytes;
    kept.push(text);
  }
  return { text: `${head.slice(0, -1)},"snapshots":[${kept.reverse().join(",")}]}`, dropped };
}

export function exportFilename(game: GameState) {
  const slug = game.name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `worldline-${slug || "game"}-turn${game.turn}.json`;
}

/** Validate an uploaded bundle and prepare it to be stored as a new game: no players (the first to
 * join hosts), back in the lobby so everyone can pick a country, no pending orders. Throws BundleError. */
export function parseBundle(body: unknown, opts: { regions: number; hasScenario(id: string): boolean }) {
  const b = obj(body, "The file");
  if (b.format !== BUNDLE_FORMAT) fail(`Not a Worldline saved game (format must be "${BUNDLE_FORMAT}").`);
  const game = checkState(b.game, "game", opts.regions);
  if (!opts.hasScenario(game.scenarioId)) fail(`This game uses the scenario "${game.scenarioId}", which this server does not have.`);
  const raw = list(b.snapshots, "snapshots", MAX_SNAPSHOTS);
  const snapshots = raw.map((s, i) => checkState(s, `snapshots[${i}]`, opts.regions));
  snapshots.forEach((s, i) => {
    if (s.scenarioId !== game.scenarioId) fail(`snapshots[${i}] belongs to another scenario.`);
    if (s.turn > game.turn) fail(`snapshots[${i}] is from turn ${s.turn}, after the game's turn ${game.turn}.`);
    if (i > 0 && s.turn <= snapshots[i - 1].turn) fail("snapshots must be in turn order, one per turn.");
  });

  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : game.name.trim();
  game.name = name.slice(0, 60) || "Imported game";
  game.settings = sanitizeSettings({ ...DEFAULT_SETTINGS, ...(game.settings as Partial<GameSettings>) });
  game.players = [];
  game.phase = "lobby";
  for (const s of [game, ...snapshots]) {
    s.orders = {};
    s.jumpVotes = {};
    delete s.turnDeadline;
  }
  for (const s of snapshots) s.players = [];
  return { game, snapshots };
}

// ---------------------------------------------------------------------------------------------

const fail = (msg: string): never => {
  throw new BundleError(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function obj(v: unknown, at: string) {
  if (!isObj(v)) fail(`${at} must be an object.`);
  return v as Record<string, unknown>;
}
function list(v: unknown, at: string, max = Infinity) {
  if (!Array.isArray(v)) fail(`${at} must be an array.`);
  if ((v as unknown[]).length > max) fail(`${at} has too many entries (${max} max).`);
  return v as unknown[];
}
const objects = (v: unknown, at: string) => list(v, at).map((x, i) => obj(x, `${at}[${i}]`));
function string(v: unknown, at: string) {
  if (typeof v !== "string") fail(`${at} must be a string.`);
  return v as string;
}
const strings = (v: unknown, at: string) => list(v, at).forEach((x, i) => string(x, `${at}[${i}]`));
function number(v: unknown, at: string) {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(`${at} must be a number.`);
  return v as number;
}
function integer(v: unknown, at: string, min: number) {
  if (!Number.isInteger(v) || (v as number) < min) fail(`${at} must be a whole number ≥ ${min}.`);
  return v as number;
}

function validDate(v: unknown) {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(v + "T00:00:00Z");
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === v;
}

/** Structure of one GameState; returns it typed (the object itself, not a copy). */
function checkState(v: unknown, at: string, regions: number): GameState {
  const s = obj(v, at);
  for (const k of ["id", "scenarioId", "name"]) string(s[k], `${at}.${k}`);
  if (!validDate(s.date)) fail(`${at}.date must be a valid YYYY-MM-DD date.`);
  integer(s.turn, `${at}.turn`, 1);
  if (!PHASES.has(s.phase as string)) fail(`${at}.phase is not a game phase.`);
  obj(s.settings, `${at}.settings`);

  const countries = objects(s.countries, `${at}.countries`);
  if (!countries.length) fail(`${at}.countries is empty.`);
  if (countries.length > MAX_COUNTRIES) fail(`${at}.countries has too many entries (${MAX_COUNTRIES} max).`);
  const tags = new Set<string>();
  countries.forEach((c, i) => {
    const here = `${at}.countries[${i}]`;
    const tag = string(c.tag, `${here}.tag`);
    if (!tag || tag.length > 16 || tags.has(tag)) fail(`${here}.tag must be a unique, short tag.`);
    tags.add(tag);
    for (const k of ["name", "color", "government", "leader"]) string(c[k], `${here}.${k}`);
    for (const k of ["gdp", "population", "stability", "military", "warExhaustion"]) number(c[k], `${here}.${k}`);
    if (typeof c.alive !== "boolean") fail(`${here}.alive must be true or false.`);
    const agenda = obj(c.agenda, `${here}.agenda`);
    string(agenda.persona, `${here}.agenda.persona`);
    strings(agenda.goals, `${here}.agenda.goals`);
    if (c.capital != null) {
      const cap = obj(c.capital, `${here}.capital`);
      string(cap.name, `${here}.capital.name`);
      number(cap.x, `${here}.capital.x`);
      number(cap.y, `${here}.capital.y`);
      integer(cap.province, `${here}.capital.province`, 0);
    }
  });

  // Indexed by region id (1..regions); index 0 is unused.
  for (const k of ["owners", "controllers"]) {
    const a = list(s[k], `${at}.${k}`);
    if (a.length !== regions + 1) fail(`${at}.${k} must have ${regions + 1} entries for this map (index 0 unused), not ${a.length}.`);
    a.forEach((x, i) => {
      if (!Number.isInteger(x) || (x as number) < -1 || (x as number) >= countries.length) fail(`${at}.${k}[${i}] is not a country index.`);
    });
  }

  for (const [k, x] of Object.entries(obj(s.relations, `${at}.relations`))) number(x, `${at}.relations.${k}`);
  objects(s.treaties, `${at}.treaties`).forEach((t, i) => strings(t.members, `${at}.treaties[${i}].members`));
  objects(s.wars, `${at}.wars`).forEach((w, i) => {
    strings(w.attackers, `${at}.wars[${i}].attackers`);
    strings(w.defenders, `${at}.wars[${i}].defenders`);
  });
  objects(s.sanctions, `${at}.sanctions`).forEach((x, i) => strings(x.by, `${at}.sanctions[${i}].by`));
  objects(s.organizations, `${at}.organizations`).forEach((o, i) => {
    for (const k of ["members", "observers", "suspended"]) strings(o[k], `${at}.organizations[${i}].${k}`);
    objects(o.bodies, `${at}.organizations[${i}].bodies`);
  });
  objects(s.resolutions, `${at}.resolutions`);
  objects(s.events, `${at}.events`).forEach((e, i) => {
    const here = `${at}.events[${i}]`;
    string(e.id, `${here}.id`);
    integer(e.turn, `${here}.turn`, 0);
    strings(e.countries, `${here}.countries`);
    list(e.effects, `${here}.effects`);
  });
  objects(s.memory, `${at}.memory`);
  objects(s.chats, `${at}.chats`).forEach((c, i) => {
    strings(c.members, `${at}.chats[${i}].members`);
    objects(c.messages, `${at}.chats[${i}].messages`);
  });
  if (s.formed != null) strings(s.formed, `${at}.formed`);
  if (s.claims != null) objects(s.claims, `${at}.claims`).forEach((c, i) => list(c.provinces, `${at}.claims[${i}].provinces`));
  if (s.nuclearStrikes != null) objects(s.nuclearStrikes, `${at}.nuclearStrikes`).forEach((x, i) => {
    const here = `${at}.nuclearStrikes[${i}]`;
    for (const k of ["by", "target"]) string(x[k], `${here}.${k}`);
    if (!validDate(x.date)) fail(`${here}.date must be a valid YYYY-MM-DD date.`);
    if (x.scale !== "tactical" && x.scale !== "strategic") fail(`${here}.scale must be "tactical" or "strategic".`);
    integer(x.province, `${here}.province`, 1);
  });
  if (s.successions != null) objects(s.successions, `${at}.successions`).forEach((x, i) => string(x.country, `${at}.successions[${i}].country`));
  if (s.projects != null) objects(s.projects, `${at}.projects`).forEach((p, i) => {
    const here = `${at}.projects[${i}]`;
    for (const k of ["id", "country", "name", "status", "started", "due"]) string(p[k], `${here}.${k}`);
    number(p.progress, `${here}.progress`);
    objects(p.milestones, `${here}.milestones`);
  });
  list(s.players, `${at}.players`);
  obj(s.orders, `${at}.orders`);
  obj(s.jumpVotes, `${at}.jumpVotes`);
  objects(s.lastVerdicts, `${at}.lastVerdicts`);
  if (s.verdictLog != null) objects(s.verdictLog, `${at}.verdictLog`);
  obj(s.usage, `${at}.usage`);
  number(s.rotation, `${at}.rotation`);
  integer(s.seq, `${at}.seq`, 0);
  return s as unknown as GameState;
}
