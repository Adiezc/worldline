// Small charts the adviser may embed in a reply as one fenced ```chart block of JSON. Replies are
// split into text and chart parts here so the server can sanitise and the client can render alike.
import { z } from "zod";

export const ChartSpecSchema = z.object({
  type: z.enum(["bar", "line"]),
  title: z.string().trim().min(1).max(80),
  unit: z.string().trim().max(24).optional(),
  labels: z.array(z.string()).min(1).max(12),
  series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })).min(1).max(3),
}).refine((c) => c.series.every((s) => s.values.length === c.labels.length), { message: "Each series needs one value per label." });

export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type ReplyPart = { kind: "text"; text: string } | { kind: "chart"; spec: ChartSpec };

/** Up to the closing fence, or the end of the reply when the model forgot to close it. */
const FENCE = /```chart[^\S\n]*\n?([\s\S]*?)(?:```|$)/g;

/** JSON.parse that forgives trailing commas (outside strings) and stray prose around the object. */
function parseLenient(raw: string): unknown {
  const s = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  try {
    return JSON.parse(s.replace(/("(?:[^"\\]|\\.)*")|,(\s*[}\]])/g, (_, str, close) => str ?? close));
  } catch {
    return undefined;
  }
}

/** Ordered text/chart parts of a reply. Only the first valid chart survives; the rest vanish so raw JSON never shows. */
export function splitChartBlocks(text: string): ReplyPart[] {
  const parts: ReplyPart[] = [];
  let buf = "";
  let last = 0;
  const flush = () => {
    // Dropped blocks leave blank runs behind; collapse them so paragraphs stay paragraphs.
    const t = buf.trim().replace(/\n{3,}/g, "\n\n");
    if (t) parts.push({ kind: "text", text: t });
    buf = "";
  };
  for (const m of text.matchAll(FENCE)) {
    buf += `${text.slice(last, m.index)}\n\n`;
    last = m.index + m[0].length;
    const spec = parts.some((p) => p.kind === "chart") ? undefined : ChartSpecSchema.safeParse(parseLenient(m[1])).data;
    if (!spec) continue;
    flush();
    parts.push({ kind: "chart", spec });
  }
  buf += text.slice(last);
  flush();
  return parts;
}

/** Inverse of splitChartBlocks: a reply holding only valid, compact chart blocks. */
export function joinChartParts(parts: ReplyPart[]) {
  return parts.map((p) => (p.kind === "text" ? p.text : `\`\`\`chart\n${JSON.stringify(p.spec)}\n\`\`\``)).join("\n\n");
}
