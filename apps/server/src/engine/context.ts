// Compact text views of the game state for prompts. Free models degrade quickly with clutter, so
// every section is one line per item, capped, and limited to the countries that matter this turn.

import {
  addDays, computeTiers, countryByTag, countryIndex, DIFFICULTY, getRelation, humanTags, provincesOf,
  type Country, type GameState, type MapIndex, type ScenarioSeed, type ScheduledItem, type Tiers, type War,
} from "@worldline/shared";

// ---- formatting ----

export const fmtGdp = (bn: number) =>
  bn >= 1000 ? `$${(bn / 1000).toFixed(bn >= 10000 ? 1 : 2)}tn` : bn >= 10 ? `$${Math.round(bn)}bn` : `$${bn.toFixed(1)}bn`;

export const fmtPop = (m: number) =>
  m >= 1000 ? `${(m / 1000).toFixed(2)}bn` : m >= 10 ? `${Math.round(m)}m` : m >= 1 ? `${m.toFixed(1)}m` : `${Math.round(m * 1000)}k`;

const r0 = (v: number) => Math.round(v);
const cap = <T>(xs: T[], n: number) => (xs.length > n ? xs.slice(0, n) : xs);
const more = (total: number, shown: number) => (total > shown ? ` (+${total - shown} more)` : "");

export const nameOf = (state: GameState, tag: string) => countryByTag(state, tag)?.name ?? tag;
export const regionName = (map: MapIndex, id: number) => map.names[id] || `Region ${id}`;

/** End of this turn's window; open-ended jumps ("until next major event") are capped at 180 days. */
export const windowEnd = (state: GameState, days: number) => addDays(state.date, days > 0 ? days : 180);

export function windowLine(state: GameState, days: number) {
  const end = windowEnd(state, days);
  return days > 0
    ? `DATE: ${state.date}. This turn covers ${days} days: START ${state.date}, END ${end}.`
    : `DATE: ${state.date}. Open-ended turn: it runs until the next major development, at most until ${end} (START ${state.date}, END ${end}).`;
}

export const difficultyLine = (state: GameState) => `DIFFICULTY ${DIFFICULTY[state.settings.difficulty].text}`;

export function behaviourLine(state: GameState) {
  return state.settings.aiBehaviour === "plausible"
    ? "AI BEHAVIOUR plausible: governments follow their real-world agendas and scheduled events, drifting only as circumstances change."
    : "AI BEHAVIOUR dynamic: governments choose freely according to their personality and interests; surprises are welcome but must stay coherent.";
}

// ---- countries ----

export function orgsOf(state: GameState, tag: string) {
  return state.organizations
    .filter((o) => o.members.includes(tag))
    .map((o) => (o.suspended.includes(tag) ? `${o.abbrev}(suspended)` : o.abbrev));
}

/** Full line: identity, stats, memberships and (for AI nations) agenda. */
export function countryDetail(state: GameState, c: Country, humans = humanTags(state)) {
  const human = humans.has(c.tag);
  const orgs = orgsOf(state, c.tag);
  const parts = [
    `${c.tag} ${c.name}${human ? " [PLAYER]" : ""} — ${c.government}, led by ${c.leader}`,
    `GDP ${fmtGdp(c.gdp)}, pop ${fmtPop(c.population)}, stability ${r0(c.stability)}, military ${r0(c.military)}` +
      (c.warExhaustion >= 1 ? `, war exhaustion ${r0(c.warExhaustion)}` : "") + (c.nuclear ? ", nuclear" : ""),
  ];
  if (orgs.length) parts.push(`orgs ${orgs.join(" ")}`);
  if (!human && c.agenda.persona) parts.push(`persona: ${c.agenda.persona}`);
  if (!human && c.agenda.goals.length) parts.push(`goals: ${c.agenda.goals.join("; ")}`);
  return parts.join(" | ");
}

export const countryBrief = (c: Country) => `${c.tag} ${c.name} ${fmtGdp(c.gdp)} stab ${r0(c.stability)} mil ${r0(c.military)}`;

/** Detailed lines for the focus set, one-liners for the top economies and the rotating background. */
export function countriesBlock(state: GameState, focus: string[], others: string[]) {
  const humans = humanTags(state);
  const live = (t: string) => countryByTag(state, t)?.alive;
  const detail = focus.filter(live).map((t) => countryDetail(state, countryByTag(state, t)!, humans));
  const brief = [...new Set(others)]
    .filter((t) => live(t) && !focus.includes(t))
    .map((t) => countryBrief(countryByTag(state, t)!) + (humans.has(t) ? " [PLAYER]" : ""));
  let out = `COUNTRIES IN FOCUS:\n${detail.join("\n")}`;
  if (brief.length) out += `\nOTHER COUNTRIES (tag name gdp stability military):\n${brief.join("\n")}`;
  return out;
}

/** Top-N economies outside the given set, for one-line summaries. */
export function topByGdp(state: GameState, exclude: Set<string>, n = 60) {
  return state.countries
    .filter((c) => c.alive && !exclude.has(c.tag))
    .sort((a, b) => b.gdp - a.gdp)
    .slice(0, n)
    .map((c) => c.tag);
}

// ---- relations, treaties, wars, sanctions, organisations ----

export function relationsBlock(state: GameState, tags: Set<string>, threshold = 25, max = 70) {
  const rows: [string, number][] = [];
  for (const [key, v] of Object.entries(state.relations)) {
    if (Math.abs(v) < threshold) continue;
    const [a, b] = key.split("|");
    if (tags.has(a) && tags.has(b)) rows.push([`${a}–${b} ${v > 0 ? "+" : ""}${v}`, Math.abs(v)]);
  }
  if (!rows.length) return "";
  rows.sort((x, y) => y[1] - x[1]);
  return `RELATIONS (-100..100, notable only): ${cap(rows, max).map((r) => r[0]).join(", ")}${more(rows.length, max)}`;
}

export function treatiesBlock(state: GameState, focus?: Set<string>, max = 45) {
  const list = state.treaties.filter((t) => !focus || t.members.some((m) => focus.has(m)));
  if (!list.length) return "TREATIES: none relevant";
  const lines = cap(list, max).map((t) => {
    const members = t.members.length > 12 ? `${t.members.slice(0, 12).join(", ")} +${t.members.length - 12}` : t.members.join(", ");
    return `${t.id} ${t.type}${t.name ? ` "${t.name}"` : ""}: ${members} (since ${t.since})`;
  });
  return `TREATIES:\n${lines.join("\n")}${more(list.length, max)}`;
}

/** Regions of the other side held by each belligerent, as "RUS holds 14 UKR regions". */
export function occupationSummary(state: GameState, w: War, map?: MapIndex) {
  const counts = new Map<string, number>();
  const regions: string[] = [];
  const sideOf = (t: string) => (w.attackers.includes(t) ? "a" : w.defenders.includes(t) ? "d" : "");
  for (let id = 1; id < state.owners.length; id++) {
    const o = state.owners[id], c = state.controllers[id];
    if (o === c || o < 0 || c < 0) continue;
    const ot = state.countries[o]?.tag, ct = state.countries[c]?.tag;
    if (!ot || !ct || !sideOf(ot) || !sideOf(ct) || sideOf(ot) === sideOf(ct)) continue;
    const key = `${ct} holds ${ot}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (map) regions.push(`${id} ${regionName(map, id)} (${ot}, held by ${ct})`);
  }
  const summary = [...counts].map(([k, n]) => `${k.replace(" holds ", ` holds ${n} `)} regions`).join(", ");
  // Exact ids, so a peace deal cedes the regions that were actually taken.
  const list = regions.length ? `; occupied regions: ${regions.slice(0, 40).join("; ")}${regions.length > 40 ? ` (+${regions.length - 40} more)` : ""}` : "";
  return summary + list;
}

export function warsBlock(state: GameState, map?: MapIndex) {
  if (!state.wars.length) return "WARS: none";
  const lines = state.wars.map((w) => {
    let s = `${w.id} "${w.name}" since ${w.since} — attackers ${w.attackers.join(", ")}; defenders ${w.defenders.join(", ")}; goal: ${w.goal}`;
    const occ = occupationSummary(state, w, map);
    if (occ) s += `; occupation: ${occ}`;
    if (w.calls?.length) s += `; CALLS TO ARMS pending: ${w.calls.map((c) => `${c.tag} (via ${c.via})`).join(", ")}`;
    return s;
  });
  return `WARS:\n${lines.join("\n")}`;
}

export function sanctionsBlock(state: GameState, max = 25) {
  if (!state.sanctions.length) return "";
  const lines = cap(state.sanctions, max).map((s) => {
    const by = s.by.length > 8 ? `${s.by.slice(0, 8).join(", ")} +${s.by.length - 8}` : s.by.join(", ");
    return `${s.target} sanctioned by ${by} (${s.source}, since ${s.since})`;
  });
  return `SANCTIONS:\n${lines.join("\n")}${more(state.sanctions.length, max)}`;
}

export function orgsBlock(state: GameState, opts: { focus?: Set<string>; maxMembers?: number } = {}) {
  const maxMembers = opts.maxMembers ?? 30;
  if (!state.organizations.length) return "";
  const lines: string[] = [];
  for (const o of state.organizations) {
    const flags = [o.kind, o.effects.mutualDefense && "mutual defence", o.effects.tradeBloc && "trade bloc"].filter(Boolean).join(", ");
    const members = o.members.length <= maxMembers ? `members ${o.members.join(" ")}` : `${o.members.length} members`;
    const bodies = o.bodies.map((b) => {
      const seats = b.seats.length ? `${b.seats.length} seats` : "all members";
      const veto = b.veto?.length ? `, veto ${b.veto.join("/")}` : "";
      const handles = b.handles?.length ? `, decides ${b.handles.join("/")}` : "";
      return `${b.id} "${b.name}" (${seats}, ${b.rule}${veto}${handles})`;
    }).join("; ");
    let s = `${o.id} ${o.abbrev} — ${o.name} [${flags}] ${members}; cohesion ${r0(o.cohesion)}; bodies: ${bodies}; powers: ${o.powers.join("/")}`;
    if (o.candidates.length) s += `; candidates ${o.candidates.map((c) => c.tag).join(" ")}`;
    if (o.suspended.length) s += `; suspended ${o.suspended.join(" ")}`;
    lines.push(s);
    for (const r of state.resolutions.filter((x) => x.orgId === o.id)) {
      const what = `${r.type}${r.target ? ` on ${r.target}` : ""} by ${r.proposer}: "${r.text}"`;
      if (r.status === "pending") lines.push(`  pending ${r.id} [${r.bodyId}] ${what} (vote turn ${r.turn})`);
      else if (r.turn >= state.turn - 1) lines.push(`  ${r.status.toUpperCase()} ${r.id} [${r.bodyId}] ${what}`);
    }
  }
  return `ORGANISATIONS:\n${lines.join("\n")}`;
}

// ---- regions ----

export interface FrontRegion {
  warId: string;
  province: number;
  owner: string;
  controller: string;
  /** Enemy belligerent next to it, i.e. who could take it. */
  by: string;
}

/** Provinces held by one side of a war that touch provinces held by the other side. */
export function frontLines(state: GameState, map: MapIndex, w: War, max = 40): FrontRegion[] {
  const att = new Set(w.attackers.map((t) => countryIndex(state, t)));
  const def = new Set(w.defenders.map((t) => countryIndex(state, t)));
  const out: FrontRegion[] = [];
  for (let id = 1; id <= map.count && out.length < max; id++) {
    const ctl = state.controllers[id];
    const mine = att.has(ctl) ? att : def.has(ctl) ? def : null;
    if (!mine) continue;
    const enemy = mine === att ? def : att;
    const n = map.neighbors[id].find((x) => enemy.has(state.controllers[x]));
    if (n === undefined) continue;
    out.push({
      warId: w.id, province: id, owner: state.countries[state.owners[id]]?.tag ?? "?",
      controller: state.countries[ctl].tag, by: state.countries[state.controllers[n]].tag,
    });
  }
  return out;
}

/** Province ids of other countries bordering a player country. */
export function borderRegions(state: GameState, map: MapIndex, tag: string, max = 50) {
  const idx = countryIndex(state, tag);
  const out = new Set<number>();
  for (let id = 1; id <= map.count; id++) {
    if (state.owners[id] !== idx) continue;
    for (const n of map.neighbors[id]) if (state.owners[n] !== idx && state.owners[n] >= 0) out.add(n);
  }
  return cap([...out].sort((a, b) => a - b), max);
}

export function regionsBlock(state: GameState, map: MapIndex) {
  const humans = [...humanTags(state)].filter((t) => countryByTag(state, t)?.alive);
  const tagAt = (i: number) => state.countries[i]?.tag ?? "?";
  const lines: string[] = [];
  for (const h of humans) {
    const own = provincesOf(state, h).map((id) => {
      const held = state.controllers[id] !== state.owners[id] ? ` held by ${tagAt(state.controllers[id])}` : "";
      return `${id}:${regionName(map, id)}${held}`;
    });
    lines.push(`${h} regions: ${own.join(", ")}`);
    const border = borderRegions(state, map, h).map((id) => `${id}:${regionName(map, id)}(${tagAt(state.owners[id])})`);
    if (border.length) lines.push(`Bordering ${h}: ${border.join(", ")}`);
  }
  for (const w of state.wars) {
    const front = frontLines(state, map, w).map((f) => `${f.province}:${regionName(map, f.province)}(${f.owner}/${f.controller})`);
    if (front.length) lines.push(`Front ${w.id} (owner/controller): ${front.join(", ")}`);
  }
  return lines.length ? `REGIONS (use these ids in effects):\n${lines.join("\n")}` : "";
}

// ---- formations, memory, events, calendar ----

/** Territorial disputes: who claims which regions held by whom, and the basis of each claim. */
export function disputesBlock(state: GameState, map: MapIndex, involving?: Set<string>) {
  const lines = (state.claims ?? []).flatMap((c) => {
    const holders = [...new Set(c.provinces.map((id) => state.countries[state.owners[id]]?.tag).filter((t): t is string => !!t))];
    if (involving && !involving.has(c.claimant) && !holders.some((h) => involving.has(h))) return [];
    const regions = c.provinces.length <= 6 ? c.provinces.map((id) => `${regionName(map, id)} (${id})`).join(", ") : `${c.provinces.length} regions`;
    return [`${c.claimant} claims ${regions} held by ${holders.join("/")}: ${c.note}`];
  });
  return lines.length
    ? `TERRITORIAL DISPUTES (grievances and context, not permission; most stay frozen for decades, but they shape how governments and the world read a crisis):\n${lines.join("\n")}`
    : "";
}

export function memoryBlock(state: GameState, seed: ScenarioSeed) {
  const parts: string[] = [];
  if (state.turn <= 3) parts.push(`WORLD BRIEF (start of the scenario):\n${seed.worldBrief}`);
  else if (!state.memory.length) parts.push(`WORLD BRIEF (abridged):\n${abridge(seed.worldBrief, 700)}`);
  if (state.memory.length) parts.push(`HISTORY SO FAR:\n${state.memory.map((m) => `- (to turn ${m.upToTurn}) ${m.text}`).join("\n")}`);
  return parts.join("\n\n");
}

function abridge(text: string, n: number) {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const stop = cut.lastIndexOf(". ");
  return (stop > n * 0.5 ? cut.slice(0, stop + 1) : cut) + " …";
}

/** Headlines of the last two turns (and anything already dated in the current one). */
/** `bodies`: add each event's text (clipped), so a speaker knows what actually happened. */
export function recentEventsBlock(state: GameState, opts: { involving?: Set<string>; max?: number; bodies?: boolean } = {}) {
  const max = opts.max ?? 40;
  let list = state.events.filter((e) => e.turn >= state.turn - 2);
  if (opts.involving) list = list.filter((e) => e.countries.some((t) => opts.involving!.has(t)));
  if (!list.length) return "";
  const lines = list.slice(-max).map((e) =>
    `${e.date} ${e.headline} [${e.countries.join(",")}]${opts.bodies && e.body ? ` — ${clip(e.body.replace(/\s+/g, " "), 240)}` : ""}`);
  return `RECENT EVENTS:\n${lines.join("\n")}`;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * What players ordered in the last few turns and how each order went, so the adjudicator can
 * credit groundwork already laid (or see a plan that keeps failing) instead of judging every
 * order cold. `country` limits it to one player's own orders (they are private).
 */
export function orderHistoryBlock(state: GameState, opts: { country?: string; turns?: number; maxPerCountry?: number } = {}) {
  const turns = opts.turns ?? 2, max = opts.maxPerCountry ?? 6;
  const tags = opts.country ? [opts.country] : [...humanTags(state)];
  const recent = (state.verdictLog ?? []).filter((v) => v.turn >= state.turn - turns && v.text);
  const lines = tags.flatMap((tag) => recent.filter((v) => v.country === tag).slice(-max).map((v) =>
    `- ${v.date} ${tag}: "${clip(v.text!.replace(/\s+/g, " "), 160)}" → ${v.outcome.toUpperCase()}: ${clip(v.reason.replace(/\s+/g, " "), 160)}`));
  return lines.length ? `${opts.country ? "YOUR RECENT ORDERS" : "PLAYERS' EARLIER ORDERS"} (last ${turns} turns and how they went):\n${lines.join("\n")}` : "";
}

/**
 * What governments told each other in diplomatic talks recently: the last few statements and
 * every proposal with its outcome, per conversation. Turn prompts use it so the news stays
 * consistent with what was said at the table.
 */
export function diplomacyBlock(state: GameState, opts: { involving?: Set<string>; maxChats?: number } = {}) {
  const recent = state.chats
    .filter((c) => c.messages.length && c.lastTurn >= state.turn - 2)
    .filter((c) => !opts.involving || c.members.some((t) => opts.involving!.has(t)))
    .sort((a, b) => b.lastTurn - a.lastTurn)
    .slice(0, opts.maxChats ?? 8);
  if (!recent.length) return "";
  const blocks = recent.map((c) => {
    const lines = c.messages.slice(-6).map((m) => {
      let line = `  ${m.at} ${m.from}: ${m.text ? `"${clip(m.text.replace(/\s+/g, " "), 260)}"` : "(proposal only)"}`;
      const p = m.proposal;
      if (p) {
        const what = p.kind === "endWar"
          ? `peace treaty${p.cessions?.length ? ` (${p.cessions.map((x) => `${x.from} cedes ${x.provinces.length} region(s) to ${x.to}`).join("; ")})` : p.peace === "keep_occupied" ? " (each side keeps what it holds)" : " (white peace)"}`
          : p.kind === "treaty" ? `${p.treatyType ?? "treaty"}` : p.kind;
        line += `\n    PROPOSAL ${what} among ${p.members.join(", ")}: ${p.status.toUpperCase()}${p.status === "open" && p.awaiting.length ? ` (awaiting ${p.awaiting.join(", ")})` : ""}`;
      }
      return line;
    });
    return `${c.members.join(" / ")}:\n${lines.join("\n")}`;
  });
  return `DIPLOMACY (recent talks between governments, latest last; accepted proposals have already taken effect):\n${blocks.join("\n")}`;
}

/**
 * What falls due between `from` and `to`: the scenario's calendar (ids `cal<index>`) and the dates
 * governments set during the game, including ones already overdue because nobody held them.
 */
export function calendarIn(state: GameState, seed: ScenarioSeed, from: string, to: string): ScheduledItem[] {
  const fixed = (seed.calendar ?? []).flatMap((c, i) => (c.date >= from && c.date <= to ? [{ ...c, id: `cal${i}`, since: "" }] : []));
  const set = (state.schedule ?? []).filter((i) => i.date <= to);
  return [...fixed, ...set].sort((a, b) => a.date.localeCompare(b.date));
}

export function calendarBlock(state: GameState, seed: ScenarioSeed, from: string, to: string) {
  const line = (c: ScheduledItem) => {
    const late = c.date < from ? " OVERDUE (hold it now)" : "";
    const origin = c.since ? ` (set ${c.since})` : "";
    return `${c.id} ${c.date}${late} ${c.kind} [${c.countries.join(",")}]: ${c.title}${c.note ? ` — ${c.note}` : ""}${origin}`;
  };
  const due = calendarIn(state, seed, from, to);
  const later = (state.schedule ?? []).filter((i) => i.date > to).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);
  return [
    due.length ? `CALENDAR (due in this period; hold each in an event with "holds" set to its id):\n${due.map(line).join("\n")}` : "",
    later.length ? `DATES SET FOR LATER:\n${later.map(line).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}

export const rulesBlock = (seed: ScenarioSeed) => (seed.rules ? `SCENARIO RULES:\n${seed.rules}` : "");

// ---- the full world view used by the resolver ----

export interface WorldContext {
  text: string;
  tiers: Tiers;
  end: string;
  front: FrontRegion[];
}

export function worldContext(state: GameState, deps: { map: MapIndex; seed: ScenarioSeed }, days: number, tiers?: Tiers): WorldContext {
  const { map, seed } = deps;
  tiers ??= computeTiers(state, map);
  const end = windowEnd(state, days);
  const focus = [...tiers.engaged, ...tiers.movers];
  const tiered = new Set([...focus, ...tiers.background]);
  const others = [...topByGdp(state, tiered), ...tiers.background];
  const front = state.wars.flatMap((w) => frontLines(state, map, w));
  const text = [
    windowLine(state, days),
    difficultyLine(state),
    behaviourLine(state),
    rulesBlock(seed),
    memoryBlock(state, seed),
    countriesBlock(state, focus, others),
    relationsBlock(state, tiered),
    treatiesBlock(state, tiered),
    warsBlock(state, deps.map),
    disputesBlock(state, map),
    sanctionsBlock(state),
    orgsBlock(state),
    regionsBlock(state, map),
    recentEventsBlock(state),
    diplomacyBlock(state),
    calendarBlock(state, seed, state.date, end),
  ].filter(Boolean).join("\n\n");
  return { text, tiers, end, front };
}

/** Relation summary between one country and a list of others, e.g. "DEU +62, FRA +40". */
export const relationList = (state: GameState, tag: string, others: string[]) =>
  others.filter((t) => t !== tag).map((t) => {
    const v = getRelation(state, tag, t);
    return `${t} ${v > 0 ? "+" : ""}${v}`;
  }).join(", ");
