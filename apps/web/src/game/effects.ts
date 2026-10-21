// Plain-language notes on the rule effects an event applied ("Ukraine stability −2", "War:
// Russia vs Ukraine"), so news cards show what actually changed, not only the story.
import type { Effect, GameView, StatKey } from "@worldline/shared";
import { fmtShortDate } from "./format.ts";
import { countryMap, RESOLUTION_LABELS, TREATY_LABELS } from "./selectors.ts";

/** up: something improved; down: something worsened or a conflict escalated. */
export type EffectTone = "up" | "down" | "neutral";

export interface EffectNote {
  text: string;
  tone: EffectTone;
}

const STAT_LABELS: Record<StatKey, string> = {
  gdp: "GDP", population: "population", stability: "stability", military: "military", warExhaustion: "war exhaustion",
};

const signed = (d: number, unit = "") => `${d > 0 ? "+" : "−"}${Number(Math.abs(d).toFixed(Math.abs(d) >= 10 ? 0 : 1))}${unit}`;
const regions = (n: number) => `${n} region${n === 1 ? "" : "s"}`;

export function describeEffects(effects: Effect[], view: Pick<GameView, "countries" | "organizations">): EffectNote[] {
  const byTag = countryMap(view.countries);
  const name = (tag: string) => byTag.get(tag)?.name ?? tag;
  const names = (tags: string[]) => (tags.length > 3 ? `${tags.slice(0, 3).map(name).join(", ")} +${tags.length - 3}` : tags.map(name).join(", "));
  const org = (id: string) => view.organizations.find((o) => o.id === id)?.abbrev ?? "an organisation";
  const notes: EffectNote[] = [];
  const add = (text: string, tone: EffectTone = "neutral") => notes.push({ text, tone });

  for (const e of effects) {
    switch (e.type) {
      case "statDelta": {
        if (Math.abs(e.delta) < 0.05) break;
        const worse = e.stat === "warExhaustion" ? e.delta > 0 : e.delta < 0;
        add(`${name(e.country)} ${STAT_LABELS[e.stat]} ${signed(e.delta, e.stat === "gdp" || e.stat === "population" ? "%" : "")}`, worse ? "down" : "up");
        break;
      }
      case "relationDelta":
        if (Math.round(e.delta)) add(`${name(e.a)}–${name(e.b)} relations ${signed(Math.round(e.delta))}`, e.delta > 0 ? "up" : "down");
        break;
      case "createTreaty":
        add(`${TREATY_LABELS[e.treatyType] ?? "Treaty"}: ${names(e.members)}`);
        break;
      case "endTreaty":
        add("A treaty ends", "down");
        break;
      case "declareWar":
        add(`War: ${names(e.attackers)} vs ${names(e.defenders)}`, "down");
        break;
      case "joinWar":
        add(`${name(e.country)} joins the war`, "down");
        break;
      case "makePeace":
        add("Peace agreed", "up");
        break;
      case "setController":
        add(`${name(e.controller)} takes ${regions(e.provinces.length)}`, "down");
        break;
      case "transferProvinces":
        add(`${name(e.from)} cedes ${regions(e.provinces.length)} to ${name(e.to)}`);
        break;
      case "spawnCountry":
        add(`New state: ${e.name}`);
        break;
      case "annexCountry":
        add(`${name(e.by)} annexes ${name(e.target)}`, "down");
        break;
      case "changeLeader":
        add(`${name(e.country)}: ${e.leader} takes office`);
        break;
      case "joinOrg":
        add(`${name(e.country)} joins the ${org(e.orgId)}`, "up");
        break;
      case "applyToOrg":
        add(`${name(e.country)} applies to the ${org(e.orgId)}`);
        break;
      case "leaveOrg":
        add(`${name(e.country)} leaves the ${org(e.orgId)}`, "down");
        break;
      case "createOrg":
        add(`New organisation: ${e.abbrev}`);
        break;
      case "proposeResolution":
        add(`${RESOLUTION_LABELS[e.resolutionType] ?? "Resolution"} tabled at the ${org(e.orgId)}`);
        break;
      case "imposeSanctions":
        add(`Sanctions on ${name(e.target)}`, "down");
        break;
      case "liftSanctions":
        add(`Sanctions on ${name(e.target)} eased`, "up");
        break;
      case "addClaim":
        add(`${name(e.claimant)} claims ${regions(e.provinces.length)}`, "down");
        break;
      case "dropClaim":
        add(`${name(e.claimant)} drops a claim`, "up");
        break;
      case "scheduleEvent":
        add(`${name(e.country)} sets a date: ${e.title}, ${fmtShortDate(e.date)}`);
        break;
      case "cancelScheduled":
        add("A scheduled date is called off");
        break;
      case "nuclearStrike":
        add(`${name(e.by)} ${e.scale === "strategic" ? "strategic" : "tactical"} nuclear strike on ${name(e.target)}`, "down");
        break;
      case "startProject":
        add(`${name(e.country)} starts a project: ${e.name}`, "up");
        break;
      case "advanceProject":
        if (Math.round(e.progress)) add(`Project ${e.progress > 0 ? "advances" : "slips"} ${signed(Math.round(e.progress), "%")}`, e.progress > 0 ? "up" : "down");
        break;
      case "endProject":
        add(`Project ${e.outcome}`, e.outcome === "completed" ? "up" : "down");
        break;
      case "updateAgenda":
        break; // internal to the AI
    }
  }
  return notes;
}
