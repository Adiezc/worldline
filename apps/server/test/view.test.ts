// What a player's view leaves out: the AI side's private record of talks, and other players' projects.

import { expect, test } from "bun:test";
import { join } from "node:path";
import { buildMapIndex, type MapMeta, type Project } from "@worldline/shared";
import { MockProvider } from "../src/ai/mock.ts";
import { engine } from "../src/engine/index.ts";
import { Room } from "../src/rooms.ts";
import { buildFixtureSeed, ROOT } from "./fixtures/seed.ts";

const meta = (await Bun.file(join(ROOT, "packages", "mapdata", "public", "map", "provinces.json")).json()) as MapMeta;
const map = buildMapIndex(meta);
const seed = await buildFixtureSeed();

test("views hide the chat record and other players' projects", () => {
  const state = engine.createGame({ id: "g1", name: "Views", seed });
  state.phase = "orders";
  // Guests only: a host's view also reads snapshots from the database.
  state.players = [
    { id: "p1", name: "A", country: "GBR", isHost: false, connected: true, ready: false },
    { id: "p2", name: "B", country: "FRA", isHost: false, connected: true, ready: false },
  ];
  state.chats = [{ id: "c1", members: ["GBR", "DEU"], lastTurn: 1, messages: [], summary: "Berlin plans to stall the talks." }];
  const project = (id: string, country: string): Project =>
    ({ id, country, name: id, goal: "", started: state.date, due: state.date, progress: 0, status: "active", milestones: [] });
  state.projects = [project("mine", "GBR"), project("theirs", "FRA"), project("ai", "DEU")];

  const room = new Room(state, { map, ai: new MockProvider(), seed: () => seed });
  const view = room.view("p1");
  expect(view.chats.length).toBe(1);
  expect("summary" in view.chats[0]).toBe(false);
  expect(view.projects?.map((p) => p.id)).toEqual(["mine", "ai"]);
  // The server's own state keeps both.
  expect(room.state.chats[0].summary).toBeTruthy();
  expect(room.state.projects?.length).toBe(3);
});
