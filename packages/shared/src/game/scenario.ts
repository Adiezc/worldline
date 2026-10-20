import type { Country, Organization, Sanction, Treaty, War } from "./state.ts";

export interface CalendarEntry {
  date: string;
  title: string;
  kind: "election" | "referendum" | "summit" | "deadline" | "event";
  countries: string[];
  note?: string;
}

/** A nation that can be proclaimed (Paradox-style): fixed identity and territory. */
export interface Formable {
  id: string;
  name: string;
  concept: string;
  /** Countries whose land (at the scenario start) makes up the territory, for display. */
  countries: string[];
  /** Region ids of the territory; the founder must control all of them. */
  provinces: number[];
  /** Countries that may proclaim it. */
  formers: string[];
  color: string;
  /** Flag reference, usually "hist:<id>" (drawn by the client). */
  flag: string;
  capital?: string;
  /** Form of government the new state adopts, when it should change. */
  government?: string;
}

/** Visual theme of an era; the client maps it to map colours, paper and fonts. */
export type EraTheme = "modern" | "coldwar" | "custom";

/** Everything needed to start a game in a scenario (packages/scenarios/<id>/seed.json). */
export interface ScenarioSeed {
  id: string;
  name: string;
  date: string;
  /** One or two sentences for the scenario picker. */
  description?: string;
  theme?: EraTheme;
  /** Set for player-made scenarios saved from the editor. */
  author?: string;
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
  /** Territorial disputes at the start date (become GameState.claims). */
  disputes?: { claimant: string; provinces: number[]; note: string }[];
}
