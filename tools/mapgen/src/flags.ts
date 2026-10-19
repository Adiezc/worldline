// Flag references for scenario seeds (Country.flag). Real flags come from the client's flag-icons
// package ("iso:xx"); tags map to ISO 3166-1 alpha-2 through the cached Natural Earth admin-0 data.

import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
const NE = join(import.meta.dir, "..", "data", "raw", "ne_10m_admin_0_countries.geojson");
const FLAG_ICONS = join(ROOT, "apps", "web", "node_modules", "flag-icons", "flags", "4x3");

interface NeProps { ADM0_A3: string; ISO_A2: string; ISO_A2_EH: string }

let iso2: Map<string, string> | null = null;
let available: Set<string> | null = null;

/** Natural Earth adm0_a3 → lowercase ISO alpha-2 (ISO_A2_EH first: it fills France, Norway, Kosovo, Taiwan…). */
async function isoTable(): Promise<Map<string, string>> {
  if (iso2) return iso2;
  const gj = (await Bun.file(NE).json()) as { features: { properties: NeProps }[] };
  iso2 = new Map();
  for (const { properties: p } of gj.features) {
    const code = [p.ISO_A2_EH, p.ISO_A2].find((c) => /^[A-Z]{2}$/.test(c ?? ""));
    if (code) iso2.set(p.ADM0_A3, code.toLowerCase());
  }
  return iso2;
}

/** ISO codes flag-icons ships (lowercase file names). */
export function flagIconCodes(): Set<string> {
  available ??= new Set(readdirSync(FLAG_ICONS).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)));
  return available;
}

/**
 * Flag reference for a tag: `overrides` win (any "iso:", "hist:" or "gen:" string), then the Natural
 * Earth ISO code when flag-icons has it. Returns undefined when neither applies.
 */
export async function flagFor(tag: string, overrides: Record<string, string> = {}): Promise<string | undefined> {
  const o = overrides[tag];
  if (o) {
    if (o.startsWith("iso:") && !flagIconCodes().has(o.slice(4))) throw new Error(`${tag}: flag-icons has no ${o}`);
    return o;
  }
  const code = (await isoTable()).get(tag);
  return code && flagIconCodes().has(code) ? `iso:${code}` : undefined;
}
