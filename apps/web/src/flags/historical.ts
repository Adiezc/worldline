// Historical and unofficial flags referenced as "hist:<id>" (Country.flag). Drawn by hand as small,
// simplified SVGs (emblems reduced to recognisable shapes) since they are shown at 16–48 px.
// All use a 4:3 viewBox of 640×480.

const W = 640, H = 480;

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${body}</svg>`;
const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const hBands = (...colors: string[]) => colors.map((c, i) => rect(0, (i * H) / colors.length, W, H / colors.length, c)).join("");
const vBands = (...colors: string[]) => colors.map((c, i) => rect((i * W) / colors.length, 0, W / colors.length, H, c)).join("");

/** Points of a star with `n` points, outer radius r, pointing up (rotated by `rot` degrees). */
function starPoints(cx: number, cy: number, r: number, n = 5, inner = 0.382, rot = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((-90 + rot + (i * 180) / n) * Math.PI) / 180;
    const rr = i % 2 ? r * inner : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}
const star = (cx: number, cy: number, r: number, fill: string, extra = "") => `<polygon points="${starPoints(cx, cy, r)}" fill="${fill}" ${extra}/>`;

/** Union Jack squeezed into the given box (used for ensign cantons). */
const unionJack = (x: number, y: number, w: number, h: number) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 60 30" preserveAspectRatio="none">` +
  `<clipPath id="uj"><path d="M30 15h30v15zv15H0zH0V0zV0h30z"/></clipPath>` +
  `<path d="M0 0v30h60V0z" fill="#012169"/>` +
  `<path d="M0 0l60 30m0-30L0 30" stroke="#fff" stroke-width="6"/>` +
  `<path d="M0 0l60 30m0-30L0 30" clip-path="url(#uj)" stroke="#c8102e" stroke-width="4"/>` +
  `<path d="M30 0v30M0 15h60" stroke="#fff" stroke-width="10"/>` +
  `<path d="M30 0v30M0 15h60" stroke="#c8102e" stroke-width="6"/></svg>`;

/** Simplified walking lion facing left, ~160×110 before scaling. */
const lion = (x: number, y: number, s: number, fill: string, stroke = "none") =>
  `<g transform="translate(${x} ${y}) scale(${s})" fill="${fill}" stroke="${stroke}" stroke-width="${stroke === "none" ? 0 : 5}">` +
  `<path d="M140 52q26-22 16-46" fill="none" stroke="${fill}" stroke-width="8" stroke-linecap="round"/>` +
  `<rect x="46" y="62" width="13" height="44" rx="4"/><rect x="66" y="62" width="13" height="44" rx="4"/>` +
  `<rect x="112" y="62" width="13" height="44" rx="4"/><rect x="130" y="60" width="13" height="46" rx="4"/>` +
  `<ellipse cx="94" cy="56" rx="54" ry="24"/><circle cx="36" cy="38" r="28"/></g>`;

export const HISTORICAL_FLAGS: Record<string, string> = {
  // Soviet Union: red with the gold hammer, sickle and outlined star.
  su: svg(
    rect(0, 0, W, H, "#cc0000") +
      `<g fill="none" stroke="#ffd700" stroke-linecap="round">` +
      `<polygon points="${starPoints(140, 58, 26)}" stroke-width="6"/>` +
      `<path d="M100.5 125.6A42 42 0 1 1 126 179.5" stroke-width="15"/>` +
      `<path d="M126 179.5L104 204" stroke-width="13"/>` +
      `<path d="M172 196L112 136" stroke-width="12"/></g>` +
      `<polygon points="119.3,107.9 132.1,120.7 96.7,156.1 83.9,143.3" fill="#ffd700"/>`,
  ),
  // German Democratic Republic: black-red-gold with the hammer and compass in a wreath.
  ddr: svg(
    hBands("#000", "#dd0000", "#ffce00") +
      `<circle cx="320" cy="240" r="98" fill="#dd0000" stroke="#ffce00" stroke-width="20"/>` +
      `<g stroke="#ffce00" stroke-linecap="round" fill="none"><path d="M320 205v95" stroke-width="16"/>` +
      `<path d="M320 182L284 292M320 182l36 110" stroke-width="12"/></g>` +
      `<rect x="288" y="192" width="64" height="24" rx="3" fill="#ffce00"/><circle cx="320" cy="180" r="11" fill="#ffce00"/>`,
  ),
  // SFR Yugoslavia: blue-white-red with a gold-bordered red star.
  yu: svg(hBands("#0c4076", "#fff", "#de0000") + star(320, 250, 150, "#de0000", `stroke="#fcd116" stroke-width="10"`)),
  // Republic of Vietnam: yellow with three red stripes.
  rvn: svg(rect(0, 0, W, H, "#ffd200") + [160, 224, 288].map((y) => rect(0, y, W, 32, "#da251d")).join("")),
  // Yemen Arab Republic (from September 1962): red-white-black with a green star.
  yar: svg(hBands("#ce1126", "#fff", "#000") + star(320, 244, 66, "#007a3d")),
  // Federation of Rhodesia and Nyasaland: blue ensign with the federal shield (sun, lion, Zambezi waves).
  rny: svg(
    rect(0, 0, W, H, "#012169") +
      unionJack(0, 0, 320, 240) +
      `<clipPath id="sh"><path d="M410 160h140v110q0 70-70 95q-70-25-70-95z"/></clipPath>` +
      `<g clip-path="url(#sh)">` +
      rect(410, 160, 140, 62, "#2f78c4") +
      `<circle cx="480" cy="222" r="30" fill="#f4c430"/>` +
      rect(410, 222, 140, 58, "#fff") +
      `<path d="M450 268l8-26h40l12-12 8 10-10 6v22h-8v-14h-34v14z" fill="#c8102e"/>` +
      rect(410, 280, 140, 100, "#fff") +
      [292, 320, 348].map((y) => `<path d="M410 ${y}q17-12 35 0t35 0 35 0 35 0v14q-17-12-35 0t-35 0-35 0-35 0z" fill="#000"/>`).join("") +
      `</g><path d="M410 160h140v110q0 70-70 95q-70-25-70-95z" fill="none" stroke="#fff" stroke-width="6"/>`,
  ),
  // United Arab Republic (Egypt): red-white-black with two green stars.
  uar: svg(hBands("#ce1126", "#fff", "#000") + star(213, 244, 56, "#007a3d") + star(427, 244, 56, "#007a3d")),
  // Imperial Iran: green-white-red with the lion and sun.
  "ir-lion": svg(
    hBands("#239f40", "#fff", "#da0000") +
      `<circle cx="345" cy="214" r="32" fill="#f2a900" stroke="#f2a900" stroke-width="14" stroke-dasharray="6 6"/>` +
      `<circle cx="345" cy="214" r="26" fill="#f2a900"/>` +
      lion(242, 206, 0.95, "#e0a000") +
      `<path d="M262 232L246 168" stroke="#7a7a7a" stroke-width="7" stroke-linecap="round"/>`,
  ),
  // Iraq 1959–63: black-white-green with a red eight-pointed star and gold disc.
  iq1959: svg(
    vBands("#000", "#fff", "#007a3d") +
      `<polygon points="${starPoints(320, 240, 95, 8, 0.62)}" fill="#ce1126"/><circle cx="320" cy="240" r="36" fill="#fcd116"/>`,
  ),
  // Kingdom of Afghanistan: black-red-green with the white mosque emblem in a wreath.
  "af-kingdom": svg(
    vBands("#000", "#d32011", "#007a36") +
      `<circle cx="320" cy="240" r="92" fill="none" stroke="#fff" stroke-width="16" stroke-dasharray="20 9"/>` +
      `<path d="M270 300v-70h20v-25l30-30 30 30v25h20v70zM305 300v-36a15 15 0 0 1 30 0v36z" fill="#fff" fill-rule="evenodd"/>`,
  ),
  // Union of Burma 1948–74: red with a blue canton, a large star and five small ones.
  mm1948: svg(
    rect(0, 0, W, H, "#da251d") +
      rect(0, 0, 320, 240, "#0b3c8c") +
      star(160, 122, 62, "#fff") +
      [0, 1, 2, 3, 4].map((k) => {
        const a = ((-90 + 36 + 72 * k) * Math.PI) / 180;
        return star(160 + 86 * Math.cos(a), 122 + 86 * Math.sin(a), 20, "#fff");
      }).join(""),
  ),
  // Republic of the Congo (Léopoldville) 1960–63: blue, a large gold star and six small ones at the hoist.
  cd1960: svg(rect(0, 0, W, H, "#007fff") + star(340, 245, 140, "#f7d618") + [40, 120, 200, 280, 360, 440].map((y) => star(62, y + 2, 30, "#f7d618")).join("")),
  // Kingdom of Laos: red with the white three-headed elephant on a pedestal under a parasol.
  "la-kingdom": svg(
    rect(0, 0, W, H, "#ce1126") +
      `<g fill="#fff"><rect x="220" y="356" width="200" height="18"/><rect x="240" y="334" width="160" height="18"/>` +
      `<rect x="256" y="300" width="22" height="36"/><rect x="296" y="300" width="22" height="36"/><rect x="336" y="300" width="22" height="36"/><rect x="372" y="300" width="22" height="36"/>` +
      `<rect x="246" y="232" width="156" height="78" rx="34"/>` +
      `<circle cx="256" cy="228" r="28"/><circle cx="320" cy="214" r="30"/><circle cx="384" cy="228" r="28"/>` +
      `<path d="M234 236q-10 40 6 66h12q-12-30-2-58z"/>` +
      `<rect x="317" y="96" width="6" height="96"/><polygon points="268,150 372,150 320,112"/><polygon points="284,124 356,124 320,96"/></g>`,
  ),
  // Rwanda 1962: red-yellow-green with a black "R".
  rw1962: svg(
    vBands("#ce1126", "#fad201", "#00a651") +
      `<path d="M292 304V176h44a32 32 0 0 1 0 64h-44m40 0l34 64" fill="none" stroke="#000" stroke-width="20" stroke-linejoin="round"/>`,
  ),
  // Ethiopian Empire: green-yellow-red with the crowned Lion of Judah bearing a cross staff.
  "et-imperial": svg(
    hBands("#078930", "#fcdd09", "#da121a") +
      `<path d="M262 236L238 140M226 156h24M232 148h12" stroke="#5b3a12" stroke-width="7" stroke-linecap="round"/>` +
      lion(232, 196, 1.05, "#e8b923", "#5b3a12") +
      `<path d="M252 206l6-18 8 12 8-14 8 14 8-12 4 18z" fill="#e8b923" stroke="#5b3a12" stroke-width="4"/>`,
  ),
  // Canadian Red Ensign (1957): red with the Union Jack and the shield of arms.
  "ca-ensign": svg(
    rect(0, 0, W, H, "#d52b1e") +
      unionJack(0, 0, 320, 240) +
      `<clipPath id="sh"><path d="M420 175h120v95q0 60-60 80q-60-20-60-80z"/></clipPath><g clip-path="url(#sh)">` +
      rect(420, 175, 60, 45, "#c8102e") + rect(480, 175, 60, 45, "#f4c430") +
      rect(420, 220, 60, 45, "#012169") + rect(480, 220, 60, 45, "#012169") +
      rect(420, 265, 120, 90, "#fff") +
      `<circle cx="458" cy="290" r="11" fill="#d52b1e"/><circle cx="480" cy="290" r="11" fill="#d52b1e"/><circle cx="502" cy="290" r="11" fill="#d52b1e"/>` +
      `</g><path d="M420 175h120v95q0 60-60 80q-60-20-60-80z" fill="none" stroke="#f4c430" stroke-width="6"/>`,
  ),
  // Union of South Africa 1928–94: orange-white-blue with the three small flags in the centre.
  za1928: svg(
    hBands("#ef7d00", "#fff", "#012a87") +
      unionJack(206, 196, 76, 46) +
      rect(296, 182, 46, 76, "#ef7d00") + rect(305, 182, 9, 76, "#fff") + rect(324, 182, 9, 76, "#fff") + rect(296, 182, 18, 26, "#21468b") + rect(296, 190, 18, 9, "#fff") + rect(296, 182, 18, 8, "#ae1c28") +
      rect(356, 182, 46, 25, "#ae1c28") + rect(356, 207, 46, 26, "#fff") + rect(356, 233, 46, 25, "#21468b") + rect(356, 182, 14, 76, "#007a3d"),
  ),
  // Republic of Upper Volta: black-white-red.
  "upper-volta": svg(hBands("#000", "#fff", "#ce1126")),
  // Kingdom of Burundi 1962–66: white saltire, red and green, with the drum and sorghum in the disc.
  bi1962: svg(
    rect(0, 0, W, H, "#ce1126") +
      `<path d="M0 0L320 240 0 480zM640 0L320 240 640 480z" fill="#1eb53a"/>` +
      `<path d="M0 0L640 480M640 0L0 480" stroke="#fff" stroke-width="70"/>` +
      `<circle cx="320" cy="240" r="125" fill="#fff"/>` +
      `<path d="M320 238V160" stroke="#1eb53a" stroke-width="8"/><ellipse cx="320" cy="154" rx="12" ry="22" fill="#ce1126"/>` +
      `<path d="M290 240h60l-8 68h-44z" fill="#8b5a2b"/><ellipse cx="320" cy="240" rx="30" ry="9" fill="#d9b48a"/>`,
  ),
  // Cameroon 1961–75: green-red-yellow with two gold stars in the green stripe.
  cm1961: svg(vBands("#007a5e", "#ce1126", "#fcd116") + star(68, 96, 34, "#fcd116") + star(146, 96, 34, "#fcd116")),
  // Mauritania 1959–2017: green with the gold crescent and star.
  mr1959: svg(
    rect(0, 0, W, H, "#00a95c") +
      `<path d="M205 220a115 115 0 0 0 230 0a120 108 0 0 1-230 0z" fill="#ffd700"/>` + star(320, 196, 52, "#ffd700"),
  ),
  // Tanganyika 1961–64: green with a gold-edged black horizontal band.
  tanganyika: svg(rect(0, 0, W, H, "#1eb53a") + rect(0, 184, W, 112, "#fcd116") + rect(0, 202, W, 76, "#000")),
  // Republic of the Sudan 1956–70: blue-yellow-green.
  sd1956: svg(hBands("#0047ab", "#fcd116", "#009639")),
  // Sultanate of Muscat and Oman: plain red.
  muscat: svg(rect(0, 0, W, H, "#c1272d")),
  // People's Republic of Bulgaria 1948–67: white-green-red with the state emblem at the hoist.
  bg1948: svg(
    hBands("#fff", "#00966e", "#d62612") +
      `<circle cx="112" cy="168" r="56" fill="#1a3e8c" stroke="#e8c547" stroke-width="14" stroke-dasharray="14 5"/>` +
      lion(82, 150, 0.38, "#e8c547") + star(112, 90, 18, "#d62612"),
  ),
  // Romanian People's Republic 1952–65: blue-yellow-red with the landscape emblem.
  ro1952: svg(
    vBands("#002b7f", "#fcd116", "#ce1126") +
      `<clipPath id="em"><circle cx="320" cy="248" r="70"/></clipPath><g clip-path="url(#em)">` +
      `<rect x="250" y="178" width="140" height="140" fill="#5ab0e6"/><circle cx="320" cy="262" r="34" fill="#f29200"/>` +
      `<path d="M240 330l50-70 30 30 30-45 50 85z" fill="#2e7d32"/></g>` +
      `<circle cx="320" cy="248" r="76" fill="none" stroke="#d9a000" stroke-width="14" stroke-dasharray="16 6"/>` +
      star(320, 156, 24, "#ce1126") + rect(282, 314, 76, 18, "#ce1126"),
  ),
  // Spanish State 1945–77: red-yellow-red with the eagle of Saint John.
  es1945: svg(
    rect(0, 0, W, H, "#c60b1e") + rect(0, 120, W, 240, "#ffc400") +
      `<path d="M320 170L190 140l40 60-30 10 70 30zM320 170l130-30-40 60 30 10-70 30z" fill="#000"/>` +
      `<ellipse cx="320" cy="240" rx="42" ry="72" fill="#000"/><circle cx="320" cy="160" r="18" fill="#000"/>` +
      `<path d="M298 212h44v40q0 22-22 28q-22-6-22-28z" fill="#c60b1e"/><path d="M320 212v68q22-6 22-28v-40z" fill="#ffc400"/>`,
  ),
  // Kingdom of Greece land flag (to 1969/70): blue with a white cross.
  "gr-cross": svg(rect(0, 0, W, H, "#0d5eaf") + rect(272, 0, 96, H, "#fff") + rect(0, 192, W, 96, "#fff")),
  // Somaliland: green-white-red, the shahada on green and a black star.
  somaliland: svg(
    hBands("#00843d", "#fff", "#dd1c1b") +
      `<path d="M190 96q20-26 40 0t40 0 40 0 40 0 40 0 40 0M240 60v34M340 60v34M400 60v34" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round"/>` +
      star(320, 244, 58, "#000"),
  ),
  // Turkish Republic of Northern Cyprus: white with two red bands, a red crescent and star.
  trnc: svg(
    rect(0, 0, W, H, "#fff") + rect(0, 48, W, 48, "#e30a17") + rect(0, 384, W, 48, "#e30a17") +
      `<path d="M340 150a90 90 0 0 0 0 180a58 90 0 0 1 0-180z" fill="#e30a17"/>` +
      `<polygon points="${starPoints(372, 240, 40, 5, 0.382, -90)}" fill="#e30a17"/>`,
  ),
};

const uriCache = new Map<string, string>();

/** data: URI for a historical flag, or null when the id is unknown. */
export function historicalFlagUri(id: string): string | null {
  const body = HISTORICAL_FLAGS[id];
  if (!body) return null;
  let uri = uriCache.get(id);
  if (!uri) uriCache.set(id, (uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(body)}`));
  return uri;
}
