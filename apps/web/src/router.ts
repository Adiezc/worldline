// Minimal history router: "/" = main menu, "/game/:id" = game, "/editor[/:baseScenarioId]" = editor.
import { useSyncExternalStore } from "react";

export type Route = { name: "menu" } | { name: "game"; id: string } | { name: "editor"; base: string | null };

const EVENT = "worldline:navigate";

function parse(path: string): Route {
  const m = /^\/game\/([^/?#]+)/.exec(path);
  if (m) return { name: "game", id: decodeURIComponent(m[1]) };
  const e = /^\/editor(?:\/([^/?#]+))?\/?$/.exec(path);
  if (e) return { name: "editor", base: e[1] ? decodeURIComponent(e[1]) : null };
  return { name: "menu" };
}

export const editorPath = (base?: string | null) => (base ? `/editor/${encodeURIComponent(base)}` : "/editor");

export function navigate(path: string, replace = false) {
  if (path === location.pathname) return;
  if (replace) history.replaceState(null, "", path);
  else history.pushState(null, "", path);
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener("popstate", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("popstate", cb);
    window.removeEventListener(EVENT, cb);
  };
}

let cachedPath = "";
let cachedRoute: Route = { name: "menu" };
function snapshot(): Route {
  if (location.pathname !== cachedPath) {
    cachedPath = location.pathname;
    cachedRoute = parse(cachedPath);
  }
  return cachedRoute;
}

export const useRoute = () => useSyncExternalStore(subscribe, snapshot);

export const gameUrl = (id: string) => `${location.origin}/game/${encodeURIComponent(id)}`;

/** Accepts a full invite link, a path, or a bare code. */
export function parseGameRef(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = /\/game\/([^/?#\s]+)/.exec(s);
  if (m) return decodeURIComponent(m[1]);
  return /^[\w-]+$/.test(s) ? s : null;
}
