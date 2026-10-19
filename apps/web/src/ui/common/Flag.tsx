// National flags. Country.flag is "iso:xx" (flag-icons, fetched lazily), "hist:<id>" (drawn in
// flags/historical.ts) or "gen:…" (flags/generate.ts); anything missing or unknown falls back to a
// flag generated from the country's colour and tag.
import { useEffect, useState } from "react";
import { parseFlag } from "@worldline/shared";
import { fallbackFlagUri, generatedFlagUri } from "../../flags/generate.ts";
import { historicalFlagUri } from "../../flags/historical.ts";

export interface FlagSource {
  tag: string;
  color?: string;
  flag?: string;
  name?: string;
}

// flag-icons resolves into apps/web/node_modules (Vite root), so a root-relative glob finds it. Each
// entry is a lazy loader returning the asset URL: only flags actually shown are fetched.
const ISO_LOADERS = new Map<string, () => Promise<string>>();
for (const [path, load] of Object.entries(import.meta.glob<string>("/node_modules/flag-icons/flags/4x3/*.svg", { query: "?url", import: "default" }))) {
  const m = /([a-z0-9-]+)\.svg$/.exec(path);
  if (m) ISO_LOADERS.set(m[1]!, load);
}
/** Whether flag-icons ships a flag for this ISO code (lowercase). */
export const hasIsoFlag = (code: string) => ISO_LOADERS.has(code.toLowerCase());

const isoUrls = new Map<string, string | null>();
const isoPending = new Map<string, Promise<string | null>>();

function loadIso(code: string): Promise<string | null> {
  let p = isoPending.get(code);
  if (!p) {
    const load = ISO_LOADERS.get(code);
    p = (load ? load() : Promise.resolve(null))
      .catch(() => null)
      .then((url) => (isoUrls.set(code, url), url));
    isoPending.set(code, p);
  }
  return p;
}

/** Synchronous source when available; `iso` names a flag still to be loaded. */
function resolveFlag(c: FlagSource): { src: string } | { iso: string } {
  const p = parseFlag(c.flag);
  if (p?.kind === "iso") {
    if (!ISO_LOADERS.has(p.code)) return { src: fallbackFlagUri(c) };
    const url = isoUrls.get(p.code);
    if (url === undefined) return { iso: p.code };
    return { src: url ?? fallbackFlagUri(c) };
  }
  if (p?.kind === "hist") return { src: historicalFlagUri(p.id) ?? fallbackFlagUri(c) };
  if (p?.kind === "gen") return { src: generatedFlagUri(c.flag!) ?? fallbackFlagUri(c) };
  return { src: fallbackFlagUri(c) };
}

/** Image URL for a country's flag (null while a real flag is loading). */
export function useFlagSrc(c: FlagSource | null | undefined): string | null {
  const r = c ? resolveFlag(c) : null;
  const iso = r && "iso" in r ? r.iso : null;
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!iso) return;
    let live = true;
    void loadIso(iso).then(() => live && rerender((n) => n + 1));
    return () => {
      live = false;
    };
  }, [iso]);
  if (!r) return null;
  return "src" in r ? r.src : null;
}

/**
 * A country's flag at 4:3, `size` px wide. Accepts a Country or any {tag, color, flag}; renders a
 * neutral placeholder for unknown countries and while a real flag loads.
 */
export function Flag({
  country,
  size = 16,
  className = "",
  title,
}: {
  country: FlagSource | null | undefined;
  size?: number;
  className?: string;
  /** Tooltip/alt text; defaults to the country name. Pass false to omit the tooltip. */
  title?: string | false;
}) {
  const src = useFlagSrc(country);
  const w = size, h = Math.round((size * 3) / 4);
  const label = title === false ? undefined : title ?? country?.name ?? country?.tag;
  const radius = size >= 32 ? 3 : 2;
  const frame = `inline-block shrink-0 align-middle shadow-[0_0_0_1px_rgb(0_0_0/0.55),0_1px_2px_rgb(0_0_0/0.45)] ${className}`;
  if (!src) {
    return (
      <span
        className={frame}
        style={{ width: w, height: h, borderRadius: radius, background: country?.color ?? "#555" }}
        title={label}
        role="img"
        aria-label={label ? `Flag of ${label}` : "Flag"}
      />
    );
  }
  return (
    <img
      src={src}
      width={w}
      height={h}
      alt={label ? `Flag of ${label}` : ""}
      title={label}
      draggable={false}
      decoding="async"
      className={`${frame} object-cover`}
      style={{ width: w, height: h, borderRadius: radius }}
    />
  );
}
