// Deterministic offline provider. It answers every request kind with schema-valid JSON built from
// the structured `mockContext` the engine attaches, so the game feels alive without an API key.

import { addDays, daysBetween } from "@worldline/shared";
import type { AiProvider, AiRequest, AiResponse } from "../engine/api.ts";

type Rng = () => number;

function seeded(text: string): Rng {
  // FNV-1a hash → mulberry32.
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, xs: T[]) => xs[Math.floor(rng() * xs.length)];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const spread = (from: string, to: string, i: number, n: number) =>
  addDays(from, Math.round(((i + 1) * Math.max(0, daysBetween(from, to))) / (n + 1)));

const WORLD = [
  { h: "{N} unveils a major infrastructure investment plan", b: "The government in {N} announced a multi-year programme of road, rail and grid upgrades.", stat: "gdp", d: 0.4 },
  { h: "Cost-of-living protests spread in {N}", b: "Thousands marched in the capital of {N} over fuel and food prices; police reported scattered clashes.", stat: "stability", d: -2 },
  { h: "{N} central bank cuts interest rates", b: "Policymakers in {N} lowered the key rate by 25 basis points, citing cooling inflation.", stat: "gdp", d: 0.3 },
  { h: "{N} stages large-scale military exercises", b: "Armed forces of {N} held drills involving tens of thousands of troops, drawing comment from neighbours.", stat: "military", d: 1 },
  { h: "Corruption scandal rocks government of {N}", b: "Two ministers in {N} resigned after leaked documents pointed to kickbacks on public contracts.", stat: "stability", d: -3 },
  { h: "{N} posts stronger-than-expected growth", b: "Quarterly figures from {N} beat forecasts on the back of exports and consumer spending.", stat: "gdp", d: 0.5 },
  { h: "{N} launches anti-corruption drive", b: "Prosecutors in {N} opened dozens of cases in a campaign the government says will restore trust.", stat: "stability", d: 2 },
  { h: "Port strikes disrupt trade in {N}", b: "Dockworkers in {N} walked out over pay, leaving container ships queuing offshore.", stat: "gdp", d: -0.3 },
] as const;

const INTENTS = [
  { s: "{N} passes a budget boosting infrastructure spending.", stat: "gdp", d: 0.3, others: false },
  { s: "{N} raises defence spending in a supplementary budget.", stat: "military", d: 1.5, others: false },
  { s: "{N} announces pension reform, angering unions.", stat: "stability", d: -2, others: false },
  { s: "{N} rolls out subsidies to ease energy prices.", stat: "stability", d: 1.5, others: false },
  { s: "{N} seeks deeper trade ties with its neighbours.", stat: "gdp", d: 0.2, others: true },
  { s: "{N} sends its foreign minister on a regional tour to court partners.", stat: "stability", d: 0.5, others: true },
] as const;

interface ResolverCtx {
  date: string;
  end: string;
  days: number;
  orders: { id: string; country: string; text: string }[];
  humans: string[];
  tiers: { engaged: string[]; movers: string[]; background: string[] };
  names: Record<string, string>;
  front: { warId: string; province: number; by: string; controller: string; name?: string }[];
  intents: { country: string; summary: string }[];
}

function resolver(c: ResolverCtx, rng: Rng) {
  const name = (t: string) => c.names?.[t] ?? t;
  const end = c.days === 0 ? addDays(c.date, 30) : c.end;
  const humans = new Set(c.humans ?? []);
  const npcs = [...(c.tiers?.movers ?? []), ...(c.tiers?.engaged ?? [])].filter((t) => !humans.has(t));
  const verdicts: { orderId: string; outcome: "success" | "partial"; reason: string }[] = [];
  const events: Record<string, unknown>[] = [];
  const total = (c.orders?.length ?? 0) + 4;
  let slot = 0;
  const date = () => spread(c.date, end, slot++, total);

  (c.orders ?? []).forEach((o, i) => {
    const success = i % 2 === 0;
    verdicts.push({
      orderId: o.id,
      outcome: success ? "success" : "partial",
      reason: success ? "The plan was well resourced and met little resistance." : "Progress was real but slower than hoped as opposition at home dug in.",
    });
    const stat = pick(rng, ["stability", "gdp", "military"] as const);
    const effects: Record<string, unknown>[] = [
      { type: "statDelta", country: o.country, stat, delta: stat === "gdp" ? (success ? 0.5 : 0.2) : success ? 1.5 : 0.6 },
    ];
    const partner = npcs.length && rng() < 0.4 ? pick(rng, npcs) : undefined;
    if (partner && partner !== o.country) effects.push({ type: "relationDelta", a: o.country, b: partner, delta: 3 });
    events.push({
      date: date(),
      headline: `${name(o.country)} moves ahead: ${clip(o.text.replace(/\s+/g, " "), 60)}`,
      body: `${name(o.country)} put its plan into motion. ${success ? "Officials reported smooth progress." : "Implementation proved slower than promised."}`,
      countries: partner ? [o.country, partner] : [o.country],
      causes: [o.id],
      effects,
    });
  });

  for (const intent of c.intents ?? []) {
    events.push({ date: date(), headline: intent.summary.replace(/\.$/, ""), body: intent.summary, countries: [intent.country], causes: [], effects: [] });
  }

  const worldCount = 2 + Math.floor(rng() * 3);
  for (let i = 0; i < worldCount && npcs.length; i++) {
    const t = pick(rng, npcs);
    const tpl = pick(rng, [...WORLD]);
    events.push({
      date: date(),
      headline: tpl.h.replace("{N}", name(t)),
      body: tpl.b.replace("{N}", name(t)),
      countries: [t],
      causes: [],
      effects: [{ type: "statDelta", country: t, stat: tpl.stat, delta: tpl.d }],
    });
  }

  if (c.front?.length && rng() < 0.5) {
    const f = pick(rng, c.front);
    events.push({
      date: date(),
      headline: `${name(f.by)} forces advance near ${f.name ?? `region ${f.province}`}`,
      body: `Fighting intensified along the front as ${name(f.by)} pushed into positions held by ${name(f.controller)}.`,
      countries: [f.by, f.controller],
      causes: [],
      effects: [{ type: "setController", provinces: [f.province], controller: f.by }],
    });
  }

  events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { orderVerdicts: verdicts, events, ...(c.days === 0 ? { stopDate: end } : {}) };
}

interface DirectorCtx {
  date: string;
  end: string;
  acting: { tag: string; name: string }[];
  calendar: { date: string; title: string; kind: string; countries: string[] }[];
}

function director(c: DirectorCtx, rng: Rng) {
  const pool = [...(c.acting ?? [])];
  const n = Math.min(pool.length, 3 + Math.floor(rng() * 4));
  const intents: Record<string, unknown>[] = [];
  for (let i = 0; i < n; i++) {
    const k = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const tpl = pick(rng, [...INTENTS]);
    intents.push({
      country: k.tag,
      summary: tpl.s.replace("{N}", k.name),
      selfEffects: [{ type: "statDelta", country: k.tag, stat: tpl.stat, delta: tpl.d }],
      affectsOthers: tpl.others,
    });
  }
  for (const e of c.calendar ?? []) {
    const k = c.acting?.find((a) => e.countries.includes(a.tag));
    if (!k || e.kind !== "election") continue;
    intents.push({ country: k.tag, summary: `${k.name}'s governing coalition holds on in the ${e.title}.`, selfEffects: [], affectsOthers: false });
  }
  return { intents, agendaUpdates: [], resolutions: [] };
}

function chat(c: { speaker: string; speakerName: string; player: string; playerName: string; relation: number; hasProposal: boolean }) {
  const r = c.relation ?? 0;
  const tone = r > 40 ? "warm" : r > 0 ? "neutral" : r > -40 ? "cold" : "hostile";
  const reply = {
    warm: `${c.playerName} has always been a valued friend of ${c.speakerName}. We welcome your message and are ready to work together.`,
    neutral: `${c.speakerName} has noted your message. We are open to dialogue where our interests align.`,
    cold: `${c.speakerName} sees little reason for trust at present. Actions will matter more than words.`,
    hostile: `${c.speakerName} rejects your overture. Your government knows what it must change first.`,
  }[tone];
  const out: Record<string, unknown> = {
    speaker: c.speaker, reply, tone, relationDelta: { warm: 2, neutral: 1, cold: 0, hostile: -1 }[tone],
  };
  if (c.hasProposal) {
    out.acceptsPlayerProposal = r > 20;
    out.reply = `${reply} ${r > 20 ? "We accept your proposal." : "We cannot accept your proposal at this time."}`;
  }
  return out;
}

function assessor(c: { founder: string; name: string; countries: string[]; humans: string[]; founderStability: number; relations: Record<string, number> }) {
  const humans = new Set(c.humans ?? []);
  const requirements = (c.countries ?? []).map((t) => {
    const rel = c.relations?.[t] ?? 0;
    return { text: `Reach relations above 50 with ${t}`, met: rel > 50, why: `Relations are currently ${rel}.` };
  });
  requirements.push({
    text: "Keep domestic stability above 50",
    met: c.founderStability > 50,
    why: `Stability is ${Math.round(c.founderStability)}.`,
  });
  const allMet = requirements.every((r) => r.met);
  return {
    verdict: allMet ? "achievable" : "notYet",
    requirements,
    consent: (c.countries ?? []).filter((t) => !humans.has(t)).map((t) => ({ country: t, needed: true, willing: (c.relations?.[t] ?? 0) > 50 })),
    suggestedPath: allMet ? "All conditions are in place; the union can be proclaimed." : "Build trust with each partner through treaties and summits, and keep the home front stable.",
    plan: { name: c.name, orgHandling: "The new state inherits the memberships of its founders.", reactions: [] },
  };
}

function polishText(text: string) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Maintain current policy.";
  const s = t[0].toUpperCase() + t.slice(1);
  return /[.!?]$/.test(s) ? s : `${s}.`;
}

function brainstorm(c: { name: string; goals: string[]; neighbours: string[] }) {
  const n = c.neighbours?.[0] ?? "our neighbours";
  const ideas = [
    `Negotiate a trade agreement with ${n} to cut tariffs on manufactured goods.`,
    "Raise defence spending by 0.3% of GDP and modernise air defences.",
    "Launch a public investment programme in rail and power grids, financed by green bonds.",
    "Open talks on a regional security forum with our neighbours.",
    "Pass an anti-corruption package to shore up public trust before the next election.",
  ];
  if (c.goals?.[0]) ideas.unshift(`Take a first concrete step toward our goal: ${c.goals[0]}.`);
  return { ideas: ideas.slice(0, 6) };
}

function respond(req: AiRequest, rng: Rng): unknown {
  const ctx = (req.mockContext ?? {}) as Record<string, unknown>;
  switch (req.kind) {
    case "resolver": return resolver(ctx as unknown as ResolverCtx, rng);
    case "director": return director(ctx as unknown as DirectorCtx, rng);
    case "votes": {
      const rs = (ctx.resolutions ?? []) as { id: string; voters: { tag: string; vote: string }[] }[];
      return { votes: rs.flatMap((r) => r.voters.map((v) => ({ resolutionId: r.id, country: v.tag, vote: v.vote, reason: "Consistent with its national interest." }))) };
    }
    case "chat": return chat(ctx as never);
    case "assessor": return assessor(ctx as never);
    case "polish": return { text: polishText(String(ctx.text ?? "")) };
    case "brainstorm": return brainstorm(ctx as never);
    case "consolidation": {
      const hs = ((ctx.headlines ?? []) as string[]).join("; ");
      return { summary: hs.length >= 10 ? clip(hs, 1200) : "A quiet period with no notable developments." };
    }
    case "advisor": {
      const name = String(ctx.name ?? ctx.country ?? "our country");
      const wars = (ctx.wars ?? []) as string[];
      const stab = Math.round(Number(ctx.stability ?? 50));
      return `${name} is ${stab >= 55 ? "stable at home" : "under domestic strain"} (stability ${stab}). ` +
        (wars.length ? `The ${wars[0]} dominates everything: secure allies and supplies before attempting anything ambitious. ` : "We are at peace, which gives us room to build. ") +
        "My advice: deepen trade with the largest neighbour, invest in infrastructure while borrowing is cheap, and avoid commitments we cannot back with force.";
    }
  }
}

export class MockProvider implements AiProvider {
  readonly name = "mock" as const;
  private used = 0;

  quota() {
    return { usedToday: this.used, dailyLimit: 0 };
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const delay = Number(process.env.MOCK_AI_DELAY_MS ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    this.used++;
    const out = respond(req, seeded(`${req.kind}\n${req.user}`));
    const text = typeof out === "string" ? out : JSON.stringify(out);
    return {
      text,
      usage: { model: "mock", promptTokens: Math.ceil((req.system.length + req.user.length) / 4), completionTokens: Math.ceil(text.length / 4) },
    };
  }
}
