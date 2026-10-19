// Era-agnostic base map data produced by tools/mapgen. Scenarios layer ownership on top.

export interface ProvinceMeta {
  /** 1-based; 0 is reserved for ocean in the province bitmap. */
  id: number;
  name: string;
  /** Natural Earth admin-0 code of the source features (e.g. "FRA"). */
  adm0: string;
  /** Constituent unit, e.g. "Scotland"; equals adm0 name when the country has none. */
  unit: string;
  /** Default modern owner tag (dependencies resolved to their sovereign). */
  defaultOwner: string;
  /** Centroid in map pixels. */
  cx: number;
  cy: number;
  areaKm2: number;
  pixels: number;
  coastal: boolean;
  neighbors: number[];
}

export interface MapMeta {
  width: number;
  height: number;
  provinces: ProvinceMeta[];
}

/**
 * Shared border arcs. `a`/`b` are province ids on either side (b = 0 for coastlines).
 * `pts` is a flat [x0, y0, x1, y1, ...] array in map pixels × BORDER_QUANT.
 */
export interface BorderArc {
  a: number;
  b: number;
  pts: number[];
}

export const BORDER_QUANT = 4;

export interface BordersData {
  arcs: BorderArc[];
}

export interface ScenarioCountry {
  tag: string;
  name: string;
  /** "#rrggbb" */
  color: string;
}

export interface ScenarioStart {
  id: string;
  name: string;
  date: string;
  countries: ScenarioCountry[];
  /** Index by province id → country index in `countries` (-1 = unowned). */
  owners: number[];
  /** Same layout as owners; differs from owner where a region is occupied. */
  controllers: number[];
}
