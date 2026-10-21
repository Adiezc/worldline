// The generated lake mesh, as the client reads it: picking treats lakes as water.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { MAP_W, project } from "@worldline/shared";
import { LakeIndex, parseLakes } from "../src/map/lakes.ts";

const buf = await Bun.file(join(import.meta.dir, "..", "..", "..", "packages", "mapdata", "public", "map", "lakes.mesh.bin")).arrayBuffer();
const lakes = new LakeIndex(parseLakes(buf), MAP_W);
const at = (lon: number, lat: number) => lakes.contains(...project(lon, lat));

test("the Great Lakes and other large lakes are water", () => {
  for (const [name, lon, lat] of [
    ["Superior", -87.5, 47.7], ["Michigan", -87.0, 43.5], ["Huron", -82.4, 44.8], ["Erie", -81.2, 42.2], ["Ontario", -77.8, 43.6],
    ["Victoria", 33.0, -1.0], ["Baikal", 108.0, 53.5], ["Winnipeg", -97.8, 52.6], ["Ladoga", 31.5, 61.0],
  ] as const) {
    expect(at(lon, lat), name).toBe(true);
  }
});

test("land next to them is not", () => {
  for (const [name, lon, lat] of [["Chicago", -87.75, 41.85], ["Toronto (inland)", -79.5, 43.75], ["Iowa", -93.5, 42.0], ["Kampala (inland)", 32.45, 0.4], ["Paris", 2.35, 48.85]] as const) {
    expect(at(lon, lat), name).toBe(false);
  }
});
