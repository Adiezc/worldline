// Player actions on projects outside the turn. Starting and advancing them is the resolver's job;
// dropping one is the player's own call and takes effect at once, through the same validator.

import { applyEvent, countryByTag, newTurnContext, type GameState, type MapIndex } from "@worldline/shared";
import { makeEvent } from "./game.ts";

export function abandonProject(state: GameState, opts: { country: string; projectId: string; map: MapIndex }): { ok: boolean; message: string } {
  const p = state.projects?.find((x) => x.id === opts.projectId);
  if (!p || p.country !== opts.country) return { ok: false, message: "No such project." };
  const name = countryByTag(state, p.country)?.name ?? p.country;
  // The player's decision stands in for an order, so the validator sees the country consenting.
  const cause = `project:${p.id}`;
  const ev = makeEvent(state, {
    date: state.date,
    headline: `${name} abandons ${p.name}`,
    body: `The government of ${name} has shelved the project at ${Math.round(p.progress)}% completion.`,
    countries: [p.country],
    causes: [cause],
    effects: [{ type: "endProject", projectId: p.id, outcome: "abandoned" }],
    scope: "player",
  });
  applyEvent(state, opts.map, ev, newTurnContext(30, [{ id: cause, country: p.country }]));
  if (!ev.effects.length) return { ok: false, message: ev.rejected?.[0]?.reason ?? "The project could not be abandoned." };
  state.events.push(ev);
  return { ok: true, message: `${p.name} abandoned.` };
}
