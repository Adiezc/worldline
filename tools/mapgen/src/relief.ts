// Terrain relief texture: Natural Earth 1:50m shaded relief (public domain, plate carrée)
// reprojected into the game's cropped Miller projection. Gives the map Paradox-style terrain.
// Usage: bun run src/relief.ts   (expects data/raw/relief/SR_50M.tif)

import UTIF from "utif2";
import { encode } from "fast-png";
import { join } from "node:path";
import { MAP_W, MAP_H, unproject } from "@worldline/shared";

const RAW = join(import.meta.dir, "..", "data", "raw", "relief", "SR_50M.tif");
const OUT = join(import.meta.dir, "..", "..", "..", "packages", "mapdata", "public", "map", "relief.png");
const SCALE = 2; // output at half the province-bitmap resolution
const W = MAP_W / SCALE, H = MAP_H / SCALE;

const buf = await Bun.file(RAW).arrayBuffer();
const ifds = UTIF.decode(buf);
UTIF.decodeImage(buf, ifds[0]);
const ifd = ifds[0] as any;
const sw: number = ifd.width, sh: number = ifd.height;
const spp: number = ifd.t277?.[0] ?? 1;
const raw: Uint8Array = ifd.data;
console.log(`source ${sw}×${sh}, ${spp} sample(s)/px`);

const sample = (lon: number, lat: number) => {
  // Bilinear sample of the source raster (−180..180, 90..−90).
  const fx = ((lon + 180) / 360) * sw - 0.5, fy = ((90 - lat) / 180) * sh - 0.5;
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(sh - 1, Math.floor(fy)));
  const x1 = (x0 + 1) % sw, y1 = Math.min(sh - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const px = (x: number, y: number) => raw[(y * sw + ((x + sw) % sw)) * spp];
  return (px(x0, y0) * (1 - tx) + px(x1, y0) * tx) * (1 - ty) + (px(x0, y1) * (1 - tx) + px(x1, y1) * tx) * ty;
};

const out = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  const [, lat] = unproject(0, (y + 0.5) * SCALE);
  for (let x = 0; x < W; x++) {
    const [lon] = unproject((x + 0.5) * SCALE, 0);
    out[y * W + x] = Math.round(sample(lon, lat));
  }
}

// Report the distribution so the shader can treat the flat-land value as neutral.
const hist = new Uint32Array(256);
for (const v of out) hist[v]++;
let mode = 0;
for (let i = 1; i < 256; i++) if (hist[i] > hist[mode]) mode = i;
console.log(`relief ${W}×${H}, most common (flat) value ${mode}`);
await Bun.write(OUT, encode({ width: W, height: H, data: out, depth: 8, channels: 1 }));
console.log(`wrote ${OUT}`);
