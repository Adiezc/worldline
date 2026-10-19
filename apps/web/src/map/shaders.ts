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

export const fillFrag = common + /* glsl */ `
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

in vec2 vClip;
out vec4 outColor;

ivec2 wrapTexel(vec2 p) {
  int w = int(uMapSize.x);
  int x = int(floor(p.x)) % w;
  if (x < 0) x += w;
  return ivec2(x, clamp(int(floor(p.y)), 0, int(uMapSize.y) - 1));
}
uint idAt(vec2 p) { return texelFetch(uIds, wrapTexel(p), 0).r; }

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { return noise(p) * 0.5 + noise(p * 2.03) * 0.25 + noise(p * 4.1) * 0.125 + noise(p * 8.3) * 0.0625; }

vec3 countryColor(uint owner) {
  if (owner == NONE) return vec3(0.62, 0.6, 0.55);
  return texelFetch(uPalette, ivec2(int(owner), 0), 0).rgb;
}

vec3 landColor(uint id, vec2 world) {
  uvec2 info = provInfo(id);
  vec3 c = countryColor(info.x);
  if (info.y != info.x) {
    // Occupation: diagonal stripes in the controller's colour.
    float s = step(0.5, fract((world.x + world.y) / 7.0));
    c = mix(c, countryColor(info.y), s * 0.85);
  }
  if (id == uSelected) c = mix(c, vec3(1.0), 0.28);
  else if (id == uHover) c = mix(c, vec3(1.0), 0.14);
  else if (uSelOwner != NONE && info.x == uSelOwner) c = mix(c, vec3(1.0), 0.06);
  return c;
}

vec3 oceanColor(vec2 world) {
  // Flat sea with a faint texture; lighter coastal water read as a glow around the land.
  return uOceanDeep + (fbm(world * 0.02) - 0.5) * 0.045;
}

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

void main() {
  vec2 screen = vec2(vClip.x, -vClip.y) * 0.5 * uViewport;
  vec2 world = uCenter + screen / uZoom;
  if (world.y < 0.0 || world.y >= uMapSize.y) {
    outColor = vec4(uOceanDeep * 0.75, 1.0);
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

  vec3 ocean = oceanColor(world);
  float grain = fbm(world * 0.35) - 0.5;
  vec3 paper = uPaper + grain * 0.06;
  vec3 col = vec3(0.0);
  float landW = 0.0;
  uint centreId = idAt(world);
  for (int i = 0; i < 4; i++) {
    uint id = idAt(taps[i]);
    vec3 c = id == 0u ? ocean : mix(paper, landColor(id, world), uPoliticalMix);
    col += c * weights[i];
    landW += id == 0u ? 0.0 : weights[i];
  }

  if (centreId != 0u) {
    // Inward border gradient: how much of a ring around us belongs to someone else.
    uint me = ownerOf(centreId);
    float r = clamp(7.0 * fp, 1.2, 28.0);
    float other = 0.0;
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.785398;
      vec2 d = vec2(cos(a), sin(a));
      uint o1 = ownerOf(idAt(world + d * r));
      uint o2 = ownerOf(idAt(world + d * r * 0.45));
      other += (o1 != me && o1 != NONE - 1u ? 0.6 : 0.0) + (o2 != me && o2 != NONE - 1u ? 0.4 : 0.0);
    }
    float edge = clamp(other / 4.0, 0.0, 1.0);
    vec3 strong = countryColor(me) * 0.72;
    col = mix(col, strong, edge * 0.55);
    // Gentle inland darkening keeps continents from looking flat at world scale.
    float inland = texture(uCoast, world / uMapSize).r;
    col *= 1.0 - smoothstep(0.5, 1.0, inland) * 0.05;
  }

  // Terrain relief (Victoria 3 style): a hillshade multiplied under the political colour.
  // Sampled outside any branch so screen-space derivatives stay defined for the ink contour.
  float shade = reliefAt(world / uMapSize) - 206.0 / 255.0;
  // Soft-clip the extremes so deep shadows never go black.
  shade = shade / (1.0 + abs(shade) * 1.2);
  float contour = abs(shade + 0.12) / max(fwidth(shade), 1e-4);
  if (landW > 0.0) {
    float zoomCss = uZoom / max(uDpr, 1.0);
    // Subtle at world scale so political colours stay readable, stronger at regional zoom,
    // easing off again up close where the half-resolution hillshade would look smeared.
    float k = uReliefK * mix(1.15, 1.9, smoothstep(0.35, 2.0, zoomCss)) * mix(1.0, 0.72, smoothstep(3.0, 8.0, zoomCss));
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

  outColor = vec4(col, 1.0);
}`;

export const lineVert = common + /* glsl */ `
in vec2 aCorner;   // x: 0 = segment start, 1 = end; y: side −1/+1
in vec2 aA;
in vec2 aB;
in uvec2 aProv;    // provinces on either side (b = 0 for coasts)
uniform float uOffsetX;
out float vSide;
out float vWidth;
flat out int vKind;
out float vFade;

void main() {
  uint oa = provInfo(aProv.x).x;
  uint ob = aProv.y == 0u ? oa : provInfo(aProv.y).x;
  int kind = aProv.y == 0u ? 0 : (oa != ob ? 2 : 1);
  float zoomCss = uZoom / uDpr;
  float w;
  float fade = 1.0;
  if (kind == 0) w = mix(0.7, 1.4, clamp(zoomCss / 2.0, 0.0, 1.0));
  else if (kind == 2) w = mix(1.2, 2.6, clamp(zoomCss / 2.5, 0.0, 1.0));
  else { w = 0.9; fade = smoothstep(0.55, 1.4, zoomCss); }
  w *= uDpr;

  vec2 a = (aA + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 b = (aB + vec2(uOffsetX, 0.0) - uCenter) * uZoom;
  vec2 dir = b - a;
  float len = length(dir);
  dir = len > 0.0 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  float half_ = w * 0.5 + 1.0; // +1px for antialiasing
  vec2 p = mix(a, b, aCorner.x) + n * aCorner.y * half_ + dir * (aCorner.x * 2.0 - 1.0) * w * 0.5;
  gl_Position = vec4(p.x / (uViewport.x * 0.5), -p.y / (uViewport.y * 0.5), 0.0, 1.0);
  vSide = aCorner.y * half_;
  vWidth = w;
  vKind = kind;
  vFade = fade;
}`;

export const lineFrag = /* glsl */ `#version 300 es
precision highp float;
in float vSide;
in float vWidth;
flat in int vKind;
in float vFade;
out vec4 outColor;
void main() {
  float a = clamp(vWidth * 0.5 - abs(vSide) + 0.5, 0.0, 1.0);
  vec4 c;
  if (vKind == 2) c = vec4(0.16, 0.12, 0.09, 0.82);
  else if (vKind == 1) c = vec4(0.22, 0.18, 0.13, 0.28 * vFade);
  else c = vec4(0.13, 0.17, 0.2, 0.55);
  outColor = vec4(c.rgb, c.a * a);
  outColor.rgb *= outColor.a; // premultiplied
}`;
