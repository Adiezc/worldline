import { create } from "zustand";
import type { EraTheme, MapMeta, ScenarioStart } from "@worldline/shared";

/** Map-level UI state: assets, hover and the selected province. */
export interface MapState {
  status: "loading" | "ready" | "error";
  error?: string;
  /** Province metadata from /map/provinces.json (index = id - 1). */
  meta?: MapMeta;
  /** The menu backdrop: the static modern start, or the scenario picked in the menu. */
  scenario?: ScenarioStart;
  /** Era theme when no game view decides it (menu backdrop, editor). */
  theme: EraTheme;
  /** The scenario editor owns the map: MapSync stands aside. */
  editing: boolean;
  hoverId: number;
  pointer: { x: number; y: number };
  selectedId: number;
  setHover: (id: number) => void;
  setSelected: (id: number) => void;
}

export const useMap = create<MapState>((set) => ({
  status: "loading",
  theme: "modern",
  editing: false,
  hoverId: 0,
  pointer: { x: 0, y: 0 },
  selectedId: 0,
  setHover: (hoverId) => set({ hoverId }),
  setSelected: (selectedId) => set({ selectedId }),
}));

/** Region name for a province id, or a fallback. */
export function provinceName(id: number) {
  return useMap.getState().meta?.provinces[id - 1]?.name ?? `Region ${id}`;
}
