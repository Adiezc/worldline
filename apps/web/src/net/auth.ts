// Account session: token + user, mirrored in localStorage (`worldline:token`).
// Everything works signed out; the token only adds ownership (games, custom scenarios).
import { create } from "zustand";
import type { MeResponse } from "@worldline/shared";
import { api, ApiError } from "./api.ts";
import { storage } from "./storage.ts";

export interface AuthUser {
  id: string;
  username: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /** Latest /api/me (games), null until fetched or when signed out. */
  me: MeResponse | null;
  /** /api/me is not available on this server (older build) or the server is offline. */
  meUnavailable: boolean;
}

export const useAuth = create<AuthState>(() => ({
  token: storage.token(),
  user: storage.token() ? storage.user() : null,
  me: null,
  meUnavailable: false,
}));

export const auth = {
  token: () => useAuth.getState().token,
  signedIn: () => !!useAuth.getState().token,
};

function setSession(token: string | null, user: AuthUser | null) {
  storage.setToken(token);
  storage.setUser(user);
  useAuth.setState({ token, user, me: null });
}

export async function signIn(mode: "login" | "register", username: string, password: string) {
  const req = { username: username.trim(), password };
  const res = mode === "register" ? await api.register(req) : await api.login(req);
  setSession(res.token, res.user);
  if (!storage.name()) storage.setName(res.user.username);
  void refreshMe();
  return res.user;
}

export async function signOut() {
  try {
    if (auth.token()) await api.logout();
  } catch {
    /* the token is dropped locally either way */
  }
  setSession(null, null);
}

/** Validate the stored token and fetch your games. A 401 signs you out. */
export async function refreshMe(): Promise<MeResponse | null> {
  if (!auth.token()) return null;
  try {
    const me = await api.me();
    storage.setUser(me.user);
    useAuth.setState({ user: me.user, me, meUnavailable: false });
    return me;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setSession(null, null);
    else useAuth.setState({ meUnavailable: true });
    return null;
  }
}
