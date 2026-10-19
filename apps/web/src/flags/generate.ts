// Generated flags ("gen:<pattern>:<c1>,<c2>[,<c3>]") rendered as SVG data URIs, plus the
// deterministic fallback for countries without a `flag`. Pure TS (no Vite APIs) so it runs under bun test.

import { deriveFlag, parseFlag, type FlagPattern } from "@worldline/shared";

const W = 640, H = 480;

function star(cx: number, cy: number, r: number, fill: string): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((-90 + i * 36) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.382 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return `<polygon points="${pts.join(" ")}" fill="${fill}"/>`;
}

const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;

/** SVG markup for a generated flag pattern. Missing colours repeat the first. */
export function generatedFlagSvg(pattern: FlagPattern, colors: string[]): string {
  const [a = "#8a8a8a", b = "#f4f1e8", c] = colors;
  let body: string;
  switch (pattern) {
    case "vertical":
      body = rect(0, 0, W / 3, H, a) + rect(W / 3, 0, W / 3, H, b) + rect((2 * W) / 3, 0, W / 3, H, c ?? a);
      break;
    case "horizontal":
      body = rect(0, 0, W, H / 3, a) + rect(0, H / 3, W, H / 3, b) + rect(0, (2 * H) / 3, W, H / 3, c ?? a);
      break;
    case "bicolor-v":
      body = rect(0, 0, W / 2, H, a) + rect(W / 2, 0, W / 2, H, b) + (c ? `<circle cx="${W / 2}" cy="${H / 2}" r="${H / 4}" fill="${c}"/>` : "");
      break;
    case "bicolor-h":
      body = rect(0, 0, W, H / 2, a) + rect(0, H / 2, W, H / 2, b) + (c ? `<path d="M0 0L${W * 0.42} ${H / 2}L0 ${H}z" fill="${c}"/>` : "");
      break;
    case "nordic":
      body = rect(0, 0, W, H, a) + rect(176, 0, 112, H, b) + rect(0, 184, W, 112, b) + (c ? rect(204, 0, 56, H, c) + rect(0, 212, W, 56, c) : "");
      break;
    case "canton":
      body = rect(0, 0, W, H, a) + rect(0, 0, W / 2, H / 2, b) + star(W / 4, H / 4, 78, c ?? a);
      break;
    case "diagonal":
      body = `<path d="M0 0H${W}L0 ${H}z" fill="${a}"/><path d="M${W} 0V${H}H0z" fill="${b}"/>` +
        (c ? `<path d="M0 ${H}L${W} 0" stroke="${c}" stroke-width="110"/>` : "");
      break;
    case "triband-star":
      body = rect(0, 0, W, H, a) + rect(0, H / 4, W, H / 2, b) + star(W / 2, H / 2 + 8, 100, c ?? a);
      break;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

export const svgDataUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

const cache = new Map<string, string>();

/** data: URI for a "gen:" reference, or null if it is not a valid generated flag. */
export function generatedFlagUri(flag: string): string | null {
  let uri = cache.get(flag);
  if (uri) return uri;
  const p = parseFlag(flag);
  if (p?.kind !== "gen") return null;
  uri = svgDataUri(generatedFlagSvg(p.pattern, p.colors));
  if (cache.size > 2000) cache.clear();
  cache.set(flag, uri);
  return uri;
}

/** The generated reference used when a country has no (usable) flag: stable for a tag and colour. */
export const fallbackFlag = (c: { tag: string; color?: string }) => deriveFlag(c.color ?? "#8a8a8a", c.tag);

export const fallbackFlagUri = (c: { tag: string; color?: string }) => generatedFlagUri(fallbackFlag(c))!;
