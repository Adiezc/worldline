// Game persistence. SQLite for local development (Bun built-in); the schema is two tables so
// moving to Postgres later is a small change.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GameState } from "@worldline/shared";

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
  `);
  return db;
}

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

/** Per-turn snapshot, kept for rewind and debugging. */
export function saveSnapshot(state: GameState) {
  open()
    .query("INSERT OR REPLACE INTO snapshots (game_id, turn, date, state, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .run(state.id, state.turn, state.date, JSON.stringify(state), Date.now());
}

export function listSnapshots(id: string) {
  return open().query("SELECT turn, date FROM snapshots WHERE game_id = ?1 ORDER BY turn").all(id) as { turn: number; date: string }[];
}
