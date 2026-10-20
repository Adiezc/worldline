// Proclaiming formable nations. An order names the formable; after the turn's events are
// applied, the rules check that the founder controls the whole territory and merge in one step.
// No model call: the AI reports the world's reaction in later turns like any other news.

import { countryByTag, proclaimNation, type GameEvent, type GameState, type Order, type OrderVerdict } from "@worldline/shared";
import type { EngineDeps } from "./api.ts";
import { makeEvent } from "./game.ts";

export function proclaimFormables(state: GameState, deps: EngineDeps, orders: Order[], date: string) {
  const verdicts: OrderVerdict[] = [];
  const events: GameEvent[] = [];
  for (const o of orders) {
    if (!o.formable) continue;
    const f = deps.seed.formables.find((x) => x.id === o.formable);
    if (!f) {
      verdicts.push({ orderId: o.id, outcome: "fail", reason: "That nation cannot be formed in this world." });
      continue;
    }
    const before = countryByTag(state, o.country)?.name ?? o.country;
    const absorbed = f.countries.filter((t) => t !== o.country && countryByTag(state, t)?.alive);
    const r = proclaimNation(state, f, o.country);
    if (!r.ok) {
      verdicts.push({ orderId: o.id, outcome: "fail", reason: `The proclamation could not go ahead: ${r.problems.join("; ")}.` });
      continue;
    }
    const gone = absorbed.filter((t) => !countryByTag(state, t)?.alive);
    const ev = makeEvent(state, {
      date,
      headline: `${before} proclaims ${f.name}`,
      body: `${f.concept}${gone.length ? ` ${gone.map((t) => countryByTag(state, t)?.name ?? t).join(", ")} ${gone.length === 1 ? "is" : "are"} absorbed into the new state.` : ""}`,
      countries: [o.country, ...absorbed],
      causes: [o.id],
      scope: "player",
    });
    ev.mapDiff = r.mapDiff;
    state.events.push(ev);
    events.push(ev);
    verdicts.push({ orderId: o.id, outcome: "success", reason: `${f.name} is proclaimed.` });
  }
  return { verdicts, events };
}
