// Loads the repo-root .env (and .env.local). Bun only reads .env files from the working directory,
// and the server runs from apps/server (`bun --cwd apps/server dev`, or `bun run dev` per workspace),
// so a key in the root .env would otherwise never be seen. Variables already set win: the shell,
// launch configs, tests and any apps/server/.env Bun loaded itself. Import this before anything that
// reads process.env at load time.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");

/** KEY=value lines; `#` comments, `export ` prefixes and matching quotes are allowed. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let value = m[2];
    const quoted = value.match(/^(["'])(.*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, "");
    out[m[1]] = value;
  }
  return out;
}

// .env.local first, so it overrides .env for the same key.
for (const name of [".env.local", ".env"]) {
  const file = join(ROOT, name);
  if (!existsSync(file)) continue;
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
