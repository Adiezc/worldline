// Era themes swap the map's base look without touching the renderer.
// Modern Day: muted parchment land under translucent political colour, teal-blue seas.

export interface MapTheme {
  paper: [number, number, number];
  oceanDeep: [number, number, number];
  politicalMix: number;
  labelInk: string;
  labelFont: string;
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
];

export const theme: MapTheme = {
  paper: rgb("#d8c8a2"),
  oceanDeep: rgb("#2d4b63"),
  politicalMix: 0.78,
  labelInk: "rgba(28, 22, 16, 0.74)",
  labelFont: "Cinzel",
};
