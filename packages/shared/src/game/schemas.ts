// Zod schemas for everything the LLM returns. They double as the JSON schema we send to
// OpenRouter (`response_format`) and as the parser that guards the rules engine.
import { z } from "zod";
import { cleanGenFlag } from "./flags.ts";

const tag = z.string().min(2).max(8);
/** Lists the model tends to overfill are trimmed rather than rejected (a rejection costs a repair call). */
const trimmed = <T extends z.ZodType>(item: T, max: number) => z.array(item).transform((a) => a.slice(0, max));
const ids = z.array(z.coerce.number().int().positive());
const stat = z.enum(["gdp", "population", "stability", "military", "warExhaustion"]);
const treatyType = z.enum(["alliance", "defensive", "trade", "nonaggression", "vassal", "customs_union"]);
const orgKind = z.enum(["global", "regional", "military", "economic", "forum"]);
const votingRule = z.enum(["consensus", "simpleMajority", "twoThirds", "qualifiedMajority", "vetoMajority"]);
const resolutionType = z.enum([
  "sanction", "condemn", "peacekeeping", "admitMember", "suspendMember", "expelMember", "tradePolicy", "authorizeForce", "custom",
]);

export const EffectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transferProvinces"), provinces: ids, from: tag, to: tag }),
  z.object({ type: z.literal("setController"), provinces: ids, controller: tag }),
  z.object({ type: z.literal("statDelta"), country: tag, stat, delta: z.coerce.number() }),
  z.object({ type: z.literal("relationDelta"), a: tag, b: tag, delta: z.coerce.number() }),
  z.object({ type: z.literal("createTreaty"), treatyType, members: z.array(tag).min(2), name: z.string().optional() }),
  z.object({ type: z.literal("endTreaty"), treatyId: z.string() }),
  z.object({ type: z.literal("declareWar"), attackers: z.array(tag).min(1), defenders: z.array(tag).min(1), goal: z.string(), name: z.string().optional() }),
  z.object({ type: z.literal("joinWar"), warId: z.string(), country: tag, side: z.enum(["attackers", "defenders"]) }),
  z.object({ type: z.literal("makePeace"), warId: z.string(), terms: z.string() }),
  z.object({
    type: z.literal("spawnCountry"), tag: tag.optional(), name: z.string(), government: z.string(), leader: z.string(),
    provinces: ids.min(1), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    // Optional generated flag ("gen:<pattern>:<c1>,<c2>[,<c3>]"); anything else is dropped, not rejected.
    flag: z.string().optional().transform((f) => cleanGenFlag(f)),
  }),
  z.object({ type: z.literal("annexCountry"), target: tag, by: tag }),
  z.object({ type: z.literal("changeLeader"), country: tag, leader: z.string(), government: z.string().optional() }),
  z.object({ type: z.literal("joinOrg"), orgId: z.string(), country: tag }),
  z.object({ type: z.literal("leaveOrg"), orgId: z.string(), country: tag }),
  z.object({
    type: z.literal("createOrg"), abbrev: z.string().max(12), name: z.string(), kind: orgKind, members: z.array(tag).min(2),
    rule: votingRule, tradeBloc: z.boolean().optional(), mutualDefense: z.boolean().optional(),
  }),
  z.object({
    type: z.literal("proposeResolution"), orgId: z.string(), resolutionType, proposer: tag, target: tag.optional(), text: z.string(),
  }),
  z.object({ type: z.literal("applyToOrg"), orgId: z.string(), country: tag }),
  z.object({ type: z.literal("imposeSanctions"), target: tag, by: z.array(tag).min(1) }),
  z.object({ type: z.literal("liftSanctions"), target: tag, by: z.array(tag).min(1) }),
  z.object({ type: z.literal("updateAgenda"), country: tag, goals: trimmed(z.string(), 5) }),
  z.object({ type: z.literal("updateFormation"), country: tag, index: z.coerce.number().int().min(0), met: z.boolean(), text: z.string().optional() }),
]);

const EventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headline: z.string().min(3),
  body: z.string().default(""),
  countries: z.array(tag).default([]),
  causes: z.array(z.string()).default([]),
  effects: z.array(EffectSchema).default([]),
});

export const ResolverOutputSchema = z.object({
  orderVerdicts: z.array(z.object({ orderId: z.string(), outcome: z.enum(["success", "partial", "fail"]), reason: z.string() })).default([]),
  events: z.array(EventSchema).default([]),
  /** Only used for "until next major event" jumps. */
  stopDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ResolverOutput = z.infer<typeof ResolverOutputSchema>;

export const DirectorOutputSchema = z.object({
  intents: z.array(z.object({
    country: tag,
    summary: z.string(),
    /** Short news headline; the summary becomes the body. */
    headline: z.string().optional(),
    /** Day it happens (scheduled calendar items use their real date). */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** Effects confined to the acting country (applied directly). */
    selfEffects: z.array(EffectSchema).default([]),
    /** True when the intent acts on other countries and must be adjudicated by the resolver. */
    affectsOthers: z.boolean().default(false),
  })).default([]),
  agendaUpdates: z.array(z.object({ country: tag, goals: trimmed(z.string(), 5) })).default([]),
  resolutions: z.array(z.object({
    orgId: z.string(), resolutionType, proposer: tag, target: tag.optional(), text: z.string(),
  })).default([]),
});
export type DirectorOutput = z.infer<typeof DirectorOutputSchema>;

export const ChatOutputSchema = z.object({
  speaker: tag,
  reply: z.string().min(1),
  tone: z.enum(["warm", "neutral", "cold", "hostile"]).default("neutral"),
  relationDelta: z.coerce.number().default(0).transform((v) => Math.max(-15, Math.min(15, v))),
  proposal: z.object({
    kind: z.enum(["treaty", "endWar", "joinOrg", "custom"]),
    treatyType: treatyType.optional(),
    members: z.array(tag).min(2),
    terms: z.string(),
  }).optional(),
  /** Whether this AI nation accepts a proposal the player made in their last message. */
  acceptsPlayerProposal: z.boolean().optional(),
});
export type ChatOutput = z.infer<typeof ChatOutputSchema>;

export const PolishOutputSchema = z.object({ text: z.string().min(1) });
export const BrainstormOutputSchema = z.object({ ideas: trimmed(z.string(), 8).refine((a) => a.length > 0, "at least one idea") });
export const ConsolidationOutputSchema = z.object({ summary: z.string().min(10) });

export const AssessorOutputSchema = z.object({
  verdict: z.enum(["achievable", "notYet", "unrealistic"]),
  requirements: trimmed(z.object({ text: z.string(), met: z.boolean(), why: z.string() }), 8).refine((a) => a.length > 0, "at least one requirement"),
  consent: z.array(z.object({ country: tag, needed: z.boolean(), willing: z.boolean() })).default([]),
  suggestedPath: z.string(),
  plan: z.object({
    name: z.string(),
    orgHandling: z.string(),
    reactions: z.array(z.object({ a: tag, b: tag, delta: z.coerce.number() })).default([]),
  }).optional(),
});
export type AssessorOutput = z.infer<typeof AssessorOutputSchema>;

export const VotesOutputSchema = z.object({
  votes: z.array(z.object({
    resolutionId: z.string(),
    country: tag,
    vote: z.enum(["yes", "no", "abstain"]),
    reason: z.string().default(""),
  })),
});
export type VotesOutput = z.infer<typeof VotesOutputSchema>;

/** JSON schema for OpenRouter's response_format. */
export function jsonSchemaOf(schema: z.ZodType) {
  return z.toJSONSchema(schema, { target: "draft-7", io: "input" });
}
