// GLSL for the political map. Map space = province-bitmap pixels (8192 × 4096).
// Province ids live in an R16UI texture; per-province (owner, controller) in a small RG16UI
// lookup; owner colours in an RGBA8 palette. Changing hands = one texel write, no geometry.

const common = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp usampler2D;

uniform vec2 uCenter;      // map px at screen centre
uniform float uZoom;       // device px per map px
uniform vec2 uViewport;    // device px
uniform vec2 uMapSize;
uniform usampler2D uProv;  // (owner, controller) per province, 64 wide
uniform sampler2D uPalette;
uniform int uMode;         // 0 political
uniform float uDpr;        // device px per CSS px

const uint NONE = 65535u;

uvec2 provInfo(uint id) {
  return texelFetch(uProv, ivec2(int(id) % 64, int(id) / 64), 0).rg;
}
`;

export const fillVert = /* glsl */ `#version 300 es
precision highp float;
out vec2 vClip;
void main() {
  // Full-screen triangle.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vClip = p * 2.0 - 1.0;
  gl_Position = vec4(vClip, 0.0, 1.0);
}`;

// Land shading shared by the raster fill (zoomed out) and the vector mesh fill (zoomed in).
const landLib = common + /* glsl */ `
uniform usampler2D uIds;
uniform sampler2D uCoast;
uniform sampler2D uRelief; // 8-bit hillshade, flat = 206
uniform uint uHover;
uniform uint uSelected;
uniform uint uSelOwner;
uniform vec3 uPaper;
uniform vec3 uOceanDeep;
uniform float uPoliticalMix;
uniform float uSepia;
uniform float uReliefK;
uniform vec3 uInk;
uniform usampler2D uMarks; // 1 = province picked for a proposal (64 wide, like uProv)

bool marked(uint id) { return texelFetch(uMarks, ivec2(int(id) % 64, int(id) / 64), 0).r != 0u; }

ivec2 wrapTexel(vec2 p) {
  int w = int(uMapSize.x);
  int x = int(floor(p.x)) % w;
  if (x < 0) x += w;
  return ivec2(x, clamp(int(floor(p.y)), 0, int(uMapSize.y) - 1));
}
uint idAt(vec2 p) { return texelFetch(uIds, wrapTexel(p), 0).r; }

// Sin-free hashes: sin() of large arguments loses precision on many GPUs and turns into grain.
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.103, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
// Gradient noise on a lattice that repeats every \`period\` cells in x, so the sea is seamless
// across the date line; quintic fade avoids the square blotches of value noise.
float gnoise(vec2 p, float period) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 i0 = vec2(mod(i.x, period), i.y), i1 = vec2(mod(i.x + 1.0, period), i.y);
  float a = dot(hash2(i0), f), b = dot(hash2(i1), f - vec2(1, 0));
  float c = dot(hash2(i0 + vec2(0, 1)), f - vec2(0, 1)), d = dot(hash2(i1 + vec2(0, 1)), f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125 + noise(p * 8.3) * 0.0625; }

vec3 countryColor(uint owner) {
  if (owner >= NONE - 1u) return vec3(0.62, 0.6, 0.55);
  return texelFetch(uPalette, ivec2(int(owner), 0), 0).rgb;
}

vec3 landColor(uint id, vec2 world) {
  uvec2 info = provInfo(id);
  vec3 c = countryColor(info.x);
  if (info.y != info.x) {
    // Occupation: diagonal stripes in the controller's colour, edges filtered to the pixel size.
    float v = (world.x + world.y) / 7.0;
    float tri = abs(fract(v) - 0.5);
    float aa = 1.0 / (7.0 * uZoom);
    float s = smoothstep(0.25 - aa, 0.25 + aa, tri);
    c = mix(c, countryColor(info.y), s * 0.85);
  }
  if (marked(id)) {
    // Picked for a peace deal: a gold wash with a fine cross-hatch (unlike occupation's
    // single-direction stripes in the occupier's colour).
    float period = 7.0 * max(uDpr, 1.0) / uZoom; // ~7 CSS px at any zoom
    float aa = 1.0 / (period * uZoom);
    float d1 = abs(fract((world.x - world.y) / period) - 0.5), d2 = abs(fract((world.x + world.y) / period) - 0.5);
    float h = max(smoothstep(0.38 - aa, 0.38 + aa, d1), smoothstep(0.38 - aa, 0.38 + aa, d2));
    c = mix(mix(c, vec3(0.96, 0.78, 0.33), 0.45), vec3(0.42, 0.3, 0.08), h * 0.55);
  }
  if (id == uSelected) c = mix(c, vec3(1.0), 0.28);
  else if (id == uHover) c = mix(c, vec3(1.0), 0.14);
  else if (uSelOwner != NONE && info.x == uSelOwner) c = mix(c, vec3(1.0), 0.06);
  return c;
}

vec3 oceanColor(vec2 world) {
  // Calm sea: a few broad, soft swells. Octaves finer than ~4 device px fade out, so zooming
  // never shows speckle.
  vec2 q = vec2(mod(world.x, uMapSize.x), world.y);
  float fp = 1.0 / uZoom;
  float n = 0.0, amp = 0.55, cells = 48.0;
  for (int k = 0; k < 4; k++) {
    float cell = uMapSize.x / cells;
    n += gnoise(q / cell, cells) * amp * (1.0 - smoothstep(0.12, 0.25, fp / cell));
    cells *= 2.0;
    amp *= 0.5;
  }
  return uOceanDeep * (1.0 + n * 0.09);
}

vec3 paperColor(vec2 world) { return uPaper + (fbm(world * 0.35) - 0.5) * 0.06; }

// Cubic B-spline relief lookup from four bilinear taps: hides the texel grid up close.
vec4 cubicW(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x, y = s.y - 4.0 * s.x, z = s.z - 4.0 * s.y + 6.0 * s.x;
  return vec4(x, y, z, 6.0 - x - y - z) * (1.0 / 6.0);
}
float reliefAt(vec2 uv) {
  vec2 size = vec2(textureSize(uRelief, 0));
  // Zoomed out (a relief texel under ~1.5 device px): one mipmapped tap is enough.
  if (uZoom * uMapSize.x / size.x < 1.5) return texture(uRelief, uv).r;
  vec2 tc = uv * size - 0.5;
  vec2 f = fract(tc);
  tc -= f;
  vec4 xc = cubicW(f.x), yc = cubicW(f.y);
  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xc.xz + xc.yw, yc.xz + yc.yw);
  vec4 o = (c + vec4(xc.yw, yc.yw) / s) / size.xxyy;
  float s0 = textureLod(uRelief, o.xz, 0.0).r, s1 = textureLod(uRelief, o.yz, 0.0).r;
  float s2 = textureLod(uRelief, o.xw, 0.0).r, s3 = textureLod(uRelief, o.yw, 0.0).r;
  float sx = s.x / (s.x + s.y), sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

uint ownerOf(uint id) { return id == 0u ? NONE - 1u : provInfo(id).x; }

// Inward country-border tint (Victoria 3 style): how much of a ring around us belongs to
// someone else. Sampled from the province bitmap, so it fades out up close where its texels
// would show as steps (the vector border line carries the edge there).
vec3 borderTint(vec3 col, uint id, vec2 world) {
  float fade = 1.0 - smoothstep(2.0, 5.0, uZoom);
  if (fade <= 0.0) return col;
  float fp = 1.0 / uZoom;
  uint me = ownerOf(id);
  float r = clamp(7.0 * fp, 1.2, 28.0);
  float other = 0.0;
  for (int k = 0; k < 8; k++) {
    float a = float(k) * 0.785398;
    vec2 d = vec2(cos(a), sin(a));
    uint o1 = ownerOf(idAt(world + d * r));
    uint o2 = ownerOf(idAt(world + d * r * 0.45));
    other += (o1 != me && o1 != NONE - 1u ? 0.6 : 0.0) + (o2 != me && o2 != NONE - 1u ? 0.4 : 0.0);
  }
  float edge = clamp(other / 4.0, 0.0, 1.0) * fade;
  col = mix(col, countryColor(me) * 0.72, edge * 0.55);
  // Gentle inland darkening keeps continents from looking flat at world scale.
  float inland = texture(uCoast, world / uMapSize).r;
  return col * (1.0 - smoothstep(0.5, 1.0, inland) * 0.05);
}

// Relief, ink contour and sepia. Must run in uniform control flow (uses derivatives).
vec3 finish(vec3 col, vec2 world, float landW) {
  float zoomCss = uZoom / max(uDpr, 1.0);
  float shade = reliefAt(world / uMapSize) - 206.0 / 255.0;
  // Up close a hillshade texel spans many pixels and reads as soft blobs: add fine ridged
  // detail where the terrain is already rough, so mountains keep a crisp texture.
  float closeUp = smoothstep(1.2, 4.0, zoomCss);
  if (closeUp > 0.0) {
    float n = fbm(world * 0.9) - 0.5;
    float ridge = 0.5 - abs(fbm(world * 0.45 + 17.0) - 0.5);
    shade += (n * 0.6 + (ridge - 0.25) * 0.8) * min(abs(shade) * 3.0 + 0.02, 0.25) * closeUp;
  }
  // Soft-clip the extremes so deep shadows never go black.
  shade = shade / (1.0 + abs(shade) * 1.2);
  float contour = abs(shade + 0.12) / max(fwidth(shade), 1e-4);
  if (landW > 0.0) {
    // Subtle at world scale so political colours stay readable, stronger at regional zoom,
    // easing off again up close where the half-resolution hillshade would look smeared.
    float k = uReliefK * mix(1.15, 1.9, smoothstep(0.35, 2.0, zoomCss)) * mix(1.0, 0.6, smoothstep(2.0, 7.0, zoomCss));
    col *= 1.0 + shade * k * landW;
    // A faint hand-inked outline where slopes turn into deep shadow (mountains only).
    float line = (1.0 - smoothstep(0.6, 1.6, contour)) * smoothstep(0.7, 1.8, zoomCss);
    col = mix(col, uInk, line * 0.14 * landW);
  }
  if (uSepia > 0.0) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 sep = vec3(l * 1.08 + 0.04, l * 0.98 + 0.02, l * 0.78);
    col = mix(col, sep, uSepia);
  }
  return col;
}
`;

export const fillFrag = landLib + /* glsl */ `
uniform int uOceanOnly; // 1 while the vector mesh draws the land
in vec2 vClip;
out vec4 outColor;

void main() {
  vec2 screen = vec2(vClip.x, -vClip.y) * 0.5 * uViewport;
  vec2 world = uCenter + screen / uZoom;
  if (world.y < 0.0 || world.y >= uMapSize.y) {
    outColor = vec4(uOceanDeep * 0.75, 1.0);
    return;
  }
  vec3 ocean = oceanColor(world);
  if (uOceanOnly == 1) {
    outColor = vec4(finish(ocean, world, 0.0), 1.0);
    return;
  }
  float fp = 1.0 / uZoom; // map px per device px

  // 4-tap reconstruction: bilinear across texel centres when zoomed in (smooth edges),
  // a 2×2 box over the pixel footprint when zoomed out (no shimmering).
  vec2 taps[4];
  vec4 weights;
  if (fp < 1.0) {
    vec2 base = floor(world - 0.5) + 0.5;
    vec2 f = world - base;
    taps[0] = base; taps[1] = base + vec2(1, 0); taps[2] = base + vec2(0, 1); taps[3] = base + vec2(1, 1);
    weights = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  } else {
    float o = fp * 0.25;
    taps[0] = world + vec2(-o, -o); taps[1] = world + vec2(o, -o); taps[2] = world + vec2(-o, o); taps[3] = world + vec2(o, o);
    weights = vec4(0.25);
  }

  vec3 paper = paperColor(world);
  vec3 col = vec3(0.0);
  float landW = 0.0;
  for (int i = 0; i < 4; i++) {
    uint id = idAt(taps[i]);
    vec3 c = id == 0u ? ocean : mix(paper, landColor(id, world), uPoliticalMix);
    col += c * weights[i];
    landW += id == 0u ? 0.0 : weights[i];
  }
  uint centreId = idAt(world);
  if (centreId != 0u) col = borderTint(col, centreId, world);
  outColor = vec4(finish(col, world, landW), 1.0);
}`;

// Vector province fill: the triangulated outlines from mapgen, crisp at any zoom.
export const meshVert = common + /* glsl */ `
in vec2 aPos;      // map px × uQuant
in uint aId;
uniform float uQuant;
uniform float uOffsetX;
out vec2 vWorld;
flat out uint vId;
void main() {
  vec2 world = aPos / uQuant + vec2(uOffsetX, 0.0);
  vec2 p = (world - uCenter) * uZoom;
  gl_Position = vec4(p.x / (uViewport.x * 0.5), -p.y / (uViewport.y * 0.5), 0.5, 1.0);
  vWorld = world;
  vId = aId;
}`;

export const meshFrag = landLib + /* glsl */ `
in vec2 vWorld;
flat in uint vId;
out vec4 outColor;
void main() {
  // Wrapped copies: shade in the canonical map so noise and textures line up.
  vec2 world = vec2(mod(vWorld.x, uMapSize.x), vWorld.y);
  vec3 col = mix(paperColor(world), landColor(vId, world), uPoliticalMix);
  col = borderTint(col, vId, world);
  outColor = vec4(finish(col, world, 1.0), 1.0);
}`;

// Border lines: one capsule per segment (round joins). Hard edges inside the capsule; the
// multisampled framebuffer smooths them, and a per-kind depth keeps overlapping joints from
// blending twice.
export const lineVert = common + /* glsl */ `
in vec2 aCorner;   // x: 0 = segment start, 1 = end; y: side −1/+1
in vec2 aA;
in vec2 aB;
in uvec2 aProv;    // provinces on either side (b = 0 for coasts)
uniform float uOffsetX;
out vec2 vLocal;   // device px: x along the segment from A, y across
flat out float vLen;
flat out float vWidth;
flat out int vKind;
flat out float vFade;

void main() {
  uint oa = provInfo(aProv.x).x;
  uint ob = aProv.y == 0u ? oa : provInfo(aProv.y).x;
  int kind = aProv.y == 0u ? 0 : (oa != ob ? 2 : 1);
  float zoomCss = uZoom / uDpr;
  float w;
  float fade = 1.0;
  if (kind == 0) w = mix(0.8, 1.5, clamp(zoomCss / 2.0, 0.0, 1.0));
  else if (kind == 2) w = mix(1.3, 2.8, clamp(zoomCss / 2.5, 0.0, 1.0));
  else { w = mix(0.8, 1.1, clamp(zoomCss / 4.0, 0.0, 1.0)); fade = smoothstep(0.55, 1.4, zoomCss); }
  w *= uDpr;

  vec2 a = (aA + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 b = (aB + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float r = w * 0.5 + 1.0;
  float along = aCorner.x * (len + 2.0 * r) - r;
  vec2 p = a + dir * along + n * aCorner.y * r;
  // Country borders sit above coasts, coasts above province lines.
  float z = kind == 2 ? 0.1 : (kind == 0 ? 0.2 : 0.3);
  gl_Position = vec4(p.x / (uViewport.x * 0.5), -p.y / (uViewport.y * 0.5), z * 2.0 - 1.0, 1.0);
  vLocal = vec2(along, aCorner.y * r);
  vLen = len;
  vWidth = w;
  vKind = kind;
  vFade = fade;
}`;

export const lineFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vLocal;
flat in float vLen;
flat in float vWidth;
flat in int vKind;
flat in float vFade;
out vec4 outColor;
void main() {
  float d = length(vec2(max(0.0, max(-vLocal.x, vLocal.x - vLen)), vLocal.y));
  if (d > vWidth * 0.5) discard;
  vec4 c;
  if (vKind == 2) c = vec4(0.16, 0.12, 0.09, 0.85);
  else if (vKind == 1) c = vec4(0.22, 0.18, 0.13, 0.3 * vFade);
  else c = vec4(0.13, 0.17, 0.2, 0.55);
  if (c.a < 0.01) discard;
  outColor = vec4(c.rgb * c.a, c.a); // premultiplied
}`;

// Front lines (and hold lines): crisp capsules drawn in two passes — a dark casing, then a core
// with optional marching dashes — so the core runs unbroken through every joint.
export const frontVert = common + /* glsl */ `
in vec2 aCorner;
in vec2 aA;
in vec2 aB;
in float aDist;    // map px along the arc at the segment start
uniform float uOffsetX;
uniform int uPass; // 0 casing, 1 core
uniform float uWidthK; // line width relative to a front line
out vec2 vLocal;
out float vAlong;  // device px along the arc
flat out float vLen;
flat out float vWidth;

void main() {
  float zoomCss = uZoom / uDpr;
  float casing = mix(3.2, 6.5, smoothstep(0.25, 3.0, zoomCss)) * uDpr * uWidthK;
  float w = uPass == 0 ? casing : casing * 0.52;
  vec2 a = (aA + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 b = (aB + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float r = w * 0.5 + 1.0;
  float along = aCorner.x * (len + 2.0 * r) - r;
  vec2 p = a + dir * along + n * aCorner.y * r;
  gl_Position = vec4(p.x / (uViewport.x * 0.5), -p.y / (uViewport.y * 0.5), -0.9, 1.0);
  vLocal = vec2(along, aCorner.y * r);
  vAlong = aDist * uZoom + along;
  vLen = len;
  vWidth = w;
}`;

export const frontFrag = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
uniform float uTime;  // seconds
uniform float uDpr;
uniform int uPass;
uniform vec3 uCasing;
uniform vec3 uCore;
uniform vec3 uDash;
uniform float uDashK; // 0 = no dashes
uniform float uSpeed; // dash march, CSS px per second
in vec2 vLocal;
in float vAlong;
flat in float vLen;
flat in float vWidth;
out vec4 outColor;
void main() {
  float d = length(vec2(max(0.0, max(-vLocal.x, vLocal.x - vLen)), vLocal.y));
  if (d > vWidth * 0.5) discard;
  if (uPass == 0) {
    outColor = vec4(uCasing, 1.0);
    return;
  }
  float period = max(vWidth * 4.0, 16.0 * uDpr);
  float u = fract((vAlong - uTime * uSpeed * uDpr) / period);
  float e = 1.2 * uDpr / period;
  float dash = smoothstep(0.0, e, u) * (1.0 - smoothstep(0.45, 0.45 + e, u));
  vec3 c = mix(uCore, uDash, dash * uDashK);
  outColor = vec4(c, 1.0);
}`;
