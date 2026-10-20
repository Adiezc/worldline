import { describe, expect, test } from "bun:test";
import { ChartSpecSchema, joinChartParts, splitChartBlocks } from "../src/game/chart.ts";

const spec = { type: "bar", title: "GDP of the region", unit: "$bn", labels: ["FRA", "DEU"], series: [{ name: "GDP", values: [3100, 4500] }] };
const block = (body: string) => `\`\`\`chart\n${body}\n\`\`\``;

describe("ChartSpecSchema", () => {
  test("accepts a well-formed spec", () => {
    expect(ChartSpecSchema.safeParse(spec).success).toBe(true);
  });

  test("rejects mismatched lengths, too many series, bad numbers and long titles", () => {
    const bad = [
      { ...spec, series: [{ name: "GDP", values: [1] }] },
      { ...spec, series: [1, 2, 3, 4].map((i) => ({ name: `s${i}`, values: [1, 2] })) },
      { ...spec, series: [{ name: "GDP", values: [1, Infinity] }] },
      { ...spec, series: [{ name: "GDP", values: [1, "2"] }] },
      { ...spec, labels: [], series: [{ name: "GDP", values: [] }] },
      { ...spec, labels: Array.from({ length: 13 }, (_, i) => `L${i}`), series: [{ name: "GDP", values: Array(13).fill(1) }] },
      { ...spec, title: "x".repeat(81) },
      { ...spec, type: "pie" },
    ];
    for (const b of bad) expect(ChartSpecSchema.safeParse(b).success).toBe(false);
  });
});

describe("splitChartBlocks", () => {
  test("plain text is one text part", () => {
    expect(splitChartBlocks("Hello.\n\nSecond paragraph.")).toEqual([{ kind: "text", text: "Hello.\n\nSecond paragraph." }]);
    expect(splitChartBlocks("   ")).toEqual([]);
  });

  test("keeps text and chart in order", () => {
    const parts = splitChartBlocks(`Our rivals are larger.\n\n${block(JSON.stringify(spec))}\n\nAct now.`);
    expect(parts.map((p) => p.kind)).toEqual(["text", "chart", "text"]);
    expect(parts[1]).toEqual({ kind: "chart", spec: spec as never });
    expect(parts[2]).toEqual({ kind: "text", text: "Act now." });
  });

  test("forgives trailing commas, but not inside strings", () => {
    const body = '{"type":"line","title":"Relations, trend",,"labels":["Jan","Feb",],"series":[{"name":"POL","values":[10,20,],},],}';
    expect(splitChartBlocks(block(body))).toEqual([]);
    const ok = '{"type":"line","title":"Relations, ]trend","labels":["Jan","Feb",],"series":[{"name":"POL","values":[10,20,],},],}';
    const [p] = splitChartBlocks(block(ok));
    expect(p).toMatchObject({ kind: "chart", spec: { title: "Relations, ]trend", labels: ["Jan", "Feb"] } });
  });

  test("drops invalid and extra blocks, keeping the text clean", () => {
    const second = { ...spec, title: "Second" };
    const text = `Intro.\n\n${block("{not json")}\n\nMiddle.\n\n${block(JSON.stringify(spec))}\n\n${block(JSON.stringify(second))}\n\nEnd.`;
    const parts = splitChartBlocks(text);
    expect(parts).toEqual([
      { kind: "text", text: "Intro.\n\nMiddle." },
      { kind: "chart", spec: spec as never },
      { kind: "text", text: "End." },
    ]);
    expect(JSON.stringify(parts)).not.toContain("not json");
  });

  test("an unclosed block is swallowed rather than shown", () => {
    expect(splitChartBlocks(`Intro.\n\n\`\`\`chart\n{"type":"bar",`)).toEqual([{ kind: "text", text: "Intro." }]);
  });

  test("joinChartParts round-trips", () => {
    const text = `Intro.\n\n${block(JSON.stringify(spec, null, 2))}\n\nEnd.`;
    const joined = joinChartParts(splitChartBlocks(text));
    expect(joined).toBe(`Intro.\n\n${block(JSON.stringify(spec))}\n\nEnd.`);
    expect(splitChartBlocks(joined)).toEqual(splitChartBlocks(text));
  });
});
