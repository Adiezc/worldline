// REST helpers for /api (proxied to the game server in development).
import type { CreateGameRequest, GameSummary, HealthResponse } from "@worldline/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Server unreachable", 0);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // The dev proxy answers 5xx/HTML when the game server is down.
    throw new ApiError(res.ok ? "Unexpected response from server" : "Server unreachable", res.ok ? res.status : 0);
  }
  const body = await res.json();
  if (!res.ok) throw new ApiError(body?.error ?? body?.message ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  createGame: (req: CreateGameRequest) =>
    request<{ gameId: string }>("/api/games", { method: "POST", body: JSON.stringify(req) }),
  game: (id: string) => request<GameSummary>(`/api/games/${encodeURIComponent(id)}`),
};
