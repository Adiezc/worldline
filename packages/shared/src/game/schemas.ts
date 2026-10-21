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
  z.object({ type: z.literal("addClaim"), claimant: tag, provinces: ids.min(1), note: z.string().default("") }),
  z.object({ type: z.literal("dropClaim"), claimant: tag, provinces: ids.optional() }),
  z.object({
    type: z.literal("scheduleEvent"), country: tag, date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["election", "referendum", "summit", "deadline", "event"]).catch("event"), title: z.string().min(3),
  }),
  z.object({ type: z.literal("cancelScheduled"), id: z.string() }),
  z.object({
    type: z.literal("startProject"), country: tag, name: z.string().min(2), goal: z.string().default(""),
    months: z.coerce.number().transform((m) => Math.max(1, Math.min(120, Math.round(m)))),
    milestones: trimmed(z.string(), 5).default([]),
  }),
  z.object({
    type: z.literal("advanceProject"), projectId: z.string(), progress: z.coerce.number(),
    milestone: z.coerce.number().int().min(0).optional(), note: z.string().optional(),
  }),
  z.object({ type: z.literal("endProject"), projectId: z.string(), outcome: z.enum(["completed", "failed", "abandoned"]) }),
  z.object({
    type: z.literal("nuclearStrike"), by: tag, target: tag, province: z.coerce.number().int().positive().optional(),
    // Models say "thermonuclear", "city", "low-yield"…: anything not clearly tactical is strategic.
    scale: z.string().transform((v) => (/tactic|low|battlefield|limited/i.test(v) ? "tactical" : "strategic") as "tactical" | "strategic"),
  }),
]);

const EventSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  headline: z.string().min(3),
  body: z.string().default(""),
  countries: z.array(tag).default([]),
  causes: z.array(z.string()).default([]),
  /** Id of the CALENDAR item this event holds. */
  holds: z.string().optional(),
  effects: z.array(EffectSchema).default([]),
});

/** A deal an AI government puts on the table, in a chat reply or an unprompted message. */
const ProposalOutSchema = z.object({
  kind: z.enum(["treaty", "endWar", "joinOrg", "custom"]),
  treatyType: treatyType.optional(),
  peace: z.enum(["white", "keep_occupied"]).optional(),
  members: z.array(tag).min(2),
  terms: z.string(),
});

/** A message an AI government sends a player country on its own initiative. */
export const OutreachSchema = z.object({
  from: tag,
  to: tag,
  message: z.string().min(1),
  proposal: ProposalOutSchema.optional(),
});
export type Outreach = z.infer<typeof OutreachSchema>;

export const ResolverOutputSchema = z.object({
  orderVerdicts: z.array(z.object({ orderId: z.string(), outcome: z.enum(["success", "partial", "fail"]), reason: z.string() })).default([]),
  events: z.array(EventSchema).default([]),
  /** Only used for "until next major event" jumps. */
  stopDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  outreach: trimmed(OutreachSchema, 4).default([]),
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
    /** Id of the CALENDAR item this intent holds (an election's result). */
    holds: z.string().optional(),
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
  proposal: ProposalOutSchema.optional(),
  /** Whether this AI nation accepts a proposal the player made in their last message. */
  acceptsPlayerProposal: z.boolean().optional(),
  /** The updated running record of the conversation (see Chat.summary). */
  memory: z.string().optional(),
});
export type ChatOutput = z.infer<typeof ChatOutputSchema>;

export const PolishOutputSchema = z.object({ text: z.string().min(1) });
export const BrainstormOutputSchema = z.object({ ideas: trimmed(z.string(), 8).refine((a) => a.length > 0, "at least one idea") });
export const ConsolidationOutputSchema = z.object({ summary: z.string().min(10) });

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

// ---- Salvaging model output ----------------------------------------------------------------

const TREATY_TYPES = treatyType.options;
/** Free-text treaty kinds models invent, mapped onto the closest real one (first match wins). */
const TREATY_SYNONYMS: [RegExp, (typeof TREATY_TYPES)[number]][] = [
  [/customs/, "customs_union"],
  [/vassal|protectorate|puppet|client|tribut|suzerain/, "vassal"],
  [/non.?aggression|ceasefire|armistice|peace|neutral|truce/, "nonaggression"],
  [/defen[cs]|security|mutual|guarantee/, "defensive"],
  [/allian|military|coalition/, "alliance"],
  [/trade|econom|commerc|tariff|invest|energy|free|market|financ|agri|partner|cooperat|transit|infrastructure/, "trade"],
];

export function normalizeTreatyType(value: unknown): (typeof TREATY_TYPES)[number] | null {
  if (typeof value !== "string") return null;
  const v = value.toLowerCase().trim();
  if ((TREATY_TYPES as readonly string[]).includes(v)) return v as (typeof TREATY_TYPES)[number];
  return TREATY_SYNONYMS.find(([re]) => re.test(v))?.[1] ?? null;
}

/**
 * Repair what can be repaired in a raw model reply before validation, in place: invented treaty
 * types are mapped to real ones and any single effect that still fails its schema is dropped,
 * so one malformed effect no longer sinks a whole turn. Returns a note per dropped effect.
 */
export function salvageModelOutput(raw: unknown): string[] {
  const dropped: string[] = [];
  if (!raw || typeof raw !== "object") return dropped;
  const clean = (list: unknown, where: string) => {
    if (!Array.isArray(list)) return list;
    return list.filter((e, i) => {
      if (e && typeof e === "object" && (e as { type?: unknown }).type === "createTreaty") {
        const t = normalizeTreatyType((e as { treatyType?: unknown }).treatyType);
        if (t) (e as { treatyType: string }).treatyType = t;
      }
      const ok = EffectSchema.safeParse(e);
      if (!ok.success) {
        const issue = ok.error.issues[0];
        const bad = issue?.path.length ? (issue.path as PropertyKey[]).reduce<unknown>((v, k) => (v as Record<PropertyKey, unknown>)?.[k], e) : undefined;
        dropped.push(`${where}.${i} (${(e as { type?: string })?.type ?? "?"}): ${issue ? `${issue.path.join(".") || "(root)"}: ${issue.message}` : "invalid"}${bad !== undefined ? ` (got ${JSON.stringify(bad)?.slice(0, 40)})` : ""}`);
      }
      return ok.success;
    });
  };
  const r = raw as { events?: unknown; intents?: unknown; proposal?: unknown; outreach?: unknown };
  if (Array.isArray(r.events)) {
    r.events.forEach((ev, i) => {
      if (ev && typeof ev === "object") (ev as { effects?: unknown }).effects = clean((ev as { effects?: unknown }).effects, `events.${i}.effects`);
    });
  }
  if (Array.isArray(r.intents)) {
    r.intents.forEach((it, i) => {
      if (it && typeof it === "object") (it as { selfEffects?: unknown }).selfEffects = clean((it as { selfEffects?: unknown }).selfEffects, `intents.${i}.selfEffects`);
    });
  }
  fixProposal(r.proposal);
  // Unprompted messages are extras: a malformed one is dropped rather than failing the turn.
  if (Array.isArray(r.outreach)) {
    r.outreach = r.outreach.filter((o, i) => {
      if (o && typeof o === "object") fixProposal((o as { proposal?: unknown }).proposal);
      const ok = OutreachSchema.safeParse(o).success;
      if (!ok) dropped.push(`outreach.${i}: invalid message`);
      return ok;
    });
  }
  return dropped;
}

/** Proposals: an unknown treaty type becomes the closest one, or none. */
function fixProposal(p: unknown) {
  if (!p || typeof p !== "object" || (p as { treatyType?: unknown }).treatyType === undefined) return;
  const t = normalizeTreatyType((p as { treatyType?: unknown }).treatyType);
  if (t) (p as { treatyType: string }).treatyType = t;
  else delete (p as { treatyType?: unknown }).treatyType;
}
