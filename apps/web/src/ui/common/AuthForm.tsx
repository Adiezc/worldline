import { useState, type FormEvent } from "react";
import { ApiError, errorText } from "../../net/api.ts";
import { signIn } from "../../net/auth.ts";
import { Button } from "./ui.tsx";

/** Compact sign-in / register form (menu account card, editor save prompt). */
export function AuthForm({ disabled, onDone, hint }: { disabled?: boolean; onDone?: () => void; hint?: string }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return setError("Enter a username and a password.");
    setBusy(true);
    setError(null);
    try {
      await signIn(mode, username, password);
      setPassword("");
      onDone?.();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? "Accounts are not available on this server yet." : errorText(err, "The game server"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="flex rounded border border-panel-edge/60 p-0.5">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`rounded-sm px-2 py-0.5 text-[10.5px] tracking-wider uppercase ${mode === m ? "bg-gold/15 text-gold-bright" : "text-parchment/50 hover:text-parchment"}`}
            >
              {m === "login" ? "Sign in" : "Register"}
            </button>
          ))}
        </div>
        {hint && <span className="min-w-0 flex-1 text-[11px] leading-snug text-parchment/45">{hint}</span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="hud-input" value={username} autoComplete="username" maxLength={32} placeholder="Username" onChange={(e) => setUsername(e.target.value)} aria-label="Username" />
        <input
          className="hud-input"
          type="password"
          value={password}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          placeholder="Password"
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
      </div>
      {error && <p className="text-xs text-[#f0b2aa]">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" busy={busy} disabled={disabled}>
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </div>
    </form>
  );
}
