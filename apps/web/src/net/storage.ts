// localStorage wrappers. Every access is guarded: private windows and blocked storage throw.

export interface RecentGame {
  id: string;
  name: string;
  lastPlayed: number;
}

const MAX_RECENT = 8;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: degrade to session-only */
  }
}

export const storage = {
  playerId: (gameId: string) => read(`worldline:player:${gameId}`) ?? undefined,
  setPlayerId: (gameId: string, id: string) => write(`worldline:player:${gameId}`, id),

  name: () => read("worldline:name") ?? "",
  setName: (name: string) => write("worldline:name", name.trim() || null),

  recent(): RecentGame[] {
    try {
      const list = JSON.parse(read("worldline:recent") ?? "[]") as RecentGame[];
      return Array.isArray(list) ? list.filter((g) => g && typeof g.id === "string") : [];
    } catch {
      return [];
    }
  },
  touchRecent(game: { id: string; name: string }) {
    const list = storage.recent().filter((g) => g.id !== game.id);
    list.unshift({ ...game, lastPlayed: Date.now() });
    write("worldline:recent", JSON.stringify(list.slice(0, MAX_RECENT)));
  },
  /** Scenario last chosen in the New Game form. */
  lastScenario: () => read("worldline:scenario"),
  setLastScenario: (id: string) => write("worldline:scenario", id),

  /** Session token from /api/auth (absent = guest). */
  token: () => read("worldline:token"),
  setToken: (token: string | null) => write("worldline:token", token),
  /** Cached account so the menu can greet you before /api/me answers. */
  user(): { id: string; username: string } | null {
    try {
      const u = JSON.parse(read("worldline:user") ?? "null") as { id?: unknown; username?: unknown } | null;
      return u && typeof u.id === "string" && typeof u.username === "string" ? { id: u.id, username: u.username } : null;
    } catch {
      return null;
    }
  },
  setUser: (user: { id: string; username: string } | null) => write("worldline:user", user ? JSON.stringify(user) : null),

  forgetRecent(id: string) {
    write("worldline:recent", JSON.stringify(storage.recent().filter((g) => g.id !== id)));
  },
};
