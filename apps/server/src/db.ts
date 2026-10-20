// Persistence. SQLite for local development (Bun built-in): games and per-turn snapshots, user
// accounts with sessions, the user↔game links behind cross-device resume, and custom scenarios.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GameState, Player } from "@worldline/shared";

const DB_PATH = process.env.WORLDLINE_DB ?? join(import.meta.dir, "..", "data", "worldline.sqlite");

let db: Database | null = null;

function open() {
  if (db) return db;
  if (DB_PATH !== ":memory:") mkdirSync(dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      game_id TEXT NOT NULL,
      turn INTEGER NOT NULL,
      date TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, turn)
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_games (
      user_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      last_played INTEGER NOT NULL,
      PRIMARY KEY (user_id, game_id)
    );
    CREATE TABLE IF NOT EXISTS scenarios (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      name TEXT NOT NULL,
      seed TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

// ---- games ----

export function saveGame(state: GameState) {
  const now = Date.now();
  open()
    .query(`INSERT INTO games (id, name, scenario_id, state, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)
            ON CONFLICT(id) DO UPDATE SET name = ?2, state = ?4, updated_at = ?5`)
    .run(state.id, state.name, state.scenarioId, JSON.stringify(state), now);
}

export function loadGame(id: string): GameState | null {
  const row = open().query("SELECT state FROM games WHERE id = ?1").get(id) as { state: string } | null;
  return row ? (JSON.parse(row.state) as GameState) : null;
}

/** Summary fields of a stored game without parsing the whole state. */
export function gameSummaryRow(id: string) {
  const row = open().query(`SELECT id, name, json_extract(state, '$.date') AS date, json_extract(state, '$.turn') AS turn,
      json_extract(state, '$.players') AS players FROM games WHERE id = ?1`).get(id) as
    { id: string; name: string; date: string; turn: number; players: string } | null;
  return row ? { id: row.id, name: row.name, date: row.date, turn: row.turn, players: JSON.parse(row.players ?? "[]") as Player[] } : null;
}

// ---- snapshots ----

/** Per-turn snapshot of the state at the start of resolving turn `state.turn`; used by rewind and intervene. */
export function saveSnapshot(state: GameState) {
  open()
    .query("INSERT OR REPLACE INTO snapshots (game_id, turn, date, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .run(state.id, state.turn, state.date, JSON.stringify(state), Date.now());
}

export function listSnapshots(id: string) {
  return open().query("SELECT turn, date FROM snapshots WHERE game_id = ?1 ORDER BY turn").all(id) as { turn: number; date: string }[];
}

export function loadSnapshot(id: string, turn: number): GameState | null {
  const row = open().query("SELECT state FROM snapshots WHERE game_id = ?1 AND turn = ?2").get(id, turn) as { state: string } | null;
  return row ? (JSON.parse(row.state) as GameState) : null;
}

/** A game's snapshots as stored JSON, newest first, one row at a time (export walks them under a size budget). */
export function* snapshotJsonNewestFirst(id: string): Generator<string> {
  for (const row of open().query("SELECT state FROM snapshots WHERE game_id = ?1 ORDER BY turn DESC").iterate(id) as Iterable<{ state: string }>) {
    yield row.state;
  }
}

/** Length of the event log in a snapshot (null when there is none), without parsing the state. */
export function snapshotEventCount(id: string, turn: number): number | null {
  const row = open().query("SELECT json_array_length(state, '$.events') AS n FROM snapshots WHERE game_id = ?1 AND turn = ?2")
    .get(id, turn) as { n: number } | null;
  return row ? row.n : null;
}

/** Rewinding branches the timeline: snapshots after the restored turn no longer apply. */
export function deleteSnapshotsAfter(id: string, turn: number) {
  open().query("DELETE FROM snapshots WHERE game_id = ?1 AND turn > ?2").run(id, turn);
}

// ---- users and sessions ----

export interface UserRow {
  id: string;
  username: string;
  pass_hash: string;
}

/** Null when the username is taken (case-insensitively). */
export function createUser(username: string, passHash: string): { id: string; username: string } | null {
  const id = crypto.randomUUID();
  try {
    open().query("INSERT INTO users (id, username, pass_hash, created_at) VALUES (?1, ?2, ?3, ?4)").run(id, username, passHash, Date.now());
  } catch (e) {
    if (/UNIQUE/i.test(String(e))) return null;
    throw e;
  }
  return { id, username };
}

export function findUser(username: string): UserRow | null {
  return open().query("SELECT id, username, pass_hash FROM users WHERE username = ?1").get(username) as UserRow | null;
}

// Sessions are stored by SHA-256 of the token, so a leaked database does not leak live tokens.
const tokenKey = (token: string) => new Bun.CryptoHasher("sha256").update(token).digest("hex");

export function createSession(userId: string) {
  const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  open().query("INSERT INTO sessions (token, user_id, created_at) VALUES (?1, ?2, ?3)").run(tokenKey(token), userId, Date.now());
  return token;
}

export function deleteSession(token: string) {
  open().query("DELETE FROM sessions WHERE token = ?1").run(tokenKey(token));
}

export function userForToken(token: string): { id: string; username: string } | null {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return open().query("SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?1")
    .get(tokenKey(token)) as { id: string; username: string } | null;
}

// ---- user ↔ game links ----

export function linkedPlayer(userId: string, gameId: string): string | null {
  const row = open().query("SELECT player_id FROM user_games WHERE user_id = ?1 AND game_id = ?2").get(userId, gameId) as { player_id: string } | null;
  return row?.player_id ?? null;
}

export function linkUserGame(userId: string, gameId: string, playerId: string) {
  open().query(`INSERT INTO user_games (user_id, game_id, player_id, last_played) VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(user_id, game_id) DO UPDATE SET player_id = ?3, last_played = ?4`)
    .run(userId, gameId, playerId, Date.now());
}

export function userGames(userId: string) {
  return open().query("SELECT game_id, player_id, last_played FROM user_games WHERE user_id = ?1 ORDER BY last_played DESC")
    .all(userId) as { game_id: string; player_id: string; last_played: number }[];
}

// ---- custom scenarios ----

export function saveScenario(id: string, authorId: string, name: string, seed: string) {
  open().query("INSERT INTO scenarios (id, author_id, name, seed, created_at) VALUES (?1, ?2, ?3, ?4, ?5)").run(id, authorId, name, seed, Date.now());
}

export function loadScenario(id: string): string | null {
  const row = open().query("SELECT seed FROM scenarios WHERE id = ?1").get(id) as { seed: string } | null;
  return row?.seed ?? null;
}

/** Listing fields of every custom scenario, extracted in SQL so the seeds are not parsed. */
export function listScenarios() {
  return open().query(`SELECT id, name, json_extract(seed, '$.date') AS date, json_extract(seed, '$.description') AS description,
      json_extract(seed, '$.author') AS author, json_extract(seed, '$.theme') AS theme, json_array_length(seed, '$.countries') AS countries
      FROM scenarios ORDER BY created_at DESC`).all() as
    { id: string; name: string; date: string; description: string | null; author: string | null; theme: string | null; countries: number }[];
}
