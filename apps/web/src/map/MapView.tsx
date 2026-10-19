import { useEffect, useRef } from "react";
import { decode } from "fast-png";
import type { BordersData, MapMeta, ScenarioStart } from "@worldline/shared";
import start from "@worldline/scenarios/modern-2026/start.json";
import { MapRenderer, type Camera } from "./renderer.ts";
import { LabelLayer } from "./labelLayer.ts";
import { theme } from "./theme.ts";
import type { WorkerRequest, WorkerResponse } from "./map.worker.ts";
import { useMap } from "../store.ts";

const MAX_ZOOM = 10;

export function MapView() {
  const glRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const glCanvas = glRef.current!, labelCanvas = labelRef.current!;
    let disposed = false;
    let renderer: MapRenderer;
    const labels = new LabelLayer(labelCanvas, theme);
    let ids: Uint16Array | null = null;
    let dirty = true;
    let raf = 0;
    const worker = new Worker(new URL("./map.worker.ts", import.meta.url), { type: "module" });
    const send = (m: WorkerRequest) => worker.postMessage(m);
    const scenario = start as ScenarioStart;

    try {
      renderer = new MapRenderer(glCanvas);
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

    const frame = () => {
      raf = requestAnimationFrame(frame);
      if (!dirty || !ids) return;
      dirty = false;
      const st = useMap.getState();
      renderer.hover = st.hoverId;
      renderer.selected = st.selectedId;
      renderer.selectedOwner = st.selectedId ? Math.max(0, scenario.owners[st.selectedId]) : 0xffff;
      renderer.render();
      labels.draw(renderer.camera, renderer.mapW);
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
    send({ type: "load", url: "/map/provinces.png" });

    async function onLoaded(data: Uint16Array, width: number, height: number) {
      const [meta, borders, coast] = await Promise.all([metaP, bordersP, coastP, document.fonts.load(`700 24px ${theme.labelFont}`)]);
      if (disposed) return;
      try {
        renderer.init({
          ids: data, width, height,
          coast: coast.data as Uint8Array, coastW: coast.width, coastH: coast.height,
          borders, provinceCount: meta.provinces.length,
        });
      } catch (e) {
        useMap.setState({ status: "error", error: String(e) });
        return;
      }
      renderer.setPalette(scenario.countries.map((c) => c.color));
      renderer.setOwnership(scenario.owners, scenario.controllers);
      labels.names = scenario.countries.map((c) => c.name);
      labels.setColors(scenario.countries.map((c) => c.color));
      send({ type: "labels", owners: Int32Array.from(scenario.owners), nameLengths: labels.names.map((n) => n.length) });
      ids = data;
      // Open on Europe/Middle East, like a Paradox start screen.
      Object.assign(renderer.camera, { cx: 4400, cy: 1250, zoom: Math.max(minZoom(), 0.42) });
      resize();
      useMap.setState({ status: "ready", meta, scenario });
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
    const onDown = (e: PointerEvent) => {
      drag = { x: e.clientX, y: e.clientY, moved: false };
      glCanvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.moved) {
          const c = renderer.camera;
          c.cx -= dx / c.zoom;
          c.cy -= dy / c.zoom;
          clampCamera(c);
          drag.x = e.clientX;
          drag.y = e.clientY;
          dirty = true;
        }
      }
      const id = drag?.moved ? 0 : pick(e.clientX, e.clientY);
      useMap.setState({ pointer: { x: e.clientX, y: e.clientY } });
      if (id !== useMap.getState().hoverId) useMap.getState().setHover(id);
    };
    const onUp = (e: PointerEvent) => {
      if (drag && !drag.moved) useMap.getState().setSelected(pick(e.clientX, e.clientY));
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
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
    const onLeave = () => useMap.getState().setHover(0);
    glCanvas.addEventListener("pointerdown", onDown);
    glCanvas.addEventListener("pointermove", onMove);
    glCanvas.addEventListener("pointerup", onUp);
    glCanvas.addEventListener("pointerleave", onLeave);
    glCanvas.addEventListener("wheel", onWheel, { passive: false });
    raf = requestAnimationFrame(frame);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      unsub();
      worker.terminate();
      glCanvas.removeEventListener("pointerdown", onDown);
      glCanvas.removeEventListener("pointermove", onMove);
      glCanvas.removeEventListener("pointerup", onUp);
      glCanvas.removeEventListener("pointerleave", onLeave);
      glCanvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas ref={glRef} className="absolute inset-0 h-full w-full touch-none" />
      <canvas ref={labelRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
}
