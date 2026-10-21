// Saved-game export under the import size limit (no server, no database).

import { expect, test } from "bun:test";
import type { GameBundle, GameState } from "@worldline/shared";
import { BundleError, exportBundle } from "../src/bundle.ts";
import { engine } from "../src/engine/index.ts";
import { buildFixtureSeed } from "./fixtures/seed.ts";

const seed = await buildFixtureSeed();

function game(turn: number): GameState {
  const s = engine.createGame({ id: "g1", name: "Big", seed });
  s.turn = turn;
  s.players = [{ id: "11111111-2222-3333-4444-555555555555", name: "Host", country: "GBR", isHost: true, connected: true, ready: false }];
  s.chats = [{ id: "c1", members: ["GBR", "DEU"], lastTurn: turn, messages: [{ id: "m1", from: "GBR", playerId: s.players[0].id, text: "hi", at: s.date }] }];
  return s;
}

test("the oldest snapshots are left out when the file would outgrow the limit, and ids stay hidden", () => {
  const current = game(5);
  const snapshots = [4, 3, 2, 1].map((t) => JSON.stringify(game(t)));
  // What one snapshot adds to the file once exported (players and orders stripped).
  const size = (n: number) => Buffer.byteLength(exportBundle(current, snapshots.slice(0, n), Infinity).text);
  const each = size(1) - size(0);
  // Room for the game and two snapshots, with a little to spare: turns 3 and 4 stay, 1 and 2 go.
  const { text, dropped } = exportBundle(current, snapshots, size(4) - 2 * each + 100);
  expect(dropped).toBe(2);
  const bundle = JSON.parse(text) as GameBundle;
  expect(bundle.snapshots.map((s) => s.turn)).toEqual([3, 4]);
  expect(text).not.toContain(current.players[0].id);
  expect(bundle.game.chats[0].messages[0].playerId).toBe("player1");
  expect(bundle.snapshots.every((s) => s.players.length === 0 && Object.keys(s.orders).length === 0)).toBe(true);
});

test("a game that alone exceeds the limit is refused", () => {
  expect(() => exportBundle(game(1), [], 1000)).toThrow(BundleError);
});
