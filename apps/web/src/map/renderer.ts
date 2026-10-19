import { BORDER_QUANT, type BordersData } from "@worldline/shared";
import { fillFrag, fillVert, lineFrag, lineVert } from "./shaders.ts";
import { theme, type MapTheme } from "./theme.ts";

export interface Camera {
  /** Map px at the centre of the screen. */
  cx: number;
  cy: number;
  /** CSS px per map px. */
  zoom: number;
}

const PROV_TEX_W = 64;
const PALETTE_W = 1024;
const NONE = 0xffff;

/** WebGL2 political map: a full-screen fill pass plus instanced border lines. */
export class MapRenderer {
  readonly gl: WebGL2RenderingContext;
  camera: Camera = { cx: 4096, cy: 1600, zoom: 0.25 };
  mapW = 0;
  mapH = 0;
  private fillProg!: WebGLProgram;
  private lineProg!: WebGLProgram;
  private fillVao!: WebGLVertexArrayObject;
  private lineVao!: WebGLVertexArrayObject;
  private lineCount = 0;
  private provTex!: WebGLTexture;
  private provData!: Uint16Array;
  private provRows = 0;
  private paletteTex!: WebGLTexture;
  private idTex!: WebGLTexture;
  private coastTex!: WebGLTexture;
  private uniforms = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();
  hover = 0;
  selected = 0;
  selectedOwner = NONE;
  theme: MapTheme = theme;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: false });
    if (!gl) throw new Error("WebGL2 is not available in this browser");
    this.gl = gl;
  }

  init(opts: { ids: Uint16Array; width: number; height: number; coast: Uint8Array; coastW: number; coastH: number; borders: BordersData; provinceCount: number }) {
    const gl = this.gl;
    this.mapW = opts.width;
    this.mapH = opts.height;
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (max < opts.width) throw new Error(`GPU max texture size ${max} < ${opts.width}`);

    this.fillProg = program(gl, fillVert, fillFrag);
    this.lineProg = program(gl, lineVert, lineFrag);
    this.fillVao = gl.createVertexArray()!;

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.idTex = texture(gl, gl.R16UI, opts.width, opts.height, gl.RED_INTEGER, gl.UNSIGNED_SHORT, opts.ids, gl.NEAREST);
    this.coastTex = texture(gl, gl.R8, opts.coastW, opts.coastH, gl.RED, gl.UNSIGNED_BYTE, opts.coast, gl.LINEAR);

    this.provRows = Math.ceil((opts.provinceCount + 1) / PROV_TEX_W);
    this.provData = new Uint16Array(PROV_TEX_W * this.provRows * 2).fill(NONE);
    this.provTex = texture(gl, gl.RG16UI, PROV_TEX_W, this.provRows, gl.RG_INTEGER, gl.UNSIGNED_SHORT, this.provData, gl.NEAREST);
    this.paletteTex = texture(gl, gl.RGBA8, PALETTE_W, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(PALETTE_W * 4), gl.NEAREST);

    this.buildLines(opts.borders);
  }

  /** Instanced quads: one instance per border segment, tagged with the provinces on each side. */
  private buildLines(borders: BordersData) {
    const gl = this.gl;
    let segs = 0;
    for (const arc of borders.arcs) segs += arc.pts.length / 2 - 1;
    const pos = new Float32Array(segs * 4);
    const prov = new Uint16Array(segs * 2);
    let k = 0;
    for (const arc of borders.arcs) {
      const p = arc.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        pos.set([p[i] / BORDER_QUANT, p[i + 1] / BORDER_QUANT, p[i + 2] / BORDER_QUANT, p[i + 3] / BORDER_QUANT], k * 4);
        prov[k * 2] = arc.a;
        prov[k * 2 + 1] = arc.b;
        k++;
      }
    }
    this.lineCount = segs;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const prog = this.lineProg;

    const corner = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 0, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const locCorner = gl.getAttribLocation(prog, "aCorner");
    gl.enableVertexAttribArray(locCorner);
    gl.vertexAttribPointer(locCorner, 2, gl.FLOAT, false, 0, 0);

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
    const locA = gl.getAttribLocation(prog, "aA"), locB = gl.getAttribLocation(prog, "aB");
    gl.enableVertexAttribArray(locA);
    gl.vertexAttribPointer(locA, 2, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(locA, 1);
    gl.enableVertexAttribArray(locB);
    gl.vertexAttribPointer(locB, 2, gl.FLOAT, false, 16, 8);
    gl.vertexAttribDivisor(locB, 1);

    const provBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, provBuf);
    gl.bufferData(gl.ARRAY_BUFFER, prov, gl.STATIC_DRAW);
    const locP = gl.getAttribLocation(prog, "aProv");
    gl.enableVertexAttribArray(locP);
    gl.vertexAttribIPointer(locP, 2, gl.UNSIGNED_SHORT, 0, 0);
    gl.vertexAttribDivisor(locP, 1);

    gl.bindVertexArray(null);
    this.lineVao = vao;
  }

  setPalette(colors: string[]) {
    const data = new Uint8Array(PALETTE_W * 4);
    colors.forEach((hex, i) => {
      data[i * 4] = parseInt(hex.slice(1, 3), 16);
      data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
      data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
      data[i * 4 + 3] = 255;
    });
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_W, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
  }

  /** Full ownership upload (owner/controller index per province id, -1 = none). */
  setOwnership(owners: ArrayLike<number>, controllers: ArrayLike<number>) {
    for (let id = 0; id < owners.length; id++) {
      this.provData[id * 2] = owners[id] < 0 ? NONE : owners[id];
      this.provData[id * 2 + 1] = controllers[id] < 0 ? NONE : controllers[id];
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.provTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PROV_TEX_W, this.provRows, gl.RG_INTEGER, gl.UNSIGNED_SHORT, this.provData);
  }

  /** A province changing hands is a single texel write. */
  setProvince(id: number, owner: number, controller = owner) {
    const texel = new Uint16Array([owner < 0 ? NONE : owner, controller < 0 ? NONE : controller]);
    this.provData.set(texel, id * 2);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.provTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, id % PROV_TEX_W, Math.floor(id / PROV_TEX_W), 1, 1, gl.RG_INTEGER, gl.UNSIGNED_SHORT, texel);
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
  }

  render() {
    const gl = this.gl;
    const dpr = this.canvas.width / Math.max(1, this.canvas.clientWidth);
    const vw = this.canvas.width, vh = this.canvas.height;
    gl.viewport(0, 0, vw, vh);
    const t = this.theme;

    // Fill pass.
    gl.disable(gl.BLEND);
    gl.useProgram(this.fillProg);
    this.bindCommon(this.fillProg, dpr);
    this.bindTex(this.fillProg, "uIds", this.idTex, 2);
    this.bindTex(this.fillProg, "uCoast", this.coastTex, 3);
    const u = (n: string) => this.loc(this.fillProg, n);
    gl.uniform1ui(u("uHover"), this.hover);
    gl.uniform1ui(u("uSelected"), this.selected);
    gl.uniform1ui(u("uSelOwner"), this.selectedOwner);
    gl.uniform3fv(u("uPaper"), t.paper);
    gl.uniform3fv(u("uOceanDeep"), t.oceanDeep);
    gl.uniform1f(u("uPoliticalMix"), t.politicalMix);
    gl.bindVertexArray(this.fillVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Border lines, drawn for each horizontal wrap copy that may be visible.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.lineProg);
    this.bindCommon(this.lineProg, dpr);
    gl.uniform1f(this.loc(this.lineProg, "uDpr"), dpr);
    gl.bindVertexArray(this.lineVao);
    const halfW = vw / 2 / (this.camera.zoom * dpr);
    for (const off of [-this.mapW, 0, this.mapW]) {
      if (this.camera.cx + halfW < off || this.camera.cx - halfW > off + this.mapW) continue;
      gl.uniform1f(this.loc(this.lineProg, "uOffsetX"), off);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lineCount);
    }
    gl.bindVertexArray(null);
  }

  private bindCommon(prog: WebGLProgram, dpr: number) {
    const gl = this.gl;
    gl.uniform2f(this.loc(prog, "uCenter"), this.camera.cx, this.camera.cy);
    gl.uniform1f(this.loc(prog, "uZoom"), this.camera.zoom * dpr);
    gl.uniform2f(this.loc(prog, "uViewport"), this.canvas.width, this.canvas.height);
    gl.uniform2f(this.loc(prog, "uMapSize"), this.mapW, this.mapH);
    gl.uniform1i(this.loc(prog, "uMode"), 0);
    this.bindTex(prog, "uProv", this.provTex, 0);
    this.bindTex(prog, "uPalette", this.paletteTex, 1);
  }

  private bindTex(prog: WebGLProgram, name: string, tex: WebGLTexture, unit: number) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.loc(prog, name), unit);
  }

  private loc(prog: WebGLProgram, name: string) {
    let m = this.uniforms.get(prog);
    if (!m) this.uniforms.set(prog, (m = new Map()));
    if (!m.has(name)) m.set(name, this.gl.getUniformLocation(prog, name));
    return m.get(name)!;
  }
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const compile = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader error");
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? "link error");
  return p;
}

function texture(
  gl: WebGL2RenderingContext,
  internal: number,
  w: number,
  h: number,
  format: number,
  type: number,
  data: ArrayBufferView,
  filter: number,
) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
  return tex;
}
