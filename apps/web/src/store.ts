import { create } from "zustand";
import type { MapMeta, ScenarioStart } from "@worldline/shared";

export interface MapState {
  status: "loading" | "ready" | "error";
  error?: string;
  meta?: MapMeta;
  scenario?: ScenarioStart;
  hoverId: number;
  pointer: { x: number; y: number };
  selectedId: number;
  setHover: (id: number) => void;
  setSelected: (id: number) => void;
}

export const useMap = create<MapState>((set) => ({
  status: "loading",
  hoverId: 0,
  pointer: { x: 0, y: 0 },
  selectedId: 0,
  setHover: (hoverId) => set({ hoverId }),
  setSelected: (selectedId) => set({ selectedId }),
}));
