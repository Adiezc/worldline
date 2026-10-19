// Read helpers over the GameView (pure functions + small hooks).
import type { Country, GameView, VotingRule } from "@worldline/shared";
import { relKey } from "@worldline/shared";
import { useGame } from "./store.ts";

const lookups = new WeakMap<Country[], Map<string, Country>>();

/** tag → Country, cached per countries array. */
export function countryMap(countries: Country[]) {
  let m = lookups.get(countries);
  if (!m) {
    m = new Map(countries.map((c) => [c.tag, c]));
    lookups.set(countries, m);
  }
  return m;
}

export const relationBetween = (relations: Record<string, number>, a: string, b: string) =>
  a === b ? 100 : relations[relKey(a, b)] ?? 0;

export const useView = () => useGame((s) => s.view);
export const useMyTag = () => useGame((s) => s.view?.you.country ?? null);
export const useIsHost = () => useGame((s) => !!s.view?.you.isHost);

export function useCountry(tag: string | null | undefined) {
  return useGame((s) => (s.view && tag ? countryMap(s.view.countries).get(tag) ?? null : null));
}

/** The country the right-hand panel and relative map modes focus on. */
export const focusTag = (s: { selectedCountry: string | null; view: GameView | null }) =>
  s.selectedCountry ?? s.view?.you.country ?? null;

export const RULE_LABELS: Record<VotingRule, string> = {
  consensus: "Consensus (any No blocks)",
  simpleMajority: "Simple majority",
  twoThirds: "Two-thirds majority",
  qualifiedMajority: "Qualified majority",
  vetoMajority: "Majority, permanent members hold a veto",
};

export const RESOLUTION_LABELS: Record<string, string> = {
  sanction: "Sanctions",
  condemn: "Condemnation",
  peacekeeping: "Peacekeeping mission",
  admitMember: "Admit member",
  suspendMember: "Suspend member",
  expelMember: "Expel member",
  tradePolicy: "Trade policy",
  authorizeForce: "Authorise force",
  custom: "Custom resolution",
};

export const TREATY_LABELS: Record<string, string> = {
  alliance: "Alliance",
  defensive: "Defensive pact",
  trade: "Trade agreement",
  nonaggression: "Non-aggression pact",
  vassal: "Vassalage",
  customs_union: "Customs union",
};

export const ORG_KIND_LABELS: Record<string, string> = {
  global: "Global",
  regional: "Regional",
  military: "Military",
  economic: "Economic",
  forum: "Forum",
};
