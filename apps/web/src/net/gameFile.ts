// Saved-game files: the host's export (History panel) and the menu's import. Both move whole
// games, so they bypass api.ts's JSON helper: the export is streamed to a download, the import
// uploads the file as is.
import { ApiError } from "./api.ts";

/** Matches the server's limit, so an oversized file fails before it is uploaded. */
export const MAX_GAME_FILE = 60 * 1024 * 1024;

/**
 * Download the game as a JSON file. The server only serves it to the host's player id, sent in a
 * header so it stays out of URLs and logs. Returns how many of the oldest turns' rewind points were
 * left out to keep the file importable.
 */
export async function exportGame(gameId: string, playerId: string) {
  const res = await send(`/api/games/${encodeURIComponent(gameId)}/export`, { headers: { "x-worldline-player": playerId } });
  const dropped = Number(res.headers.get("x-worldline-dropped-turns")) || 0;
  const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "worldline-game.json";
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return dropped;
}

/** Upload an exported game; it becomes a new game in its lobby. Returns its id. */
export async function importGame(file: File) {
  if (file.size > MAX_GAME_FILE) throw new ApiError("That file is too large to import (60 MB max).", 413);
  const res = await send("/api/games/import", { method: "POST", headers: { "content-type": "application/json" }, body: file });
  return ((await res.json()) as { gameId: string }).gameId;
}

async function send(path: string, init?: RequestInit) {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError("Server unreachable", 0);
  }
  if (res.ok) return res;
  const json = (res.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? ((await res.json().catch(() => null)) as { error?: string } | null) : null;
  if (body?.error) throw new ApiError(body.error, res.status);
  // Bun refuses oversized uploads before the route sees them, without a JSON body.
  if (res.status === 413) throw new ApiError("That file is too large to import (60 MB max).", 413);
  // The dev proxy answers 5xx/HTML when the game server is down.
  if (!json) throw new ApiError("Server unreachable", 0);
  throw new ApiError(`Request failed (${res.status})`, res.status);
}
