import { describe, expect, test } from "bun:test";
import { applyEvent, pruneSchedule } from "../src/game/engine.ts";
import { addHuman, country, ctx, ev, MAP, makeState } from "./fixtures.ts";

const ELECTION = { type: "scheduleEvent", country: "VEN", date: "2026-06-26", kind: "election", title: "Presidential election" } as const;
const NEW_LEADER = { type: "changeLeader", country: "VEN", leader: "María Corina Machado", government: "Presidential republic" } as const;
const reasons = (r: { reason: string }[]) => r.map((x) => x.reason).join(" | ");

/** Venezuela run by a player, stable enough that the AI can't replace its leader on a whim. */
function playerVenezuela() {
  const s = makeState();
  addHuman(s, "VEN");
  country(s, "VEN").stability = 60;
  return s;
}

describe("scheduled dates", () => {
  test("a player sets an election date only by their own order", () => {
    const s = playerVenezuela();
    const r = applyEvent(s, MAP, ev([ELECTION]), ctx());
    expect(reasons(r.rejected)).toContain("player-controlled");
    applyEvent(s, MAP, ev([ELECTION], { causes: ["o1"] }), ctx(30, [{ id: "o1", country: "VEN" }]));
    expect(s.schedule).toHaveLength(1);
    expect(s.schedule![0]).toMatchObject({ date: "2026-06-26", kind: "election", countries: ["VEN"], since: "2026-01-15" });
  });

  test("setting the election again moves it instead of adding another", () => {
    const s = playerVenezuela();
    const orders = ctx(30, [{ id: "o1", country: "VEN" }]);
    applyEvent(s, MAP, ev([ELECTION], { causes: ["o1"] }), orders);
    applyEvent(s, MAP, ev([{ ...ELECTION, date: "2026-09-01", title: "Postponed presidential election" }], { causes: ["o1"] }), orders);
    expect(s.schedule).toHaveLength(1);
    expect(s.schedule![0].date).toBe("2026-09-01");
  });

  test("holding a player's scheduled election may change its leader and government", () => {
    const s = playerVenezuela();
    applyEvent(s, MAP, ev([ELECTION], { causes: ["o1"] }), ctx(30, [{ id: "o1", country: "VEN" }]));
    const id = s.schedule![0].id;
    // Without the election behind it, the AI can't replace a stable player's leader.
    const coup = applyEvent(s, MAP, ev([NEW_LEADER], { date: "2026-06-26" }), ctx());
    expect(reasons(coup.rejected)).toContain("player-controlled");
    const vote = ev([NEW_LEADER], { date: "2026-06-26", holds: id });
    applyEvent(s, MAP, vote, ctx());
    expect(country(s, "VEN").leader).toBe("María Corina Machado");
    expect(country(s, "VEN").government).toBe("Presidential republic");
    expect(vote.holds).toBe(id);
    expect(s.schedule).toHaveLength(0);
  });

  test("an election can't be held before its date", () => {
    const s = playerVenezuela();
    applyEvent(s, MAP, ev([ELECTION], { causes: ["o1"] }), ctx(30, [{ id: "o1", country: "VEN" }]));
    const early = ev([NEW_LEADER], { date: "2026-06-01", holds: s.schedule![0].id });
    const r = applyEvent(s, MAP, early, ctx());
    expect(r.rejected).toHaveLength(1);
    expect(early.holds).toBeUndefined();
    expect(s.schedule).toHaveLength(1);
  });

  test("an election on the scenario calendar counts too", () => {
    const s = playerVenezuela();
    const turn = ctx();
    turn.calendar = [{ id: "cal4", date: "2026-01-10", kind: "election", title: "General election", countries: ["VEN"], since: "" }];
    applyEvent(s, MAP, ev([NEW_LEADER], { holds: "cal4" }), turn);
    expect(country(s, "VEN").leader).toBe("María Corina Machado");
  });

  test("dates long overdue are dropped", () => {
    const s = playerVenezuela();
    applyEvent(s, MAP, ev([ELECTION], { causes: ["o1"] }), ctx(30, [{ id: "o1", country: "VEN" }]));
    s.date = "2026-07-15";
    pruneSchedule(s);
    expect(s.schedule).toHaveLength(1);
    s.date = "2026-10-01";
    pruneSchedule(s);
    expect(s.schedule).toHaveLength(0);
  });
});
