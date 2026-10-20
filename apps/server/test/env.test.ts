// The root .env loader (parsing only; loading is exercised by every server start).

import { expect, test } from "bun:test";
import { parseEnv } from "../src/env.ts";

test("parseEnv reads keys, comments, quotes and export prefixes", () => {
  const env = parseEnv([
    "# Copy to .env",
    "OPENROUTER_API_KEY=sk-or-abc",
    "  export PORT = 3005  ",
    'WORLDLINE_DB="C:/data/worldline.sqlite"',
    "QUOTED_HASH='a # b'",
    "TRAILING=value # a note",
    "EMPTY=",
    "# ANTHROPIC_API_KEY=commented-out",
    "not a line",
  ].join("\r\n"));
  expect(env).toEqual({
    OPENROUTER_API_KEY: "sk-or-abc", PORT: "3005", WORLDLINE_DB: "C:/data/worldline.sqlite",
    QUOTED_HASH: "a # b", TRAILING: "value", EMPTY: "",
  });
});
