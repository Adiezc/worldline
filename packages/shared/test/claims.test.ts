import { describe, expect, test } from "bun:test";
import { applyEvent } from "../src/game/engine.ts";
import { addHuman, ctx, ev, MAP, makeState, prov, war } from "./fixtures.ts";

const ESSEQUIBO = ["Barima-Waini", "Pomeroon-Supenaam", "Cuyuni-Mazaruni"].map((n) => prov(n, "GUY"));
const reasons = (r: { reason: string }[]) => r.map((x) => x.reason).join(" | ");

describe("territorial claims", () => {
  test("an AI government can lay a claim and renounce part of it", () => {
    const s = makeState();
    applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "1899 award contested" }]), ctx());
    expect(s.claims).toHaveLength(1);
    expect(s.claims![0].provinces).toEqual(ESSEQUIBO);
    applyEvent(s, MAP, ev([{ type: "dropClaim", claimant: "VEN", provinces: [ESSEQUIBO[0]] }]), ctx());
    expect(s.claims![0].provinces).toEqual(ESSEQUIBO.slice(1));
    applyEvent(s, MAP, ev([{ type: "dropClaim", claimant: "VEN" }]), ctx());
    expect(s.claims).toHaveLength(0);
  });

  test("a claim on your own land or one already claimed is refused", () => {
    const s = makeState();
    const caracas = prov("Miranda", "VEN");
    const r = applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: [caracas], note: "" }]), ctx());
    expect(r.applied).toHaveLength(0);
    applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "" }]), ctx());
    const again = applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "" }]), ctx());
    expect(reasons(again.rejected)).toContain("already claimed");
  });

  test("players lay and renounce claims only by their own orders", () => {
    const s = makeState();
    addHuman(s, "VEN");
    const r = applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "" }]), ctx());
    expect(reasons(r.rejected)).toContain("player-controlled");
    applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "" }], { causes: ["o1"] }), ctx(30, [{ id: "o1", country: "VEN" }]));
    expect(s.claims).toHaveLength(1);
  });

  test("a claim is settled once the claimant owns the land", () => {
    const s = makeState();
    applyEvent(s, MAP, ev([{ type: "addClaim", claimant: "VEN", provinces: ESSEQUIBO, note: "" }]), ctx());
    const w = war(s, ["VEN"], ["GUY"]);
    applyEvent(s, MAP, ev([
      { type: "makePeace", warId: w, terms: "cession" },
      { type: "transferProvinces", provinces: [ESSEQUIBO[0]], from: "GUY", to: "VEN" },
    ]), { ...ctx(), negotiated: true });
    expect(s.claims![0].provinces).not.toContain(ESSEQUIBO[0]);
    expect(s.claims![0].provinces).toHaveLength(2);
  });
});
