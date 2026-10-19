// Era themes swap the map's base look without touching the renderer.
// Modern Day: muted parchment land under translucent political colour, teal-blue seas.
// Cold War: warmer, yellowed paper, deeper ink-blue seas and a faint sepia cast, like a
// period atlas.
import type { EraTheme } from "@worldline/shared";

export interface MapTheme {
  id: EraTheme;
  paper: [number, number, number];
  oceanDeep: [number, number, number];
  politicalMix: number;
  /** 0–1: pull the final colour towards a warm sepia (old print). */
  sepia: number;
  /** Multiplier on the terrain relief shading. */
  relief: number;
  /** Ink used for mountain hatching and fallback labels. */
  ink: [number, number, number];
  labelInk: string;
  labelFont: string;
  /** Darkening applied to label ink (lower = darker), and its alpha. */
  labelShade: number;
  labelAlpha: number;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

const modern: MapTheme = {
  id: "modern",
  paper: rgb("#d8c8a2"),
  oceanDeep: rgb("#2d4b63"),
  politicalMix: 0.78,
  sepia: 0,
  relief: 1,
  ink: rgb("#2a2118"),
  labelInk: "rgba(28, 22, 16, 0.74)",
  labelFont: "Cinzel",
  labelShade: 0.28,
  labelAlpha: 0.86,
};

const coldwar: MapTheme = {
  id: "coldwar",
  paper: rgb("#dcc58f"),
  oceanDeep: rgb("#213a55"),
  politicalMix: 0.7,
  sepia: 0.2,
  relief: 1.12,
  ink: rgb("#33240f"),
  labelInk: "rgba(40, 28, 12, 0.78)",
  labelFont: "Cinzel",
  labelShade: 0.24,
  labelAlpha: 0.84,
};

export const THEMES: Record<EraTheme, MapTheme> = {
  modern,
  coldwar,
  custom: { ...modern, id: "custom" },
};

export const getTheme = (id: EraTheme | undefined | null): MapTheme => THEMES[id ?? "modern"] ?? modern;

/** Default theme (modern). */
export const theme = modern;
