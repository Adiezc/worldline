// A small inline SVG chart for adviser letters: bars (grouped when several series) or lines on one
// axis. Drawn on the letter's parchment, so the colours are fixed rather than taken from the HUD theme.
import { useLayoutEffect, useRef, useState } from "react";
import type { ChartSpec } from "@worldline/shared";

/** Blue, rust, plum: validated against parchment for contrast and colour-blind separation. */
const SERIES = ["#2b62a8", "#b8531a", "#8a3f6e"];
const PAPER = "#e8d8b4";
const INK = "#3a2c1c";
const MUTED = "#6b5636";
const H = 132;
const PAD = { top: 8, right: 8, bottom: 18 };

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const exact = (v: number) => v.toLocaleString("en", { maximumFractionDigits: 2 });

/** Round tick values covering [lo, hi]. */
function niceTicks(lo: number, hi: number, count = 4) {
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + step / 2; v += step) out.push(+v.toFixed(10));
  return out;
}

/** A bar with a rounded data end and a square foot on the baseline, either side of zero. */
function barPath(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0));
  const d = y1 < y0 ? r : -r;
  return `M${x},${y0}V${y1 + d}Q${x},${y1} ${x + r},${y1}H${x + w - r}Q${x + w},${y1} ${x + w},${y1 + d}V${y0}Z`;
}

export function MiniChart({ spec }: { spec: ChartSpec }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(280);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.max(160, el.clientWidth));
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(160, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { labels, series, unit } = spec;
  const values = series.flatMap((s) => s.values);
  const bar = spec.type === "bar";
  // Bars grow from zero; lines may float so a trend is not flattened.
  const ticks = niceTicks(Math.min(...values, ...(bar ? [0] : [])), Math.max(...values, ...(bar ? [0] : [])));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((t) => compact.format(t).length)) * 6 + 8;
  const plotW = width - left - PAD.right;
  const y = (v: number) => PAD.top + ((hi - v) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const band = plotW / labels.length;
  const cx = (i: number) => left + band * (i + 0.5);
  const maxChars = Math.max(2, Math.floor(band / 6));
  const short = (l: string) => (l.length > maxChars ? `${l.slice(0, maxChars - 1)}…` : l);
  const barW = Math.max(2, Math.min(24, (band * 0.7 - 2 * (series.length - 1)) / series.length));
  const groupW = barW * series.length + 2 * (series.length - 1);
  const zero = y(Math.max(lo, Math.min(hi, 0)));
  const tip = (i: number) =>
    `${labels[i]}: ${series.map((s) => `${series.length > 1 ? `${s.name} ` : ""}${exact(s.values[i])}`).join(", ")}${unit ? ` ${unit}` : ""}`;

  return (
    <figure ref={ref} className="my-3 select-none">
      <figcaption className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12px]" style={{ color: INK }}>
        <span className="font-display">{spec.title}</span>
        {unit && <span className="text-[11px]" style={{ color: MUTED }}>({unit})</span>}
        {series.length > 1 && (
          <span className="ml-auto flex gap-2.5 font-sans text-[10.5px]" style={{ color: MUTED }}>
            {series.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="inline-block size-2 rounded-sm" style={{ background: SERIES[i] }} />
                {s.name}
              </span>
            ))}
          </span>
        )}
      </figcaption>
      <svg width={width} height={H} role="img" aria-label={spec.title} className="block font-sans tabular-nums">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={MUTED} strokeOpacity={t === 0 ? 0.55 : 0.2} strokeWidth={1} />
            <text x={left - 5} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={MUTED}>{compact.format(t)}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          <text key={i} x={cx(i)} y={H - 4} textAnchor="middle" fontSize={10} fill={INK}>{short(l)}</text>
        ))}
        {/* Whole-column hit targets under the marks carry the values, so hovering anywhere near a mark reads it. */}
        {labels.map((_, i) => (
          <rect key={i} x={left + band * i} y={PAD.top} width={band} height={H - PAD.top - PAD.bottom} className="fill-transparent hover:fill-[#6b563614]">
            <title>{tip(i)}</title>
          </rect>
        ))}
        <g pointerEvents="none">
          {bar
            ? series.map((s, si) =>
              s.values.map((v, i) => (
                <path key={`${si}-${i}`} d={barPath(cx(i) - groupW / 2 + si * (barW + 2), barW, zero, y(v))} fill={SERIES[si]} />
              )))
            : series.map((s, si) => (
              <g key={si}>
                <polyline
                  points={s.values.map((v, i) => `${cx(i)},${y(v)}`).join(" ")}
                  fill="none" stroke={SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
                />
                {s.values.map((v, i) => <circle key={i} cx={cx(i)} cy={y(v)} r={4} fill={SERIES[si]} stroke={PAPER} strokeWidth={2} />)}
              </g>
            ))}
        </g>
      </svg>
      <table className="sr-only">
        <caption>{spec.title}{unit ? ` (${unit})` : ""}</caption>
        <thead><tr><th />{series.map((s, i) => <th key={i}>{s.name}</th>)}</tr></thead>
        <tbody>
          {labels.map((l, i) => <tr key={i}><th>{l}</th>{series.map((s, si) => <td key={si}>{exact(s.values[i])}</td>)}</tr>)}
        </tbody>
      </table>
    </figure>
  );
}
