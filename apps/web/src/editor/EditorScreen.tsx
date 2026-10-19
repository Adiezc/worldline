// Scenario editor (/editor[/:baseScenarioId]): repaint ownership on the live map, edit nations
// and the diplomatic web, then publish to the server or export JSON.
import { useEffect, useState, type ReactNode } from "react";
import type { ScenarioInfo } from "@worldline/shared";
import { getMap, setPaintHandler } from "../map/controller.ts";
import { useMap, provinceName } from "../store.ts";
import { DEFAULT_SCENARIO, listScenarios } from "../net/scenarios.ts";
import { editorPath, navigate } from "../router.ts";
import { Button, ConfirmDialog, Spinner, Swatch } from "../ui/common/ui.tsx";
import { Icon, type IconName } from "../ui/common/Icon.tsx";
import {
  applyTool, beginStroke, endStroke, exportJson, loadBase, redo, redrawAll, resetEditor, setTool, undo, useEditor, type Tool,
} from "./editorStore.ts";
import { NationsPanel } from "./NationsPanel.tsx";
import { InspectorPanel } from "./InspectorPanel.tsx";
import { SaveDialog } from "./SaveDialog.tsx";

const TOOLS: { id: Tool; icon: IconName; label: string; key: string; hint: string }[] = [
  { id: "paint", icon: "brush", label: "Paint", key: "B", hint: "Click or drag to give regions to the selected nation" },
  { id: "erase", icon: "eraser", label: "Erase", key: "E", hint: "Click or drag to make regions unowned" },
  { id: "fill", icon: "bucket", label: "Fill country", key: "F", hint: "Click a region: all of its owner's land goes to the selected nation" },
  { id: "pick", icon: "eyedropper", label: "Eyedropper", key: "I", hint: "Click a region to select its owner" },
];

const isTyping = (el: EventTarget | null) => {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
};

export function EditorScreen({ base }: { base: string | null }) {
  const baseId = base ?? DEFAULT_SCENARIO;
  const mapReady = useMap((s) => s.status === "ready");
  const status = useEditor((s) => s.status);
  const error = useEditor((s) => s.error);
  const selected = useEditor((s) => s.selected);
  const dirty = useEditor((s) => s.dirty);

  // Take over the map: painting replaces click-to-select, MapSync stands aside.
  useEffect(() => {
    useMap.setState({ editing: true });
    useMap.getState().setSelected(0);
    document.body.classList.add("editor-mode");
    setPaintHandler({
      start: (id) => {
        beginStroke();
        applyTool(id, true);
      },
      move: (id) => applyTool(id, false),
      end: endStroke,
    });
    return () => {
      setPaintHandler(null);
      getMap()?.setHighlightOwner(null);
      document.body.classList.remove("editor-mode");
      resetEditor();
      useMap.setState({ editing: false });
    };
  }, []);

  useEffect(() => {
    void loadBase(baseId);
  }, [baseId]);

  // The map may finish loading after the seed (direct link to /editor).
  useEffect(() => {
    if (mapReady && status === "ready") redrawAll();
  }, [mapReady, status]);

  useEffect(() => {
    if (mapReady) getMap()?.setHighlightOwner(selected >= 0 ? selected : null);
  }, [mapReady, selected]);

  // Shortcuts: undo/redo and tool keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && k === "y") {
        e.preventDefault();
        redo();
      } else if (!mod && !e.altKey) {
        const tool = TOOLS.find((t) => t.key.toLowerCase() === k);
        if (tool) setTool(tool.id);
        else if (k === "escape") useEditor.setState({ selected: -1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Unsaved work: ask before closing the tab.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <EditorTopBar baseId={baseId} />
      {status === "ready" && (
        <>
          <Notice />
          <div className="absolute top-[68px] bottom-3 left-3 w-[292px]">
            <NationsPanel />
          </div>
          <div className="absolute top-[68px] right-3 bottom-3 w-[318px]">
            <InspectorPanel />
          </div>
          <HoverBar />
        </>
      )}
      {(status === "loading" || status === "idle") && (
        <Centered>
          <Spinner className="h-5 w-5 text-gold" />
          <p className="mt-3 font-display text-sm tracking-[0.2em] text-parchment/80 uppercase">Unrolling the base scenario…</p>
        </Centered>
      )}
      {status === "error" && (
        <Centered>
          <h2 className="font-display text-lg tracking-[0.15em] text-gold-bright">Could not load the scenario</h2>
          <p className="mt-2 text-sm text-parchment/70">{error}</p>
          <div className="mt-5 flex justify-center gap-2">
            <Button variant="ghost" onClick={() => navigate("/")}>
              Main menu
            </Button>
            {baseId !== DEFAULT_SCENARIO && (
              <Button variant="secondary" onClick={() => navigate(editorPath(DEFAULT_SCENARIO), true)}>
                Start from Modern Day
              </Button>
            )}
            <Button variant="primary" icon="refresh" onClick={() => void loadBase(baseId)}>
              Try again
            </Button>
          </div>
        </Centered>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-auto absolute inset-0 grid place-items-center bg-black/40">
      <div className="hud-panel w-[min(440px,calc(100%-2rem))] p-6 text-center">{children}</div>
    </div>
  );
}

function EditorTopBar({ baseId }: { baseId: string }) {
  const seed = useEditor((s) => s.seed);
  const tool = useEditor((s) => s.tool);
  const selected = useEditor((s) => s.selected);
  const canUndo = useEditor((s) => s.undo.length > 0);
  const canRedo = useEditor((s) => s.redo.length > 0);
  const dirty = useEditor((s) => s.dirty);
  const savedId = useEditor((s) => s.savedId);
  const [bases, setBases] = useState<ScenarioInfo[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [leave, setLeave] = useState<null | (() => void)>(null);
  const brush = seed && selected >= 0 ? seed.countries[selected] : null;

  useEffect(() => {
    void listScenarios().then((r) => setBases(r.list));
  }, []);

  const guard = (fn: () => void) => (dirty ? setLeave(() => fn) : fn());

  return (
    <>
      <div className="hud-panel pointer-events-auto absolute inset-x-3 top-3 flex h-[46px] items-center gap-2.5 px-2.5">
        <button onClick={() => guard(() => navigate("/"))} title="Main menu" className="grid h-8 w-8 shrink-0 place-items-center rounded border border-panel-edge/70 font-display text-lg text-gold hover:text-gold-bright">
          W
        </button>
        <div className="flex min-w-0 flex-col leading-none">
          <span className="font-display text-[13.5px] tracking-[0.16em] text-gold-bright">Scenario Editor</span>
          <span className="mt-1 truncate text-[10.5px] text-parchment/45">{dirty ? "Unsaved changes" : savedId ? "Saved" : "No changes yet"}</span>
        </div>
        <span className="h-7 w-px shrink-0 bg-panel-edge/70" />
        <label className="flex min-w-0 items-center gap-1.5" title="The scenario you start from">
          <span className="hud-label shrink-0">Base</span>
          <select
            className="hud-input h-8 w-[170px] py-0 text-[12px]"
            value={baseId}
            onChange={(e) => {
              const id = e.target.value;
              guard(() => navigate(editorPath(id), true));
            }}
          >
            {(bases ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
                {b.custom ? ` (by ${b.author ?? "player"})` : ""}
              </option>
            ))}
            {!bases?.some((b) => b.id === baseId) && <option value={baseId}>{seed?.name ?? baseId}</option>}
          </select>
        </label>
        <span className="h-7 w-px shrink-0 bg-panel-edge/70" />

        <div className="flex items-center gap-1" role="toolbar" aria-label="Tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key}) — ${t.hint}`}
              aria-pressed={tool === t.id}
              className={`grid h-8 w-8 place-items-center rounded border transition-colors ${tool === t.id ? "border-gold bg-gold/15 text-gold-bright" : "border-panel-edge/60 text-parchment/60 hover:border-gold/50 hover:text-parchment"}`}
            >
              <Icon name={t.icon} size={16} />
            </button>
          ))}
        </div>
        <div className="flex h-8 min-w-0 max-w-[170px] items-center gap-1.5 rounded border border-panel-edge/50 bg-black/25 px-2" title="Brush: the selected nation">
          {brush ? (
            <>
              <Swatch color={brush.color} size={12} />
              <span className="truncate text-[12px] text-parchment/85">{brush.name}</span>
            </>
          ) : (
            <span className="truncate text-[11.5px] text-parchment/40 italic">Pick a nation</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={undo} disabled={!canUndo} title="Undo stroke (Ctrl/⌘+Z)" className="grid h-8 w-8 place-items-center rounded text-parchment/65 hover:bg-white/5 hover:text-parchment disabled:opacity-30">
            <Icon name="undo" size={16} />
          </button>
          <button onClick={redo} disabled={!canRedo} title="Redo stroke (Shift+Ctrl/⌘+Z)" className="grid h-8 w-8 place-items-center rounded text-parchment/65 hover:bg-white/5 hover:text-parchment disabled:opacity-30">
            <Icon name="redo" size={16} />
          </button>
        </div>

        <div className="flex-1" />
        <Button variant="ghost" icon="download" disabled={!seed} onClick={() => seed && exportJson(seed, savedId)} title="Download the scenario seed as JSON">
          Export JSON
        </Button>
        <Button variant="primary" icon="save" disabled={!seed} onClick={() => setSaving(true)}>
          Save
        </Button>
      </div>
      {saving && seed && <SaveDialog onClose={() => setSaving(false)} />}
      {leave && (
        <ConfirmDialog
          title="Discard your changes?"
          confirmLabel="Discard"
          tone="danger"
          onCancel={() => setLeave(null)}
          onConfirm={() => {
            const fn = leave;
            setLeave(null);
            useEditor.setState({ dirty: false });
            fn();
          }}
        >
          Your edits to this scenario have not been saved. Export JSON or save first if you want to keep them.
        </ConfirmDialog>
      )}
    </>
  );
}

function Notice() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="pointer-events-none absolute top-[66px] right-[340px] left-[314px] flex justify-center">
      <div className="pointer-events-auto flex max-w-[560px] items-start gap-2 rounded border border-partial/50 bg-panel/95 px-3 py-1.5 text-[11.5px] text-[#f1d39a] shadow-lg">
        <Icon name="info" size={13} className="mt-px" />
        <span className="min-w-0 flex-1">{notice}</span>
        <button onClick={() => useEditor.setState({ notice: undefined })} className="text-parchment/40 hover:text-parchment" aria-label="Dismiss">
          <Icon name="close" size={11} />
        </button>
      </div>
    </div>
  );
}

/** Bottom strip: what's under the cursor, and how the current tool works. */
function HoverBar() {
  const hoverId = useMap((s) => s.hoverId);
  const tool = useEditor((s) => s.tool);
  const ownerIdx = useEditor((s) => (hoverId && s.seed ? s.seed.owners[hoverId] : -2));
  const ctlIdx = useEditor((s) => (hoverId && s.seed ? s.seed.controllers[hoverId] : -2));
  const owner = useEditor((s) => (ownerIdx >= 0 ? s.seed?.countries[ownerIdx] : undefined));
  const ctl = useEditor((s) => (ctlIdx >= 0 && ctlIdx !== ownerIdx ? s.seed?.countries[ctlIdx] : undefined));
  const t = TOOLS.find((x) => x.id === tool)!;

  return (
    <div className="pointer-events-none absolute right-[340px] bottom-3 left-[314px] flex justify-center">
      <div className="hud-panel flex h-9 max-w-full min-w-0 items-center gap-3 overflow-hidden px-3.5 text-[12px] whitespace-nowrap">
        {hoverId ? (
          <>
            <span className="max-w-[200px] truncate font-display text-[13px] text-parchment">{provinceName(hoverId)}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-parchment/65">
              {owner ? <Swatch color={owner.color} size={10} /> : <span className="h-2.5 w-2.5 rounded-sm border border-parchment/30" />}
              <span className="truncate">{owner?.name ?? "Unowned"}</span>
            </span>
            {ctl && <span className="truncate text-[11px] text-red-300/85">occupied by {ctl.name}</span>}
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-1.5 truncate text-parchment/55">
            <Icon name={t.icon} size={13} className="text-gold/80" /> {t.hint}
          </span>
        )}
        <span className="h-4 w-px shrink-0 bg-panel-edge/70" />
        <span className="hidden shrink-0 text-[10.5px] text-parchment/40 xl:inline">Right-drag or Space+drag to pan · wheel to zoom</span>
      </div>
    </div>
  );
}
