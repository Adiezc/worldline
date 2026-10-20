import { useEffect, useRef } from "react";
import { decode } from "fast-png";
import type { BordersData, MapMeta, ScenarioStart } from "@worldline/shared";
import start from "@worldline/scenarios/modern-2026/start.json";
import { MapRenderer, type Camera } from "./renderer.ts";
import { LabelLayer } from "./labelLayer.ts";
import { CounterLayer } from "./counterLayer.ts";
import { OperationLayer } from "./operationLayer.ts";
import { getTheme, theme } from "./theme.ts";
import type { WorkerRequest, WorkerResponse } from "./map.worker.ts";
import { emitMapClick, getPaintHandler, getPickHandler, publishMap, type FocusOptions, type FocusTarget, type MapController } from "./controller.ts";
import { useMap } from "../store.ts";

const MAX_ZOOM = 10;

interface Tween {
  from: Camera;
  to: Camera;
  start: number;
  duration: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function MapView() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const glCanvas = glRef.current!, labelCanvas = labelRef.current!;
    let disposed = false;
    let renderer: MapRenderer;
    const labels = new LabelLayer(labelCanvas, theme);
    const counters = new CounterLayer(labelCanvas);
    const operations = new OperationLayer(labelCanvas);
    let ids: Uint16Array | null = null;
    let meta: MapMeta | null = null;
    let dirty = true;
    // Only the 2D overlay changed (counter hover / tooltip).
    let overlayDirty = false;
    let lastTick = 0;
    let raf = 0;
    let tween: Tween | null = null;
    // Ownership as currently drawn (province id → owner index).
    let owners: Int32Array = new Int32Array(0);
    let controllers: Int32Array = new Int32Array(0);
    // Editor highlight (owner index) overriding the selection-based one.
    let highlightOwner: number | null = null;
    const worker = new Worker(new URL("./map.worker.ts", import.meta.url), { type: "module" });
    const send = (m: WorkerRequest) => worker.postMessage(m);
    const scenario = start as ScenarioStart;

    try {
      renderer = new MapRenderer(glCanvas);
      // Dev only: lets the console time and inspect the renderer.
      if (import.meta.env.DEV) (window as unknown as { __mapRenderer?: MapRenderer }).__mapRenderer = renderer;
    } catch (e) {
      useMap.setState({ status: "error", error: String(e) });
      return;
    }

    const minZoom = () => glCanvas.clientHeight / renderer.mapH;
    const clampCamera = (c: Camera) => {
      c.zoom = Math.max(minZoom(), Math.min(MAX_ZOOM, c.zoom));
      const halfH = glCanvas.clientHeight / 2 / c.zoom;
      c.cy = Math.max(halfH, Math.min(renderer.mapH - halfH, c.cy));
      c.cx = ((c.cx % renderer.mapW) + renderer.mapW) % renderer.mapW;
    };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = glCanvas.clientWidth, h = glCanvas.clientHeight;
      renderer.resize(w, h, dpr);
      labels.resize(w, h, dpr);
      if (renderer.mapH) clampCamera(renderer.camera);
      dirty = true;
    };
    const ro = new ResizeObserver(resize);
    ro.observe(glCanvas);

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (tween) {
        const t = Math.min(1, (now - tween.start) / tween.duration);
        const k = ease(t);
        const c = renderer.camera;
        // Interpolate zoom geometrically so the motion feels even.
        c.zoom = tween.from.zoom * (tween.to.zoom / tween.from.zoom) ** k;
        c.cx = tween.from.cx + (tween.to.cx - tween.from.cx) * k;
        c.cy = tween.from.cy + (tween.to.cy - tween.from.cy) * k;
        clampCamera(c);
        if (t >= 1) tween = null;
        dirty = true;
      }
      if (!ids) return;
      // Front dashes march at ~30 fps; the loop stays idle when there are no fronts.
      const tick = renderer.hasFronts && now - lastTick >= 33;
      if (tick) {
        lastTick = now;
        renderer.time = (now / 1000) % 3600;
      }
      if (dirty) {
        const st = useMap.getState();
        renderer.hover = st.hoverId;
        renderer.selected = st.selectedId;
        const so = highlightOwner ?? (st.selectedId ? owners[st.selectedId] : -1);
        renderer.selectedOwner = so >= 0 ? so : 0xffff;
      }
      if (dirty || tick) renderer.render();
      if (dirty || overlayDirty) {
        labels.draw(renderer.camera, renderer.mapW);
        operations.draw(renderer.camera);
        counters.draw(renderer.camera);
      }
      dirty = overlayDirty = false;
    };

    const unsub = useMap.subscribe((s, prev) => {
      if (s.hoverId !== prev.hoverId || s.selectedId !== prev.selectedId) dirty = true;
    });

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      if (msg.type === "loaded") void onLoaded(msg.ids, msg.width, msg.height);
      if (msg.type === "labels") {
        labels.labels = msg.labels;
        dirty = true;
      }
    };
    worker.onerror = (e) => useMap.setState({ status: "error", error: e.message });

    const metaP = fetch("/map/provinces.json").then((r) => r.json() as Promise<MapMeta>);
    const bordersP = fetch("/map/borders.json").then((r) => r.json() as Promise<BordersData>);
    const coastP = fetch("/map/coast.png").then((r) => r.arrayBuffer()).then((b) => decode(b));
    // Terrain hillshade; the map still works (flat) if it is missing or malformed.
    const reliefP = fetch("/map/relief.png")
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`relief.png: ${r.status}`))))
      .then((b) => {
        const img = decode(b);
        if (img.channels !== 1 || img.depth !== 8) throw new Error("relief.png must be 8-bit grayscale");
        return { data: img.data as Uint8Array, width: img.width, height: img.height };
      })
      .catch((e) => {
        console.warn("Terrain relief unavailable:", e);
        return null;
      });
    send({ type: "load", url: "/map/provinces.png" });

    // --- Imperative controller -------------------------------------------------------------
    const animateTo = (to: Camera, duration: number) => {
      const from = { ...renderer.camera };
      // Take the short way round the wrapped x axis.
      const W = renderer.mapW;
      let dx = to.cx - from.cx;
      dx = ((dx + W / 2) % W + W) % W - W / 2;
      tween = { from, to: { ...to, cx: from.cx + dx }, start: performance.now(), duration: Math.max(1, duration) };
      dirty = true;
    };

    const focusOn = (target: FocusTarget, opts: FocusOptions = {}) => {
      if (!meta) return;
      let list: number[];
      if (typeof target === "number") list = [target];
      else if (Array.isArray(target)) list = target;
      else {
        list = [];
        for (let id = 1; id < owners.length; id++) if (owners[id] === target.country) list.push(id);
      }
      const provs = list.map((id) => meta!.provinces[id - 1]).filter(Boolean);
      if (!provs.length) return;
      // Circular mean on x (the map wraps), pixel-weighted.
      const W = renderer.mapW;
      let sx = 0, sy = 0, wy = 0, total = 0;
      for (const p of provs) {
        const a = (p.cx / W) * Math.PI * 2;
        const w = Math.max(1, p.pixels);
        sx += Math.cos(a) * w;
        sy += Math.sin(a) * w;
        wy += p.cy * w;
        total += w;
      }
      const cx = ((Math.atan2(sy, sx) / (Math.PI * 2)) * W + W) % W;
      const cy = wy / total;
      let zoom = renderer.camera.zoom;
      const mode = opts.zoom ?? "fit";
      if (typeof mode === "number") zoom = mode;
      else if (mode === "fit") {
        let spanX = 0, spanY = 0;
        for (const p of provs) {
          const r = Math.sqrt(p.pixels) * 0.7;
          const dx = ((p.cx - cx + W / 2) % W + W) % W - W / 2;
          spanX = Math.max(spanX, Math.abs(dx) + r);
          spanY = Math.max(spanY, Math.abs(p.cy - cy) + r);
        }
        const vw = glCanvas.clientWidth, vh = glCanvas.clientHeight;
        zoom = Math.min((vw * 0.32) / Math.max(spanX, 20), (vh * 0.32) / Math.max(spanY, 20));
        zoom = Math.max(opts.minZoom ?? 0, Math.min(opts.maxZoom ?? 3, zoom));
      }
      animateTo({ cx, cy, zoom }, opts.duration ?? 700);
    };

    const controller: MapController = {
      setPalette: (colors) => {
        renderer.setPalette(colors);
        dirty = true;
      },
      setOwnership: (o, c) => {
        owners = Int32Array.from(o);
        controllers = Int32Array.from(c);
        renderer.setOwnership(o, c);
        dirty = true;
      },
      setProvince: (id, owner, ctl = owner) => {
        if (id <= 0 || id >= owners.length) return;
        owners[id] = owner;
        if (id < controllers.length) controllers[id] = ctl;
        renderer.setProvince(id, owner, ctl);
        dirty = true;
      },
      setLabelStyle: (names, colors) => {
        // Another scenario's country list: hide the old curves until the worker sends new ones,
        // so names never flash over the wrong countries.
        if (names.length !== labels.names.length) labels.labels = [];
        labels.names = names;
        labels.setColors(colors);
        dirty = true;
      },
      recomputeLabels: (o) => {
        send({ type: "labels", owners: Int32Array.from(o), nameLengths: labels.names.map((n) => n.length) });
      },
      focusOn,
      owners: () => owners,
      controllers: () => controllers,
      setFronts: (f) => {
        renderer.setFronts(f?.pairs ?? null);
        counters.set(f?.counters ?? [], renderer.mapW);
        if (!counters.hover) glCanvas.style.cursor = "";
        dirty = true;
      },
      pickCounter: (clientX, clientY) => {
        const r = labelCanvas.getBoundingClientRect();
        return counters.pickCounter(clientX - r.left, clientY - r.top);
      },
      setTheme: (id) => {
        const t = getTheme(id);
        if (renderer.theme === t) return;
        renderer.theme = t;
        labels.setTheme(t);
        dirty = true;
      },
      setHighlightOwner: (o) => {
        highlightOwner = o;
        dirty = true;
      },
      setMarked: (ids) => {
        renderer.setMarked(ids);
        dirty = true;
      },
      setClaims: (linePairs, marks) => {
        renderer.setClaimLines(linePairs);
        renderer.setClaimMarks(marks);
        dirty = true;
      },
      setOperations: (arrows, holdPairs) => {
        operations.set(arrows, renderer.mapW);
        renderer.setHoldLines(holdPairs);
        dirty = true;
      },
    };

    async function onLoaded(data: Uint16Array, width: number, height: number) {
      const [m, borders, coast, relief] = await Promise.all([metaP, bordersP, coastP, reliefP, document.fonts.load(`700 24px ${theme.labelFont}`)]);
      if (disposed) return;
      try {
        renderer.init({
          ids: data, width, height,
          coast: coast.data as Uint8Array, coastW: coast.width, coastH: coast.height,
          relief,
          borders, provinceCount: m.provinces.length,
        });
      } catch (e) {
        useMap.setState({ status: "error", error: String(e) });
        return;
      }
      meta = m;
      // Static start map until a game view takes over (the menu backdrop).
      controller.setPalette(scenario.countries.map((c) => c.color));
      controller.setOwnership(scenario.owners, scenario.controllers);
      controller.setLabelStyle(scenario.countries.map((c) => c.name), scenario.countries.map((c) => c.color));
      controller.recomputeLabels(scenario.owners);
      ids = data;
      // Open on Europe/Middle East, like a Paradox start screen.
      Object.assign(renderer.camera, { cx: 4400, cy: 1250, zoom: Math.max(minZoom(), 0.42) });
      resize();
      publishMap(controller);
      // The menu may already have picked another scenario to preview; MapSync applies it.
      useMap.setState((st) => ({ status: "ready", meta: m, scenario: st.scenario ?? scenario }));
      // Vector province outlines for crisp close-ups; loaded after the map is usable, and the
      // raster fill keeps working if it never arrives.
      fetch("/map/provinces.mesh.bin")
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`provinces.mesh.bin: ${r.status}`))))
        .then((buf) => {
          if (disposed) return;
          renderer.setMesh(buf);
          dirty = true;
        })
        .catch((e) => console.warn("Province mesh unavailable:", e));
    }

    // --- Input: drag to pan, wheel to zoom at the cursor, click to select.
    const pick = (clientX: number, clientY: number) => {
      if (!ids) return 0;
      const r = glCanvas.getBoundingClientRect();
      const c = renderer.camera;
      const x = Math.floor(c.cx + (clientX - r.left - r.width / 2) / c.zoom);
      const y = Math.floor(c.cy + (clientY - r.top - r.height / 2) / c.zoom);
      if (y < 0 || y >= renderer.mapH) return 0;
      const wx = ((x % renderer.mapW) + renderer.mapW) % renderer.mapW;
      return ids[y * renderer.mapW + wx];
    };
    let drag: { x: number; y: number; moved: boolean } | null = null;
    // Editor painting: a left-button stroke, sampled every few px so fast drags leave no gaps.
    let stroke: { x: number; y: number; last: number } | null = null;
    let spaceDown = false;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      spaceDown = e.type === "keydown";
    };
    const onDown = (e: PointerEvent) => {
      const brush = getPaintHandler();
      glCanvas.setPointerCapture(e.pointerId);
      if (brush && e.button === 0 && !spaceDown) {
        const id = pick(e.clientX, e.clientY);
        stroke = { x: e.clientX, y: e.clientY, last: id };
        brush.start(id);
        return;
      }
      drag = { x: e.clientX, y: e.clientY, moved: false };
    };
    const onMove = (e: PointerEvent) => {
      const brush = getPaintHandler();
      if (stroke && brush) {
        const dx = e.clientX - stroke.x, dy = e.clientY - stroke.y;
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 4));
        for (let i = 1; i <= steps; i++) {
          const id = pick(stroke.x + (dx * i) / steps, stroke.y + (dy * i) / steps);
          if (id !== stroke.last) {
            stroke.last = id;
            brush.move(id);
          }
        }
        stroke.x = e.clientX;
        stroke.y = e.clientY;
      }
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          tween = null;
          const c = renderer.camera;
          c.cx -= dx / c.zoom;
          c.cy -= dy / c.zoom;
          clampCamera(c);
          drag.x = e.clientX;
          drag.y = e.clientY;
          dirty = true;
        }
      }
      // Troop counters take the hover (and draw their own tooltip) over the province below.
      const counter = drag?.moved || stroke ? null : controller.pickCounter(e.clientX, e.clientY);
      if (counter || counters.hover) {
        const r = labelCanvas.getBoundingClientRect();
        counters.hover = counter ? { counter, x: e.clientX - r.left, y: e.clientY - r.top } : null;
        glCanvas.style.cursor = counter ? "help" : "";
        overlayDirty = true;
      }
      const id = drag?.moved || counter ? 0 : pick(e.clientX, e.clientY);
      useMap.setState({ pointer: { x: e.clientX, y: e.clientY } });
      if (id !== useMap.getState().hoverId) useMap.getState().setHover(id);
    };
    const onUp = (e: PointerEvent) => {
      if (stroke) {
        stroke = null;
        getPaintHandler()?.end();
        return;
      }
      if (drag && !drag.moved && e.button === 0 && !getPaintHandler()) {
        const id = pick(e.clientX, e.clientY);
        // Picking regions for a proposal leaves the selection alone.
        if (!getPickHandler()) useMap.getState().setSelected(id);
        emitMapClick(id);
      }
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      tween = null;
      const c = renderer.camera;
      const r = glCanvas.getBoundingClientRect();
      const mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2;
      const before = { x: c.cx + mx / c.zoom, y: c.cy + my / c.zoom };
      c.zoom *= Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      clampCamera(c);
      c.cx = before.x - mx / c.zoom;
      c.cy = before.y - my / c.zoom;
      clampCamera(c);
      dirty = true;
    };
    const onLeave = () => {
      useMap.getState().setHover(0);
      if (counters.hover) {
        counters.hover = null;
        glCanvas.style.cursor = "";
        overlayDirty = true;
      }
    };
    const onContext = (e: MouseEvent) => {
      if (getPaintHandler()) e.preventDefault();
    };
    const onCancel = () => {
      if (stroke) {
        stroke = null;
        getPaintHandler()?.end();
      }
      drag = null;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    glCanvas.addEventListener("contextmenu", onContext);
    glCanvas.addEventListener("pointercancel", onCancel);
    glCanvas.addEventListener("pointerdown", onDown);
    glCanvas.addEventListener("pointermove", onMove);
    glCanvas.addEventListener("pointerup", onUp);
    glCanvas.addEventListener("pointerleave", onLeave);
    glCanvas.addEventListener("wheel", onWheel, { passive: false });
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      publishMap(null);
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      worker.terminate();
      glCanvas.removeEventListener("pointerdown", onDown);
      glCanvas.removeEventListener("pointermove", onMove);
      glCanvas.removeEventListener("pointerup", onUp);
      glCanvas.removeEventListener("pointerleave", onLeave);
      glCanvas.removeEventListener("wheel", onWheel);
      glCanvas.removeEventListener("contextmenu", onContext);
      glCanvas.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={glRef} className="absolute inset-0 h-full w-full touch-none" />
      <canvas ref={labelRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
