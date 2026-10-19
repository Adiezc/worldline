// Imperative handle onto the live map, published by MapView once the renderer is ready.

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
}

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
