import type { Country, Organization, Sanction, Treaty, War } from "./state.ts";

export interface CalendarEntry {
  date: string;
  title: string;
  kind: "election" | "summit" | "deadline" | "event";
  countries: string[];
  note?: string;
}

export interface Formable {
  name: string;
  concept: string;
  countries: string[];
}

/** Everything needed to start a game in a scenario (packages/scenarios/<id>/seed.json). */
export interface ScenarioSeed {
  id: string;
  name: string;
  date: string;
  /** Same order as start.json, so index = owner index in the map arrays. */
  countries: Country[];
  owners: number[];
  controllers: number[];
  relations: Record<string, number>;
  treaties: Treaty[];
  wars: War[];
  sanctions: Sanction[];
  organizations: Organization[];
  calendar: CalendarEntry[];
  /** Snapshot of the world at the start date, given to the AI until memory takes over. */
  worldBrief: string;
  /** Scenario simulation rules (prose the AI re-reads every turn). */
  rules: string;
  formables: Formable[];
}
