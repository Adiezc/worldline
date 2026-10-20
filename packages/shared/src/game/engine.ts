// Rules engine: validates AI-proposed effects against the live state and applies the ones that
// pass. The LLM proposes, this decides. Effects are processed in order, so a declareWar earlier
// in an event legitimises an occupation later in the same event.

import type { MapIndex } from "./mapIndex.ts";
import {
  atWar, countryByTag, countryIndex, daysBetween, getRelation, humanTags, nextId, relKey, warsOf,
  type Difficulty, type Effect, type GameEvent, type GameState, type ScheduledItem, type StatKey,
} from "./state.ts";
import { pickColor } from "./colors.ts";
import { cleanGenFlag, deriveFlag } from "./flags.ts";

/** ~400 map px ≈ 2,000 km at the equator. */
const NAVAL_RANGE = 400;
/** Only these treaty types can legitimise a voluntary union (annexation). */
const UNION_TREATIES = new Set(["alliance", "vassal", "customs_union"]);

export const DIFFICULTY: Record<Difficulty, { stat: number; occupy: number; wars: number; text: string }> = {
  easy: {
    stat: 1.6, occupy: 1.6, wars: 3,
    text: "Easy: be generous to the player. Well-reasoned plans usually succeed; setbacks are mild.",
  },
  normal: {
    stat: 1, occupy: 1, wars: 2,
    text: "Normal: judge plausibility. Ambitious plans need means and preparation; conquering many regions at once without resistance is not allowed; other countries react in their own interest.",
  },
  hard: {
    stat: 0.75, occupy: 0.7, wars: 2,
    text: "Hard: plans often fail or only partly succeed without preparation, resources and allies. Rivals actively counter the player. Confident wording earns nothing.",
  },
  realistic: {
    stat: 0.55, occupy: 0.5, wars: 1,
    text: "Realistic: behave like the real world. Big changes take many turns and preparatory steps, wars are slow and costly, and grand plans frequently backfire.",
  },
};

export interface TurnContext {
  days: number;
  /** order id → country tag that issued it */
  orderCountry: Map<string, string>;
  statUsed: Map<string, number>;
  relUsed: Map<string, number>;
  occupyUsed: Map<string, number>;
  newWars: number;
  spawned: number;
  /**
   * Set only by code applying a peace both sides signed with explicitly listed regions: those
   * cessions may include land the receiver does not occupy. AI-written events never set it.
   */
  negotiated?: boolean;
  /**
   * Players' battle plans this turn. An offensive's gains must lie on its axis and stay within its
   * pace; a hold line limits how many of its regions the enemy can take.
   */
  operations?: { orderId: string; country: string; kind: "offensive" | "hold"; allowed: Set<number>; cap: number; used: number }[];
  /** Scenario calendar entries due this turn (ids `cal<index>`), which events may hold too. */
  calendar?: ScheduledItem[];
}

export function newTurnContext(days: number, orders: { id: string; country: string }[]): TurnContext {
  return {
    days,
    orderCountry: new Map(orders.map((o) => [o.id, o.country])),
    statUsed: new Map(),
    relUsed: new Map(),
    occupyUsed: new Map(),
    newWars: 0,
    spawned: 0,
  };
}

/** Regions one country may occupy per turn of `days` (the base pace for battle plans). */
export function occupyCap(state: GameState, days: number) {
  return caps(state, { days } as TurnContext).occupy;
}

function caps(state: GameState, ctx: Pick<TurnContext, "days">) {
  const months = Math.max(0.25, ctx.days / 30);
  const f = DIFFICULTY[state.settings.difficulty].stat;
  const o = DIFFICULTY[state.settings.difficulty].occupy;
  return {
    gdp: (1.5 + 1.2 * months) * f, // % per country per turn
    population: (0.6 + 0.25 * months) * f, // %
    stability: (6 + 3 * months) * f,
    military: (4 + 2.5 * months) * f,
    warExhaustion: 10 + 6 * months,
    relation: 25 + 6 * months,
    occupy: Math.ceil((3 + 2 * months) * o), // provinces per controller per turn
  };
}

const STAT_RANGE: Record<StatKey, [number, number]> = {
  gdp: [0.01, 1e6],
  population: [0.001, 5000],
  stability: [0, 100],
  military: [0, 100],
  warExhaustion: [0, 100],
};

/**
 * Validate and apply one event in place. Rejected effects are recorded on the event, and the
 * resulting map changes are recorded in `event.mapDiff` for client playback.
 */
export function applyEvent(state: GameState, map: MapIndex, event: GameEvent, ctx: TurnContext) {
  const humans = humanTags(state);
  const causedBy = new Set(event.causes.map((id) => ctx.orderCountry.get(id)).filter((t): t is string => !!t));
  const humanOk = (tag: string) => !humans.has(tag) || causedBy.has(tag);
  // An event holding a scheduled vote speaks for the country that set it: its result may change
  // that country's leader and government even when a player runs it and gave no order this turn.
  const holding = event.holds
    ? [...(state.schedule ?? []), ...(ctx.calendar ?? [])].find((i) => i.id === event.holds && i.date <= event.date)
    : undefined;
  const heldFor = new Set(holding?.countries ?? []);
  const c = caps(state, ctx);
  const rejected: { effect: Effect; reason: string }[] = [];
  const clamped: { effect: Effect; reason: string }[] = [];
  const applied: Effect[] = [];
  // Provinces whose owner/controller changed; the final values are read when the diff is built.
  const diff = new Set<number>();
  const touch = (id: number) => diff.add(id);
  const endedWars: { attackers: string[]; defenders: string[] }[] = [];
  const transferred = new Set<number>();

  const alive = (tag: string) => {
    const k = countryByTag(state, tag);
    return !!k && k.alive;
  };

  // Pairs legitimised for territorial transfer within this event. Only a peace or treaty that
  // will itself pass validation counts (a makePeace blocked by a player must not legitimise a
  // cession in the same event).
  const peacePairs = new Set<string>();
  /** Wars ended in this event, kept so cessions can check who occupied what (makePeace removes them). */
  const peaceWars: GameState["wars"] = [];
  const treatyPairs = new Set<string>();
  const unionPairs = new Set<string>();
  for (const e of event.effects) {
    if (e.type === "makePeace") {
      const w = state.wars.find((x) => x.id === e.warId);
      if (w && [...w.attackers, ...w.defenders].every(humanOk)) {
        for (const a of w.attackers) for (const d of w.defenders) peacePairs.add(relKey(a, d));
        peaceWars.push(w);
      }
    }
    if (e.type === "createTreaty" && e.members.every((m) => alive(m) && humanOk(m))) {
      for (const a of e.members) for (const b of e.members) if (a !== b) {
        treatyPairs.add(relKey(a, b));
        if (UNION_TREATIES.has(e.treatyType)) unionPairs.add(relKey(a, b));
      }
    }
  }
  const spawnedHere = new Set<string>();

  for (const effect of event.effects) {
    const reject = (reason: string) => rejected.push({ effect, reason });
    const noteClamp = (reason: string) => clamped.push({ effect, reason });
    const ok = () => applied.push(effect);
    switch (effect.type) {
      case "transferProvinces": {
        // The recipient must be a living country (annexed/merged-away tags cannot receive land).
        if (!alive(effect.from) || !alive(effect.to) || effect.from === effect.to) { reject("unknown country"); break; }
        const fromIdx = countryIndex(state, effect.from), toIdx = countryIndex(state, effect.to);
        const pair = relKey(effect.from, effect.to);
        const voluntary = humans.has(effect.from) ? causedBy.has(effect.from) : false;
        if (!peacePairs.has(pair) && !treatyPairs.has(pair) && !spawnedHere.has(effect.to) && !voluntary) {
          reject("territory only changes hands through a peace deal, a treaty, a secession or a voluntary cession");
          break;
        }
        if (humans.has(effect.from) && !causedBy.has(effect.from)) { reject(`${effect.from} is player-controlled and did not agree`); break; }
        let valid = [...new Set(effect.provinces)].filter((id) => id >= 1 && id <= map.count && state.owners[id] === fromIdx);
        if (valid.length === 0) { reject("none of those provinces belong to the ceding country"); break; }
        // A peace deal (without a treaty or a voluntary cession behind it) cedes only what the
        // receiving side actually occupies: a model guessing region ids must not hand over land
        // nobody fought for (that is how stray exclaves appeared).
        const byPeaceOnly = peacePairs.has(pair) && !treatyPairs.has(pair) && !spawnedHere.has(effect.to) && !voluntary && !ctx.negotiated;
        if (byPeaceOnly) {
          const war = peaceWars.find((w) =>
            (w.attackers.includes(effect.to) && w.defenders.includes(effect.from)) || (w.defenders.includes(effect.to) && w.attackers.includes(effect.from)));
          const side = new Set((war?.attackers.includes(effect.to) ? war.attackers : war?.defenders ?? [effect.to]).map((t) => countryIndex(state, t)));
          const notHeld = valid.filter((id) => !side.has(state.controllers[id]));
          if (notHeld.length) reject(`regions ${notHeld.join(", ")} are not occupied by ${effect.to}'s side; a peace deal cedes only occupied land`);
          valid = valid.filter((id) => side.has(state.controllers[id]));
          if (!valid.length) break;
        }
        // No transfer may strand a landlocked exclave: each region must connect to the recipient's
        // land (directly or through other regions in this transfer) or be a coast it can reach by sea.
        const linked = connectedTransfer(state, map, valid, toIdx);
        const stranded = valid.filter((id) => !linked.has(id));
        if (stranded.length) reject(`regions ${stranded.join(", ")} would be cut off from ${effect.to}`);
        valid = valid.filter((id) => linked.has(id));
        if (!valid.length) break;
        for (const id of valid) {
          state.owners[id] = toIdx;
          state.controllers[id] = toIdx;
          transferred.add(id);
          touch(id);
        }
        // Record what actually moved, not what was asked for.
        applied.push({ ...effect, provinces: valid });
        break;
      }
      case "setController": {
        const ctrlIdx = countryIndex(state, effect.controller);
        if (ctrlIdx < 0 || !alive(effect.controller)) { reject("unknown country"); break; }
        const used = ctx.occupyUsed.get(effect.controller) ?? 0;
        // Offensives this event carries out (an order with a battle plan among its causes).
        const offensives = (ctx.operations ?? []).filter((op) =>
          op.kind === "offensive" && op.country === effect.controller && event.causes.includes(op.orderId));
        const coalition = new Set<number>([ctrlIdx]);
        for (const w of warsOf(state, effect.controller)) {
          const side = w.attackers.includes(effect.controller) ? w.attackers : w.defenders;
          for (const t of side) coalition.add(countryIndex(state, t));
        }
        if (humans.has(effect.controller) && !causedBy.has(effect.controller)) {
          reject(`${effect.controller} is player-controlled; its forces only move on the player's orders`);
          break;
        }
        // Naval landings reach coasts within NAVAL_RANGE of a coastal region the coalition holds.
        const ports: number[] = [];
        for (let id = 1; id <= map.count; id++) if (map.coastal[id] && coalition.has(state.controllers[id])) ports.push(id);
        const navalReach = (target: number) => {
          if (!map.cx) return ports.length > 0; // older map index without centroids
          return ports.some((p) => {
            let dx = Math.abs(map.cx[p] - map.cx[target]);
            dx = Math.min(dx, map.width - dx);
            return Math.hypot(dx, map.cy[p] - map.cy[target]) <= NAVAL_RANGE;
          });
        };
        let moved = 0;
        const movedIds: number[] = [];
        const reasons = new Set<string>();
        for (const id of effect.provinces) {
          if (id < 1 || id > map.count) { reasons.add("unknown province"); continue; }
          const current = state.controllers[id];
          if (current === ctrlIdx) continue;
          const currentTag = state.countries[current]?.tag;
          const liberation = state.owners[id] === ctrlIdx;
          if (!currentTag || !atWar(state, effect.controller, currentTag)) { reasons.add("not at war with the current controller"); continue; }
          const adjacent = map.neighbors[id].some((n) => coalition.has(state.controllers[n]));
          const naval = map.coastal[id] && navalReach(id);
          if (!adjacent && !naval && !liberation) { reasons.add("not adjacent to territory it controls"); continue; }
          // Battle plans set their own pace; everything else keeps the general one.
          if (!offensives.length && used + moved >= c.occupy) { reasons.add(`occupation pace capped at ${c.occupy} regions per turn`); break; }
          // A defender's hold line gives up only so much ground per turn.
          const hold = ctx.operations?.find((op) => op.kind === "hold" && op.allowed.has(id) && countryIndex(state, op.country) === current);
          if (hold && hold.used >= hold.cap) { reasons.add(`${currentTag}'s hold line held`); continue; }
          // An offensive drawn on the map: gains stay on its axis and within its pace.
          if (offensives.length) {
            const op = offensives.find((x) => x.allowed.has(id) && x.used < x.cap);
            if (!op) {
              reasons.add(offensives.some((x) => x.allowed.has(id)) ? "the offensive has reached its pace for this turn" : "outside the offensive's axis of advance");
              continue;
            }
            op.used++;
          }
          if (hold) hold.used++;
          state.controllers[id] = ctrlIdx;
          touch(id);
          movedIds.push(id);
          moved++;
        }
        ctx.occupyUsed.set(effect.controller, used + moved);
        // Record only the provinces that actually changed hands.
        if (moved > 0) applied.push({ ...effect, provinces: movedIds });
        if (reasons.size) reject([...reasons].join("; "));
        break;
      }
      case "statDelta": {
        const k = countryByTag(state, effect.country);
        if (!k || !k.alive) { reject("unknown country"); break; }
        // NaN/Infinity would poison the stat (and the cap bookkeeping) permanently.
        if (!Number.isFinite(effect.delta) || !(effect.stat in STAT_RANGE)) { reject("invalid delta"); break; }
        const key = `${effect.country}|${effect.stat}`;
        const used = ctx.statUsed.get(key) ?? 0;
        const cap = c[effect.stat];
        const allowed = Math.max(-cap - used, Math.min(cap - used, effect.delta));
        if (Math.abs(allowed) < 1e-6) { reject(`${effect.stat} change already at this turn's cap`); break; }
        if (allowed !== effect.delta) noteClamp(`${effect.stat} change clamped from ${effect.delta} to ${round(allowed)}`);
        ctx.statUsed.set(key, used + allowed);
        const [lo, hi] = STAT_RANGE[effect.stat];
        if (effect.stat === "gdp" || effect.stat === "population") k[effect.stat] = clamp(k[effect.stat] * (1 + allowed / 100), lo, hi);
        else k[effect.stat] = clamp(k[effect.stat] + allowed, lo, hi);
        k[effect.stat] = round(k[effect.stat]);
        // Record the clamped delta so the event log matches what was applied.
        applied.push(allowed === effect.delta ? effect : { ...effect, delta: round(allowed) });
        break;
      }
      case "relationDelta": {
        if (!alive(effect.a) || !alive(effect.b) || effect.a === effect.b) { reject("invalid pair"); break; }
        if (!Number.isFinite(effect.delta)) { reject("invalid delta"); break; }
        const key = relKey(effect.a, effect.b);
        const used = ctx.relUsed.get(key) ?? 0;
        const allowed = Math.max(-c.relation - used, Math.min(c.relation - used, effect.delta));
        if (Math.abs(allowed) < 1e-6) { reject("relation change already at this turn's cap"); break; }
        if (allowed !== effect.delta) noteClamp(`relation change clamped from ${effect.delta} to ${round(allowed)}`);
        ctx.relUsed.set(key, used + allowed);
        state.relations[key] = clamp(Math.round(getRelation(state, effect.a, effect.b) + allowed), -100, 100);
        applied.push(allowed === effect.delta ? effect : { ...effect, delta: round(allowed) });
        break;
      }
      case "createTreaty": {
        const members = [...new Set(effect.members)];
        if (members.length < 2 || !members.every(alive)) { reject("invalid members"); break; }
        const blocked = members.find((m) => !humanOk(m));
        if (blocked) { reject(`${blocked} is player-controlled and did not agree`); break; }
        const warring = members.some((a) => members.some((b) => a < b && atWar(state, a, b) && !peacePairs.has(relKey(a, b))));
        if (warring) { reject("members are at war with each other"); break; }
        const dup = state.treaties.some((t) => t.type === effect.treatyType && sameSet(t.members, members));
        if (dup) { reject("treaty already exists"); break; }
        state.treaties.push({ id: nextId(state, "t"), type: effect.treatyType, members, name: effect.name, since: event.date });
        ok();
        break;
      }
      case "endTreaty": {
        const i = state.treaties.findIndex((t) => t.id === effect.treatyId);
        if (i < 0) { reject("no such treaty"); break; }
        state.treaties.splice(i, 1);
        ok();
        break;
      }
      case "declareWar": {
        const att = [...new Set(effect.attackers)], def = [...new Set(effect.defenders)];
        if (![...att, ...def].every(alive) || att.some((a) => def.includes(a))) { reject("invalid sides"); break; }
        const blocked = att.find((a) => !humanOk(a));
        if (blocked) { reject(`${blocked} is player-controlled and did not order a war`); break; }
        if (att.every((a) => def.every((d) => atWar(state, a, d)))) { reject("already at war"); break; }
        const npcWar = !att.some((a) => humans.has(a));
        if (npcWar && ctx.newWars >= DIFFICULTY[state.settings.difficulty].wars) { reject("too many new wars this turn"); break; }
        if (npcWar) ctx.newWars++;
        const war = {
          id: nextId(state, "w"),
          name: effect.name ?? `${att.map(nameOf(state)).join("–")} war on ${def.map(nameOf(state)).join(", ")}`,
          attackers: att, defenders: def, goal: effect.goal, since: event.date,
          calls: callsToArms(state, def, att, event.turn),
        };
        state.wars.push(war);
        for (const a of att) for (const d of def) {
          const key = relKey(a, d);
          state.relations[key] = clamp(Math.min(getRelation(state, a, d), 0) - 40, -100, 100);
        }
        ok();
        break;
      }
      case "joinWar": {
        const w = state.wars.find((x) => x.id === effect.warId);
        if (!w || !alive(effect.country)) { reject("no such war"); break; }
        if (w.attackers.includes(effect.country) || w.defenders.includes(effect.country)) { reject("already a belligerent"); break; }
        if (!humanOk(effect.country)) { reject(`${effect.country} is player-controlled and did not agree`); break; }
        w[effect.side].push(effect.country);
        w.calls = (w.calls ?? []).filter((x) => x.tag !== effect.country);
        ok();
        break;
      }
      case "makePeace": {
        const i = state.wars.findIndex((x) => x.id === effect.warId);
        if (i < 0) { reject("no such war"); break; }
        const w = state.wars[i];
        const blocked = [...w.attackers, ...w.defenders].find((t) => !humanOk(t));
        if (blocked) { reject(`${blocked} is player-controlled and has not agreed to peace`); break; }
        state.wars.splice(i, 1);
        endedWars.push(w);
        ok();
        break;
      }
      case "spawnCountry": {
        if (ctx.spawned >= 2) { reject("too many new countries this turn"); break; }
        const valid = [...new Set(effect.provinces)].filter((id) => id >= 1 && id <= map.count && state.owners[id] >= 0);
        if (valid.length === 0) { reject("no valid provinces"); break; }
        const parents = new Set(valid.map((id) => state.owners[id]));
        const blockedHuman = [...parents].map((p) => state.countries[p]).find((p) => humans.has(p.tag) && !causedBy.has(p.tag) && p.stability >= 25);
        if (blockedHuman) { reject(`${blockedHuman.tag} is player-controlled and stable enough to prevent secession`); break; }
        const tag = uniqueTag(state, effect.tag ?? effect.name);
        const idx = spawnCountry(state, map, {
          tag, name: effect.name, government: effect.government, leader: effect.leader, provinces: valid, color: effect.color, flag: effect.flag,
        });
        for (const id of valid) touch(id);
        void idx;
        spawnedHere.add(tag);
        ctx.spawned++;
        // Record the tag actually assigned so later events (and the AI's memory) can refer to it.
        applied.push({ ...effect, tag, provinces: valid, color: state.countries[idx].color, flag: state.countries[idx].flag });
        break;
      }
      case "annexCountry": {
        const target = countryByTag(state, effect.target), by = countryByTag(state, effect.by);
        if (!target?.alive || !by?.alive || target === by) { reject("invalid countries"); break; }
        if (humans.has(target.tag) && !causedBy.has(target.tag)) { reject(`${target.tag} is player-controlled`); break; }
        const tIdx = countryIndex(state, target.tag), bIdx = countryIndex(state, by.tag);
        const owned = state.owners.filter((o) => o === tIdx).length;
        const held = state.owners.filter((o, id) => o === tIdx && state.controllers[id] === bIdx).length;
        const vassal = state.treaties.some((t) => t.type === "vassal" && t.members[0] === by.tag && t.members.includes(target.tag));
        const voluntary = causedBy.has(target.tag) || unionPairs.has(relKey(target.tag, by.tag));
        if (!vassal && !voluntary && !(atWar(state, by.tag, target.tag) && held >= owned * 0.6)) {
          reject("annexation needs a vassal relationship, a voluntary union, or occupation of 60% of the target");
          break;
        }
        for (let id = 1; id <= map.count; id++) if (state.owners[id] === tIdx) {
          state.owners[id] = bIdx;
          state.controllers[id] = bIdx;
          transferred.add(id);
          touch(id);
        }
        by.gdp = round(by.gdp + target.gdp * 0.85);
        by.population = round(by.population + target.population);
        for (const id of removeCountry(state, target.tag)) touch(id);
        ok();
        break;
      }
      case "changeLeader": {
        const k = countryByTag(state, effect.country);
        if (!k?.alive) { reject("unknown country"); break; }
        // Players run the nation, not its leader: a player's leader can die, be killed or resign
        // whenever the story supports it. The form of government changes only by the player's
        // order, a scheduled vote, or real instability.
        const govLocked = humans.has(k.tag) && !causedBy.has(k.tag) && !heldFor.has(k.tag) && k.stability >= 30;
        k.leader = effect.leader;
        if (effect.government && effect.government !== k.government && govLocked) {
          const { government: _, ...leaderOnly } = effect;
          applied.push(leaderOnly);
          noteClamp(`${k.tag} is player-controlled and stable; its form of government stays`);
          break;
        }
        if (effect.government) k.government = effect.government;
        ok();
        break;
      }
      case "joinOrg": {
        const org = state.organizations.find((o) => o.id === effect.orgId);
        if (!org || !alive(effect.country)) { reject("unknown organisation or country"); break; }
        if (org.members.includes(effect.country)) { reject("already a member"); break; }
        if (!humanOk(effect.country)) { reject(`${effect.country} is player-controlled and did not apply`); break; }
        if (org.powers.includes("admitMember")) {
          // Admission is decided by the members' vote, never by the narrator.
          if (!org.candidates.some((x) => x.tag === effect.country)) org.candidates.push({ tag: effect.country, since: event.date });
          reject("membership requires a vote; recorded as an application instead");
          break;
        }
        org.members.push(effect.country);
        ok();
        break;
      }
      case "leaveOrg": {
        const org = state.organizations.find((o) => o.id === effect.orgId);
        if (!org || !org.members.includes(effect.country)) { reject("not a member"); break; }
        if (!humanOk(effect.country)) { reject(`${effect.country} is player-controlled and did not choose to leave`); break; }
        org.members = org.members.filter((m) => m !== effect.country);
        for (const m of org.members) {
          const key = relKey(m, effect.country);
          state.relations[key] = clamp(getRelation(state, m, effect.country) - 12, -100, 100);
        }
        const k = countryByTag(state, effect.country)!;
        if (org.effects.tradeBloc) k.gdp = round(k.gdp * 0.98);
        org.cohesion = clamp(org.cohesion - 8, 0, 100);
        ok();
        break;
      }
      case "createOrg": {
        const members = [...new Set(effect.members)].filter(alive);
        if (members.length < 2) { reject("needs two founding members"); break; }
        const blocked = members.find((m) => !humanOk(m));
        if (blocked) { reject(`${blocked} is player-controlled and did not agree`); break; }
        state.organizations.push({
          id: nextId(state, "o"), abbrev: effect.abbrev, name: effect.name, kind: effect.kind, members, observers: [],
          candidates: [], suspended: [],
          bodies: [{ id: "council", name: "Council", seats: [], rule: effect.rule }],
          powers: ["condemn", "sanction", "admitMember", "suspendMember", "expelMember", "tradePolicy", "custom"],
          effects: { tradeBloc: effect.tradeBloc, mutualDefense: effect.mutualDefense, forum: effect.kind === "forum" },
          cohesion: 70, founded: event.date,
        });
        ok();
        break;
      }
      case "proposeResolution": {
        const org = state.organizations.find((o) => o.id === effect.orgId);
        if (!org || !org.members.includes(effect.proposer)) { reject("proposer is not a member"); break; }
        if (!org.powers.includes(effect.resolutionType)) { reject(`${org.abbrev} cannot pass ${effect.resolutionType} resolutions`); break; }
        if (!humanOk(effect.proposer)) { reject(`${effect.proposer} is player-controlled`); break; }
        if (effect.target !== undefined && !alive(effect.target)) { reject("unknown target"); break; }
        if (!effect.target && TARGETED.has(effect.resolutionType)) { reject(`${effect.resolutionType} needs a target`); break; }
        const body = pickBody(org, effect.resolutionType);
        state.resolutions.push({
          id: nextId(state, "r"), orgId: org.id, bodyId: body.id, type: effect.resolutionType, proposer: effect.proposer,
          target: effect.target, text: effect.text, turn: state.turn + 1, status: "pending",
        });
        ok();
        break;
      }
      case "applyToOrg": {
        const org = state.organizations.find((o) => o.id === effect.orgId);
        if (!org || !alive(effect.country) || org.members.includes(effect.country)) { reject("cannot apply"); break; }
        if (!humanOk(effect.country)) { reject(`${effect.country} is player-controlled`); break; }
        if (!org.candidates.some((x) => x.tag === effect.country)) org.candidates.push({ tag: effect.country, since: event.date });
        ok();
        break;
      }
      case "imposeSanctions": {
        const by = [...new Set(effect.by)].filter((t) => alive(t) && t !== effect.target);
        if (!alive(effect.target) || by.length === 0) { reject("invalid sanction"); break; }
        const blocked = by.find((t) => !humanOk(t));
        if (blocked) { reject(`${blocked} is player-controlled`); break; }
        // Re-imposing an existing sanction must not stack (the sim weighs every sanction record).
        const fresh = by.filter((t) => !sanctioning(state, t, effect.target));
        if (fresh.length === 0) { reject("already sanctioning"); break; }
        state.sanctions.push({ id: nextId(state, "s"), target: effect.target, by: fresh, source: event.headline, since: event.date });
        for (const t of fresh) {
          const key = relKey(t, effect.target);
          state.relations[key] = clamp(getRelation(state, t, effect.target) - 10, -100, 100);
        }
        ok();
        break;
      }
      case "liftSanctions": {
        // Previously this only rejected when `by` was empty (which the schema forbids), so lifting
        // non-existent sanctions always "succeeded". Count the sanctioners actually removed.
        let lifted = 0;
        const blocked = effect.by.filter((t) => !humanOk(t) && sanctioning(state, t, effect.target));
        for (const s of state.sanctions) {
          if (s.target !== effect.target) continue;
          const keep = s.by.filter((t) => !effect.by.includes(t) || !humanOk(t));
          lifted += s.by.length - keep.length;
          s.by = keep;
        }
        state.sanctions = state.sanctions.filter((s) => s.by.length > 0);
        if (blocked.length) reject(`${blocked.join(", ")} player-controlled; their sanctions stay`);
        if (lifted === 0) { if (!blocked.length) reject("nothing to lift"); break; }
        ok();
        break;
      }
      case "updateAgenda": {
        const k = countryByTag(state, effect.country);
        if (!k?.alive || humans.has(k.tag)) { reject("only AI nations have agendas"); break; }
        k.agenda.goals = effect.goals.slice(0, 4);
        ok();
        break;
      }
      case "addClaim": {
        const ci = countryIndex(state, effect.claimant);
        if (ci < 0 || !alive(effect.claimant)) { reject("unknown country"); break; }
        if (humans.has(effect.claimant) && !causedBy.has(effect.claimant)) { reject(`${effect.claimant} is player-controlled; it only lays claims by its own orders`); break; }
        state.claims ??= [];
        const existing = new Set(state.claims.filter((c) => c.claimant === effect.claimant).flatMap((c) => c.provinces));
        const provinces = [...new Set(effect.provinces)]
          .filter((id) => id >= 1 && id <= map.count && state.owners[id] !== ci && state.owners[id] >= 0 && !existing.has(id))
          .slice(0, MAX_CLAIM_REGIONS);
        if (!provinces.length) { reject("no new regions to claim (already claimed or already its own)"); break; }
        state.claims.push({ id: nextId(state, "cl"), claimant: effect.claimant, provinces, note: effect.note.trim().slice(0, 300), since: event.date });
        applied.push({ ...effect, provinces });
        break;
      }
      case "dropClaim": {
        if (humans.has(effect.claimant) && !causedBy.has(effect.claimant)) { reject(`${effect.claimant} is player-controlled; it only renounces claims by its own decision`); break; }
        const drop = effect.provinces?.length ? new Set(effect.provinces) : null;
        let dropped = 0;
        for (const c of state.claims ?? []) {
          if (c.claimant !== effect.claimant) continue;
          const before = c.provinces.length;
          c.provinces = drop ? c.provinces.filter((id) => !drop.has(id)) : [];
          dropped += before - c.provinces.length;
        }
        state.claims = (state.claims ?? []).filter((c) => c.provinces.length);
        if (!dropped) { reject("no such claim"); break; }
        ok();
        break;
      }
      case "scheduleEvent": {
        if (!alive(effect.country)) { reject("unknown country"); break; }
        if (!humanOk(effect.country)) { reject(`${effect.country} is player-controlled; it sets dates only by its own orders`); break; }
        if (effect.date < event.date || daysBetween(event.date, effect.date) > MAX_SCHEDULE_DAYS) { reject("the date must fall within three years after the event"); break; }
        state.schedule ??= [];
        const title = effect.title.trim().slice(0, 140);
        // Setting a date again for the same vote or event moves it (a postponement).
        const same = state.schedule.find((i) => i.countries[0] === effect.country && i.kind === effect.kind &&
          (effect.kind === "election" || i.title.toLowerCase() === title.toLowerCase()));
        if (same) {
          same.date = effect.date;
          same.title = title;
        } else {
          if (state.schedule.filter((i) => i.countries[0] === effect.country).length >= MAX_SCHEDULED) { reject("too many dates already set"); break; }
          state.schedule.push({ id: nextId(state, "sch"), date: effect.date, kind: effect.kind, title, countries: [effect.country], since: event.date });
        }
        ok();
        break;
      }
      case "cancelScheduled": {
        const item = state.schedule?.find((i) => i.id === effect.id);
        if (!item) { reject("no such scheduled item"); break; }
        const blocked = item.countries.find((t) => !humanOk(t));
        if (blocked) { reject(`${blocked} is player-controlled; only its own orders call off its dates`); break; }
        state.schedule = state.schedule!.filter((i) => i !== item);
        ok();
        break;
      }
    }
  }

  // A held item is done; an event can't hold what isn't due yet.
  if (holding) state.schedule = (state.schedule ?? []).filter((i) => i.id !== holding.id);
  else delete event.holds;

  // Ending a war hands occupied land back to its owner unless the peace transferred it.
  for (const w of endedWars) {
    const sides = [...w.attackers, ...w.defenders].map((t) => countryIndex(state, t));
    for (let id = 1; id <= map.count; id++) {
      const ctl = state.controllers[id], own = state.owners[id];
      if (ctl === own || !sides.includes(ctl) || !sides.includes(own) || transferred.has(id)) continue;
      // Still fighting each other in another war: the occupation stands.
      if (atWar(state, state.countries[ctl].tag, state.countries[own].tag)) continue;
      state.controllers[id] = own;
      touch(id);
    }
  }

  // A claim is settled once the claimant owns the land; a lost capital moves.
  if (diff.size && state.claims?.length) pruneClaims(state);
  if (diff.size) relocateCapitals(state, map);

  // Countries that lost their last region cease to exist.
  const held = new Set(state.owners.filter((o) => o >= 0));
  for (let i = 0; i < state.countries.length; i++) {
    const k = state.countries[i];
    if (k.alive && !held.has(i)) {
      for (const id of removeCountry(state, k.tag) ?? []) touch(id);
    }
  }

  event.effects = applied;
  if (rejected.length) event.rejected = rejected;
  if (clamped.length) event.clamped = clamped;
  if (diff.size) event.mapDiff = [...diff].map((province) => ({ province, owner: state.owners[province], controller: state.controllers[province] }));
  return { applied, rejected, clamped };
}

const MAX_CLAIM_REGIONS = 20;
const MAX_SCHEDULE_DAYS = 3 * 365;
const MAX_SCHEDULED = 8;
/** Days a date may stay overdue (nobody held it) before it is dropped. */
const OVERDUE_DAYS = 60;

/** Drop dates long past that were never held. */
export function pruneSchedule(state: GameState) {
  if (state.schedule?.length) state.schedule = state.schedule.filter((i) => daysBetween(i.date, state.date) <= OVERDUE_DAYS);
}

/**
 * Keep every living country's capital in a region it owns: a capital lost to annexation or cession
 * moves to the country's nearest remaining region, and a country without one (newly created) gets
 * its largest region.
 */
export function relocateCapitals(state: GameState, map: MapIndex) {
  const owned = new Map<number, number[]>();
  for (let id = 1; id <= map.count; id++) {
    const o = state.owners[id];
    if (o < 0) continue;
    if (!owned.has(o)) owned.set(o, []);
    owned.get(o)!.push(id);
  }
  state.countries.forEach((c, i) => {
    const mine = owned.get(i);
    if (!c.alive || !mine?.length || c.capital === null) return;
    if (c.capital && state.owners[c.capital.province] === i) return;
    let pick = mine[0];
    if (c.capital) {
      const { x, y } = c.capital;
      const dist = (id: number) => {
        const dx = Math.abs(map.cx[id] - x);
        return Math.hypot(Math.min(dx, map.width - dx), map.cy[id] - y);
      };
      pick = mine.reduce((a, b) => (dist(b) < dist(a) ? b : a));
    } else {
      pick = mine.reduce((a, b) => ((map.area[b] ?? 0) > (map.area[a] ?? 0) ? b : a));
    }
    c.capital = { name: map.names[pick] ?? c.name, x: map.cx[pick], y: map.cy[pick], province: pick };
  });
}

/** Drop claimed regions the claimant now owns, and claims of countries that no longer exist. */
export function pruneClaims(state: GameState) {
  if (!state.claims) return;
  for (const c of state.claims) {
    const ci = countryIndex(state, c.claimant);
    c.provinces = state.countries[ci]?.alive === false || ci < 0 ? [] : c.provinces.filter((id) => state.owners[id] !== ci);
  }
  state.claims = state.claims.filter((c) => c.provinces.length);
}

/**
 * Regions of a cession that end up connected to the recipient: by land through its existing
 * territory or other ceded regions, or by sea to a coast within naval range of its own coasts.
 */
export function connectedTransfer(state: GameState, map: MapIndex, ids: number[], toIdx: number) {
  const pending = new Set(ids);
  const linked = new Set<number>();
  const owned = (id: number) => state.owners[id] === toIdx || linked.has(id);
  let grew = true;
  while (grew) {
    grew = false;
    for (const id of pending) {
      if (map.neighbors[id]?.some(owned)) {
        linked.add(id);
        pending.delete(id);
        grew = true;
      }
    }
  }
  if (pending.size && map.cx) {
    const ports: number[] = [];
    for (let id = 1; id <= map.count; id++) if (map.coastal[id] && state.owners[id] === toIdx) ports.push(id);
    for (const id of pending) {
      if (!map.coastal[id]) continue;
      const reachable = ports.some((p) => {
        let dx = Math.abs(map.cx[p] - map.cx[id]);
        dx = Math.min(dx, map.width - dx);
        return Math.hypot(dx, map.cy[p] - map.cy[id]) <= NAVAL_RANGE;
      });
      if (reachable) linked.add(id);
    }
  }
  return linked;
}

/** Members of mutual-defence organisations and defensive treaties are called to defend. */
export function callsToArms(state: GameState, defenders: string[], attackers: string[], turn: number) {
  const calls = new Map<string, string>();
  for (const d of defenders) {
    for (const org of state.organizations) {
      if (!org.effects.mutualDefense || !org.members.includes(d)) continue;
      for (const m of org.members) if (!defenders.includes(m) && !attackers.includes(m)) calls.set(m, org.abbrev);
    }
    for (const t of state.treaties) {
      if ((t.type === "defensive" || t.type === "alliance") && t.members.includes(d)) {
        for (const m of t.members) if (!defenders.includes(m) && !attackers.includes(m)) calls.set(m, t.name ?? t.type);
      }
    }
  }
  return [...calls].map(([tag, via]) => ({ tag, via, since: turn }));
}

export function pickBody(org: GameState["organizations"][number], type: GameState["resolutions"][number]["type"]) {
  return org.bodies.find((b) => b.handles?.includes(type)) ?? org.bodies[0];
}

export function spawnCountry(
  state: GameState,
  map: MapIndex,
  o: { tag: string; name: string; government: string; leader: string; provinces: number[]; color?: string; flag?: string },
) {
  const parents = new Map<number, number>();
  for (const id of o.provinces) parents.set(state.owners[id], (parents.get(state.owners[id]) ?? 0) + map.area[id]);
  let gdp = 0, pop = 0;
  for (const [p, area] of parents) {
    const parent = state.countries[p];
    const total = state.owners.reduce((s, ow, id) => (ow === p ? s + map.area[id] : s), 0);
    const share = Math.min(0.9, area / Math.max(1, total));
    gdp += parent.gdp * share * 0.8;
    pop += parent.population * share;
    parent.gdp = round(parent.gdp * (1 - share));
    parent.population = round(parent.population * (1 - share));
  }
  const idx = state.countries.length;
  const color = o.color ?? pickColor(state, map, o.provinces);
  // The flag echoes the main parent's colours unless a valid generated flag was supplied.
  const mainParent = [...parents].sort((a, b) => b[1] - a[1])[0]?.[0];
  const flag = cleanGenFlag(o.flag) ?? deriveFlag(color, o.tag, state.countries[mainParent ?? -1]?.color);
  state.countries.push({
    tag: o.tag, name: o.name, color, government: o.government, leader: o.leader,
    gdp: round(gdp), population: round(pop), stability: 40, military: 8, warExhaustion: 0,
    agenda: { persona: `Newly independent ${o.name}, seeking recognition and security.`, goals: ["Secure international recognition", "Consolidate the new state"] },
    alive: true,
    flag,
  });
  for (const id of o.provinces) {
    state.owners[id] = idx;
    state.controllers[id] = idx;
  }
  return idx;
}

/**
 * Mark a country dead and drop it from treaties, organisations, wars and sanctions. Provinces it
 * still occupied abroad go back to their owners' control (otherwise a dead country would hold
 * them forever). Returns those province ids so callers can record them in a map diff.
 */
export function removeCountry(state: GameState, tag: string): number[] {
  const k = countryByTag(state, tag);
  if (!k) return [];
  k.alive = false;
  const idx = countryIndex(state, tag);
  const drop = (list: string[]) => list.filter((m) => m !== tag);
  state.treaties = state.treaties.filter((t) => (t.members = drop(t.members)).length >= 2);
  for (const o of state.organizations) {
    o.members = drop(o.members);
    o.observers = drop(o.observers);
    o.suspended = drop(o.suspended);
    o.candidates = o.candidates.filter((c) => c.tag !== tag);
    for (const b of o.bodies) b.seats = drop(b.seats);
  }
  for (const w of state.wars) {
    w.attackers = drop(w.attackers);
    w.defenders = drop(w.defenders);
    if (w.calls) w.calls = w.calls.filter((c) => c.tag !== tag);
  }
  state.wars = state.wars.filter((w) => w.attackers.length && w.defenders.length);
  state.sanctions = state.sanctions.filter((s) => s.target !== tag && (s.by = drop(s.by)).length > 0);
  const reverted: number[] = [];
  for (let id = 1; id < state.controllers.length; id++) {
    if (state.controllers[id] === idx && state.owners[id] !== idx && state.owners[id] >= 0) {
      state.controllers[id] = state.owners[id];
      reverted.push(id);
    }
  }
  return reverted;
}

/** Whether `by` already has an active sanction on `target`. */
export function sanctioning(state: GameState, by: string, target: string) {
  return state.sanctions.some((s) => s.target === target && s.by.includes(by));
}

/** Resolution types that make no sense without a target country. */
const TARGETED = new Set<string>(["sanction", "condemn", "admitMember", "suspendMember", "expelMember"]);

export function uniqueTag(state: GameState, seed: string) {
  const letters = seed.toUpperCase().replace(/[^A-Z]/g, "");
  const base = (letters.length >= 3 ? letters.slice(0, 3) : (letters + "XXX").slice(0, 3));
  let tag = base;
  for (let i = 0; countryByTag(state, tag); i++) tag = base.slice(0, 2) + String.fromCharCode(65 + (i % 26)) + (i >= 26 ? Math.floor(i / 26) : "");
  return tag;
}

const nameOf = (state: GameState) => (tag: string) => countryByTag(state, tag)?.name ?? tag;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round = (v: number) => Math.round(v * 100) / 100;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
