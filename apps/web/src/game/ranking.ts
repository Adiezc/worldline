// The power ranking on the client: worked out from the view (the same rules as the server, in
// @worldline/shared) once per view, plus the tier colours the panels and the Rank map mode share.
import { powerRanking, rankMap, type GameView, type NationRank, type PowerTier } from "@worldline/shared";
import { useGame } from "./store.ts";

export const TIER_COLORS: Record<PowerTier, string> = {
  great: "#d4a838",
  major: "#5b86c0",
  regional: "#5f9a6a",
  minor: "#a39c8c",
};

export const TIER_TONES: Record<PowerTier, "gold" | "blue" | "green" | "grey"> = {
  great: "gold",
  major: "blue",
  regional: "green",
  minor: "grey",
};

type RankSource = Pick<GameView, "countries" | "owners" | "treaties" | "organizations">;

// Keyed by the countries array: a new view brings new arrays whenever anything that counts changes.
const cache = new WeakMap<object, { src: RankSource; list: NationRank[]; byTag: Map<string, NationRank> }>();

export function rankingOf(src: RankSource) {
  const hit = cache.get(src.countries);
  if (hit && hit.src.owners === src.owners && hit.src.treaties === src.treaties && hit.src.organizations === src.organizations) return hit;
  const list = powerRanking(src);
  const entry = { src, list, byTag: rankMap(list) };
  cache.set(src.countries, entry);
  return entry;
}

const EMPTY = { list: [] as NationRank[], byTag: new Map<string, NationRank>() };

/** The whole ranking, strongest first (empty before the game view arrives). */
export const useRanking = () => useGame((s) => (s.view ? rankingOf(s.view) : EMPTY));

/** One nation's rank, or null when it isn't ranked (dissolved, unknown). */
export const useRank = (tag: string | null | undefined) =>
  useGame((s) => (s.view && tag ? rankingOf(s.view).byTag.get(tag) ?? null : null));
