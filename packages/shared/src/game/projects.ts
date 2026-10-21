// Long-running projects: limits shared by the validator, the prompts and the UI, and the derived
// schedule status. Status is computed from the game date so it can never go stale in a save.

import { DIFFICULTY } from "./engine.ts";
import { daysBetween, type GameState, type Project } from "./state.ts";

export const MAX_ACTIVE_PROJECTS = 6;
export const MAX_NEW_PROJECTS_PER_TURN = 2;
export const MAX_MILESTONES = 5;
/** A project counts as finished from here; completing it earlier is refused. */
export const COMPLETE_AT = 80;
/** Setbacks are capped too, so one bad event can't wipe out years of work. */
export const MAX_SETBACK = 25;

/** Most progress (percentage points) one project can make in a turn of `days`. */
export function projectPace(state: GameState, days: number) {
  const months = Math.max(0.25, days / 30);
  return Math.round(Math.min(60, Math.max(8, 12 * months)) * DIFFICULTY[state.settings.difficulty].stat);
}

export type ProjectSchedule = "completed" | "failed" | "abandoned" | "overdue" | "dueSoon" | "onTrack" | "behind";

/**
 * Where an active project stands against its schedule on `date`: overdue past its due date, due
 * soon within 30 days, and behind when its progress trails the share of time already used.
 */
export function projectStatus(p: Project, date: string): ProjectSchedule {
  if (p.status !== "active") return p.status;
  const left = daysBetween(date, p.due);
  if (left < 0) return "overdue";
  if (left <= 30) return "dueSoon";
  const span = Math.max(1, daysBetween(p.started, p.due));
  const elapsed = Math.max(0, daysBetween(p.started, date));
  return p.progress + 15 < (100 * elapsed) / span ? "behind" : "onTrack";
}

export const activeProjects = (state: GameState, tag?: string) =>
  (state.projects ?? []).filter((p) => p.status === "active" && (!tag || p.country === tag));
