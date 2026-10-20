// Imperative handle onto the live map, published by MapView once the renderer is ready.
import type { EraTheme } from "@worldline/shared";
import type { FrontCounter, FrontsOverlay } from "./counterLayer.ts";
import type { OperationArrow } from "./operationLayer.ts";
import type { CapitalMark } from "./capitalLayer.ts";

export type { CapitalMark, FrontCounter, FrontsOverlay, OperationArrow };

export type FocusTarget =
  | number // province id
  | number[] // several provinces
  | { country: number }; // every province currently owned by this country index

export interface FocusOptions {
  /** Target zoom; "fit" frames the provinces, "keep" only pans. Default "fit". */
  zoom?: number | "fit" | "keep";
  /** Animation length in ms (default 700). */
  duration?: number;
  /** Clamp the fitted zoom to this range. */
  minZoom?: number;
  maxZoom?: number;
}

export interface MapController {
  setPalette(colors: string[]): void;
  setOwnership(owners: ArrayLike<number>, controllers: ArrayLike<number>): void;
  setProvince(id: number, owner: number, controller?: number): void;
  /** Country display names + base colours for label ink. */
  setLabelStyle(names: string[], colors: string[]): void;
  /** Recompute curved country labels in the worker for this ownership. */
  recomputeLabels(owners: ArrayLike<number>): void;
  focusOn(target: FocusTarget, opts?: FocusOptions): void;
  /** Owner index per province as currently drawn. */
  owners(): ArrayLike<number>;
  /** Controller index per province as currently drawn. */
  controllers(): ArrayLike<number>;
  /** Animated front lines plus troop counters (null hides them). */
  setFronts(fronts: FrontsOverlay | null): void;
  /** Troop counter under a client (viewport) position, if any. */
  pickCounter(clientX: number, clientY: number): FrontCounter | null;
  /** Era look: paper, sea, sepia and label ink. */
  setTheme(theme: EraTheme): void;
  /** Softly highlight every province of this owner index (null = follow the selection). */
  setHighlightOwner(owner: number | null): void;
  /** Gold-hatch these provinces (e.g. regions picked for a peace deal); empty clears. */
  setMarked(ids: ArrayLike<number>): void;
  /** Disputed territories: dashed claim lines (province pairs) and claimant stripes (id → claimant index). */
  setClaims(linePairs: [number, number][] | null, marks: Map<number, number> | null): void;
  /** Capital stars (empty hides them). */
  setCapitals(marks: CapitalMark[]): void;
  /** Battle plans: offensive arrows and hold lines (province pairs along the held border). */
  setOperations(arrows: OperationArrow[], holdPairs: [number, number][] | null): void;
}

/**
 * Editor brush: while set, a left-button drag on the map paints instead of panning
 * (right/middle drag or Space+drag still pan). Ids are 0 over the sea.
 */
export interface PaintHandler {
  start(provinceId: number): void;
  move(provinceId: number): void;
  end(): void;
}

let paintHandler: PaintHandler | null = null;
export const setPaintHandler = (h: PaintHandler | null) => void (paintHandler = h);
export const getPaintHandler = () => paintHandler;

/**
 * Region picker: while set, clicking a province hands it here instead of selecting its country
 * (used to pick the land a peace deal names).
 */
let pickHandler: ((provinceId: number) => void) | null = null;
export const setPickHandler = (h: ((provinceId: number) => void) | null) => void (pickHandler = h);
export const getPickHandler = () => pickHandler;

let current: MapController | null = null;
const readyListeners = new Set<(c: MapController | null) => void>();
const clickListeners = new Set<(provinceId: number) => void>();

export const getMap = () => current;

export function publishMap(c: MapController | null) {
  current = c;
  for (const fn of readyListeners) fn(c);
}

export function onMapReady(fn: (c: MapController | null) => void) {
  readyListeners.add(fn);
  return () => void readyListeners.delete(fn);
}

/** Province clicks (0 = sea / empty). */
export function onMapClick(fn: (provinceId: number) => void) {
  clickListeners.add(fn);
  return () => void clickListeners.delete(fn);
}

export function emitMapClick(id: number) {
  for (const fn of clickListeners) fn(id);
}
