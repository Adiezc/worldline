// REST helpers for /api (proxied to the game server in development).
import type {
  AuthRequest, AuthResponse, CreateGameRequest, CustomScenarioRequest, GameSummary, HealthResponse, MeResponse,
  ScenarioInfo, ScenarioSeed,
} from "@worldline/shared";
import { storage } from "./storage.ts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Validation details, when the server sends any (e.g. `issues: string[]`). */
    readonly details: string[] = [],
  ) {
    super(message);
  }
  /** The endpoint is missing on this server build (or the server is down). */
  get unavailable() {
    return this.status === 0 || this.status === 404 || this.status === 405 || this.status === 501;
  }
}

/** Authorization header for the stored session, if any. */
export function authHeaders(): Record<string, string> {
  const token = storage.token();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function detailsOf(body: unknown): string[] {
  if (!body || typeof body !== "object") return [];
  const b = body as Record<string, unknown>;
  const list = b.issues ?? b.errors ?? b.details;
  if (!Array.isArray(list)) return [];
  return list
    .map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const o = x as { path?: unknown; message?: unknown };
        const path = Array.isArray(o.path) ? o.path.join(".") : typeof o.path === "string" ? o.path : "";
        return `${path ? path + ": " : ""}${String(o.message ?? JSON.stringify(x))}`;
      }
      return String(x);
    })
    .slice(0, 12);
}

async function request<T>(path: string, init?: RequestInit & { auth?: boolean }): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.auth ? authHeaders() : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError("Server unreachable", 0);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    // The dev proxy answers 5xx/HTML when the game server is down.
    throw new ApiError(res.ok ? "Unexpected response from server" : "Server unreachable", res.ok ? res.status : 0);
  }
  const body = await res.json();
  if (!res.ok) throw new ApiError(body?.error ?? body?.message ?? `Request failed (${res.status})`, res.status, detailsOf(body));
  return body as T;
}

const post = (body: unknown, auth = false): RequestInit & { auth?: boolean } => ({ method: "POST", body: JSON.stringify(body), auth });

export const api = {
  health: () => request<HealthResponse>("/api/health"),
  createGame: (req: CreateGameRequest) => request<{ gameId: string }>("/api/games", post(req, true)),
  game: (id: string) => request<GameSummary>(`/api/games/${encodeURIComponent(id)}`),

  scenarios: () => request<ScenarioInfo[]>("/api/scenarios"),
  scenario: (id: string) => request<ScenarioSeed>(`/api/scenarios/${encodeURIComponent(id)}`),
  saveScenario: (req: CustomScenarioRequest) => request<{ id: string }>("/api/scenarios", post(req, true)),

  register: (req: AuthRequest) => request<AuthResponse>("/api/auth/register", post(req)),
  login: (req: AuthRequest) => request<AuthResponse>("/api/auth/login", post(req)),
  logout: () => request<{ ok: true }>("/api/auth/logout", post({}, true)),
  me: () => request<MeResponse>("/api/me", { auth: true }),
};

/** Human message for a failed call. */
export function errorText(err: unknown, what = "The server") {
  if (err instanceof ApiError) {
    if (err.status === 0) return `${what} is offline.`;
    return err.message;
  }
  return String((err as Error)?.message ?? err);
}
