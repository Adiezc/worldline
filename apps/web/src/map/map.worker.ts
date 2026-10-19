// Off-main-thread map work: decodes the 16-bit province bitmap and (re)computes country labels.
import { decode } from "fast-png";
import { computeLabels, type LabelCurve } from "@worldline/shared";

export type WorkerRequest =
  | { type: "load"; url: string }
  | { type: "labels"; owners: Int32Array; nameLengths: number[]; only?: number[] };

export type WorkerResponse =
  | { type: "loaded"; width: number; height: number; ids: Uint16Array }
  | { type: "labels"; labels: LabelCurve[]; only?: number[] };

const GRID_SCALE = 4;
let ids: Uint16Array | null = null;
let width = 0;
let height = 0;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === "load") {
    const buf = await (await fetch(msg.url)).arrayBuffer();
    const img = decode(buf);
    if (img.depth !== 16 || img.channels !== 1) throw new Error("provinces.png must be 16-bit grayscale");
    width = img.width;
    height = img.height;
    ids = img.data as Uint16Array;
    const copy = ids.slice();
    post({ type: "loaded", width, height, ids: copy }, [copy.buffer]);
  } else if (msg.type === "labels") {
    if (!ids) return;
    const gw = width / GRID_SCALE, gh = height / GRID_SCALE;
    const grid = new Uint16Array(gw * gh);
    const owners = msg.owners;
    for (let y = 0; y < gh; y++) {
      const row = (y * GRID_SCALE + GRID_SCALE / 2) * width;
      for (let x = 0; x < gw; x++) {
        const id = ids[row + x * GRID_SCALE + GRID_SCALE / 2];
        const o = id === 0 ? -1 : owners[id];
        grid[y * gw + x] = o < 0 ? 0xffff : o;
      }
    }
    const only = msg.only ? new Set(msg.only) : undefined;
    const labels = computeLabels({ grid, width: gw, height: gh, scale: GRID_SCALE, nameLengths: msg.nameLengths }, only);
    post({ type: "labels", labels, only: msg.only });
  }
};

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  (self as unknown as Worker).postMessage(msg, transfer);
}
