// Miller cylindrical projection, cropped to the latitudes we render (Antarctica is excluded).
// Map space is measured in province-bitmap pixels: x in [0, MAP_W), y in [0, MAP_H).

export const MAP_W = 8192;
export const MAP_H = 4096;
export const LAT_MAX = 84;
export const LAT_MIN = -58;

const DEG = Math.PI / 180;
const miller = (latDeg: number) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * latDeg * DEG));
const Y_TOP = miller(LAT_MAX);
const Y_BOTTOM = miller(LAT_MIN);

export function project(lon: number, lat: number): [number, number] {
  const clamped = Math.max(LAT_MIN, Math.min(LAT_MAX, lat));
  const x = ((lon + 180) / 360) * MAP_W;
  const y = ((Y_TOP - miller(clamped)) / (Y_TOP - Y_BOTTOM)) * MAP_H;
  return [x, y];
}

export function unproject(x: number, y: number): [number, number] {
  const lon = (x / MAP_W) * 360 - 180;
  const my = Y_TOP - (y / MAP_H) * (Y_TOP - Y_BOTTOM);
  const lat = (Math.atan(Math.exp(my / 1.25)) - Math.PI / 4) / 0.4 / DEG;
  return [lon, lat];
}
