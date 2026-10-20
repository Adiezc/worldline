import { describe, expect, test } from "bun:test";
import {
  ChatOutputSchema, DirectorOutputSchema, EffectSchema, ResolverOutputSchema, VotesOutputSchema, jsonSchemaOf, salvageModelOutput,
} from "../src/game/schemas.ts";
import type { Effect } from "../src/game/state.ts";

const resolverSample = {
  orderVerdicts: [{ orderId: "o1", outcome: "partial", reason: "The offensive stalls." }],
  events: [
    {
      date: "2026-02-01",
      headline: "Russian offensive near Kharkiv",
      body: "Fighting intensifies.",
      countries: ["RUS", "UKR"],
      causes: ["o1"],
      effects: [
        { type: "setController", provinces: ["2125", 2122], controller: "RUS" },
        { type: "statDelta", country: "UKR", stat: "stability", delta: "-4.5" },
        { type: "relationDelta", a: "RUS", b: "UKR", delta: -10 },
        { type: "spawnCountry", name: "Free Kharkiv", government: "Council", leader: "X", provinces: [2125], color: "#AABBCC" },
        { type: "addClaim", claimant: "POL", provinces: ["12"], note: "historic" },
      ],
    },
    { date: "2026-02-03", headline: "Quiet week" },
  ],
};

describe("ResolverOutputSchema", () => {
  test("accepts well-formed output, coercing numeric strings and filling defaults", () => {
    const r = ResolverOutputSchema.parse(resolverSample);
    const fx = r.events[0].effects;
    expect(fx[0]).toEqual({ type: "setController", provinces: [2125, 2122], controller: "RUS" });
    expect(fx[1]).toMatchObject({ delta: -4.5 });
    expect(fx[4]).toMatchObject({ provinces: [12] });
    expect(r.events[1]).toEqual({ date: "2026-02-03", headline: "Quiet week", body: "", countries: [], causes: [], effects: [] });
    expect(ResolverOutputSchema.parse({})).toEqual({ orderVerdicts: [], events: [] });
  });

  test("rejects malformed output", () => {
    const bad = [
      { events: [{ date: "Feb 1 2026", headline: "Bad date" }] },
      { events: [{ date: "2026-02-01", headline: "x" }] }, // headline too short
      { events: [{ date: "2026-02-01", headline: "Unknown effect", effects: [{ type: "nuke", target: "USA" }] }] },
      { events: [{ date: "2026-02-01", headline: "Bad stat", effects: [{ type: "statDelta", country: "UKR", stat: "happiness", delta: 1 }] }] },
      { events: [{ date: "2026-02-01", headline: "NaN delta", effects: [{ type: "statDelta", country: "UKR", stat: "gdp", delta: "lots" }] }] },
      { events: [{ date: "2026-02-01", headline: "Bad ids", effects: [{ type: "setController", provinces: [-3, 1.5], controller: "RUS" }] }] },
      { events: [{ date: "2026-02-01", headline: "One-member treaty", effects: [{ type: "createTreaty", treatyType: "alliance", members: ["UKR"] }] }] },
      { events: [{ date: "2026-02-01", headline: "Bad colour", effects: [{ type: "spawnCountry", name: "X", government: "", leader: "", provinces: [1], color: "red" }] }] },
      { orderVerdicts: [{ orderId: "o1", outcome: "maybe", reason: "" }] },
      { stopDate: "soon" },
      "not even an object",
    ];
    for (const b of bad) expect(ResolverOutputSchema.safeParse(b).success).toBe(false);
  });

  test("EffectSchema covers exactly the engine's Effect types", () => {
    // Record<Effect["type"], …> makes tsc fail if a type is added to state.ts but not listed here.
    const ALL: Record<Effect["type"], true> = {
      transferProvinces: true, setController: true, statDelta: true, relationDelta: true, createTreaty: true, endTreaty: true,
      declareWar: true, joinWar: true, makePeace: true, spawnCountry: true, annexCountry: true, changeLeader: true, joinOrg: true,
      leaveOrg: true, createOrg: true, proposeResolution: true, applyToOrg: true, imposeSanctions: true, liftSanctions: true,
      updateAgenda: true, addClaim: true, dropClaim: true,
    };
    const types = EffectSchema.options.map((o) => o.shape.type.value as string).sort();
    expect(types).toEqual(Object.keys(ALL).sort());
  });
});

describe("DirectorOutputSchema", () => {
  test("accepts well-formed output", () => {
    const r = DirectorOutputSchema.parse({
      intents: [{ country: "FRA", summary: "Boost defence spending", selfEffects: [{ type: "statDelta", country: "FRA", stat: "military", delta: "2" }] }],
      agendaUpdates: [{ country: "FRA", goals: ["European strategic autonomy"] }],
      resolutions: [{ orgId: "eu", resolutionType: "sanction", proposer: "FRA", target: "RUS", text: "18th package" }],
    });
    expect(r.intents[0].affectsOthers).toBe(false);
    expect(r.intents[0].selfEffects[0]).toMatchObject({ delta: 2 });
    expect(DirectorOutputSchema.parse({})).toEqual({ intents: [], agendaUpdates: [], resolutions: [] });
  });

  test("rejects malformed output", () => {
    expect(DirectorOutputSchema.safeParse({ intents: [{ country: "FRA" }] }).success).toBe(false);
    // Over-long lists are trimmed, not rejected (a rejection costs a repair call).
    expect(DirectorOutputSchema.parse({ agendaUpdates: [{ country: "FRA", goals: ["1", "2", "3", "4", "5", "6"] }] }).agendaUpdates[0].goals).toHaveLength(5);
    expect(DirectorOutputSchema.safeParse({ resolutions: [{ orgId: "eu", resolutionType: "invade", proposer: "FRA", text: "" }] }).success).toBe(false);
    expect(DirectorOutputSchema.safeParse({ intents: [{ country: "A", summary: "too-short tag" }] }).success).toBe(false);
  });
});

describe("other schemas", () => {
  test("chat and votes", () => {
    expect(ChatOutputSchema.parse({ speaker: "FRA", reply: "Bonjour", relationDelta: "3" })).toMatchObject({ tone: "neutral", relationDelta: 3 });
    expect(ChatOutputSchema.parse({ speaker: "FRA", reply: "x", relationDelta: 50 }).relationDelta).toBe(15);
    expect(VotesOutputSchema.parse({ votes: [{ resolutionId: "r1", country: "FRA", vote: "yes" }] }).votes[0].reason).toBe("");
    expect(VotesOutputSchema.safeParse({ votes: [{ resolutionId: "r1", country: "FRA", vote: "maybe" }] }).success).toBe(false);
  });
});

describe("jsonSchemaOf", () => {
  test("returns a JSON schema object for each LLM output", () => {
    for (const schema of [ResolverOutputSchema, DirectorOutputSchema, ChatOutputSchema, VotesOutputSchema]) {
      const js = jsonSchemaOf(schema) as Record<string, unknown>;
      expect(typeof js).toBe("object");
      expect(js.type).toBe("object");
      expect(js.properties).toBeDefined();
      expect(() => JSON.stringify(js)).not.toThrow();
    }
    const resolver = jsonSchemaOf(ResolverOutputSchema) as { properties: Record<string, unknown> };
    expect(Object.keys(resolver.properties).sort()).toEqual(["events", "orderVerdicts", "stopDate"]);
  });
});

describe("salvaging model output", () => {
  test("invented treaty types map to real ones; hopeless effects are dropped, not fatal", () => {
    const raw = {
      orderVerdicts: [],
      events: [
        { date: "2026-02-01", headline: "Pact signed", effects: [
          { type: "createTreaty", treatyType: "security_pact", members: ["POL", "UKR"] },
          { type: "createTreaty", treatyType: "Economic Partnership", members: ["DEU", "FRA"] },
          { type: "createTreaty", treatyType: "cultural_exchange", members: ["ITA", "ESP"] },
          { type: "statDelta", country: "POL", stat: "happiness", delta: 3 },
          { type: "relationDelta", a: "POL", b: "UKR", delta: 5 },
        ] },
      ],
    };
    const dropped = salvageModelOutput(raw);
    expect(dropped).toHaveLength(2);
    const parsed = ResolverOutputSchema.parse(raw);
    expect(parsed.events[0].effects.map((e) => (e.type === "createTreaty" ? e.treatyType : e.type))).toEqual(["defensive", "trade", "relationDelta"]);
  });

  test("a chat proposal with an unknown treaty type keeps the closest one or none", () => {
    const a = { speaker: "FRA", reply: "Yes.", proposal: { kind: "treaty", treatyType: "mutual defence", members: ["FRA", "POL"], terms: "x" } };
    const b = { speaker: "FRA", reply: "Yes.", proposal: { kind: "custom", treatyType: "space program", members: ["FRA", "POL"], terms: "x" } };
    salvageModelOutput(a);
    salvageModelOutput(b);
    expect(ChatOutputSchema.parse(a).proposal?.treatyType).toBe("defensive");
    expect(ChatOutputSchema.parse(b).proposal?.treatyType).toBeUndefined();
  });
});
