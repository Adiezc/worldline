// Keeps the WebGL map in step with the store: palette (map mode), ownership, labels, front lines,
// playback and the era theme. Stands aside while the scenario editor owns the map.
import { useCallback, useEffect, useRef } from "react";
import { getMap } from "../map/controller.ts";
import { useMap } from "../store.ts";
import { pushFronts } from "./fronts.ts";
import { pushOperations } from "./operations.ts";
import { computePalette } from "./mapModes.ts";
import { focusTag } from "./selectors.ts";
import { useGame } from "./store.ts";

const STEP_MS = 1100;

function sameOwners(a: ArrayLike<number> | null, b: ArrayLike<number>) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function MapSync() {
  const ready = useMap((s) => s.status === "ready");
  const scenario = useMap((s) => s.scenario);
  const editing = useMap((s) => s.editing);
  const backdropTheme = useMap((s) => s.theme);
  const viewTheme = useGame((s) => s.view?.theme);
  const view = useGame((s) => s.view);
  const hold = useGame((s) => s.mapHold);
  const mode = useGame((s) => s.mapMode);
  const showFronts = useGame((s) => s.showFronts);
  const meta = useMap((s) => s.meta);
  const focus = useGame(focusTag);
  const orgId = useGame((s) => s.selectedOrg ?? (s.view && s.view.you.country ? s.view.organizations.find((o) => o.members.includes(s.view!.you.country!))?.id ?? null : null));
  const labelled = useRef<{ owners: ArrayLike<number> | null; names: string }>({ owners: null, names: "" });

  const countries = view?.countries;
  const relations = view?.relations;
  const wars = view?.wars;
  const orgs = view?.organizations;

  // Era theme: the game's, else the menu/editor choice. Also exposed to CSS as body[data-era].
  const theme = (!editing && viewTheme) || backdropTheme;
  useEffect(() => {
    document.body.dataset.era = theme;
    if (ready) getMap()?.setTheme(theme);
  }, [ready, theme]);

  // Coming back from the editor: whatever it drew must be replaced.
  useEffect(() => {
    if (editing) labelled.current.owners = null;
  }, [editing]);

  // Palette + label ink.
  useEffect(() => {
    const map = getMap();
    if (!ready || !map || !scenario || editing) return;
    if (!countries) {
      map.setPalette(scenario.countries.map((c) => c.color));
      map.setLabelStyle(scenario.countries.map((c) => c.name), scenario.countries.map((c) => c.color));
      return;
    }
    map.setPalette(computePalette(mode, { countries, relations: relations ?? {}, wars: wars ?? [], organizations: orgs ?? [] }, { focus, orgId }));
    map.setLabelStyle(countries.map((c) => (c.alive === false ? "" : c.name)), countries.map((c) => c.color));
  }, [ready, editing, scenario, countries, relations, wars, orgs, mode, focus, orgId]);

  // Ownership + labels, unless a turn result is holding the pre-turn map.
  const owners = view?.owners ?? scenario?.owners;
  const controllers = view?.controllers ?? scenario?.controllers;
  const names = (countries ?? scenario?.countries ?? []).map((c) => c.name).join("|");
  useEffect(() => {
    const map = getMap();
    if (!ready || !map || hold || editing || !owners || !controllers) return;
    map.setOwnership(owners, controllers);
    if (!sameOwners(labelled.current.owners, owners) || labelled.current.names !== names) {
      map.recomputeLabels(owners);
      labelled.current = { owners, names };
    }
  }, [ready, editing, owners, controllers, hold, names]);

  // Front lines + troop counters for the map as drawn (runs after the ownership upload above).
  useEffect(() => {
    if (ready) pushFronts();
  }, [ready, editing, owners, controllers, hold, countries, wars, showFronts, meta]);

  // Battle plans: your orders, the plan being drawn, allies' plans and last turn's results.
  const orders = useGame((s) => s.orders);
  const opDraft = useGame((s) => s.opDraft);
  useEffect(() => {
    if (ready) pushOperations();
  }, [ready, editing, orders, opDraft, view, meta]);

  const forgetLabels = useCallback(() => {
    labelled.current.owners = null;
  }, []);
  return <PlaybackRunner onLabelsChanged={forgetLabels} />;
}

/** Steps through the last turn's events, applying each mapDiff and panning towards it. */
function PlaybackRunner({ onLabelsChanged }: { onLabelsChanged: () => void }) {
  const index = useGame((s) => s.playback?.index ?? null);
  const paused = useGame((s) => !!s.playback?.paused);

  // Apply the map change of the current step.
  useEffect(() => {
    if (index === null) return;
    const map = getMap();
    const { playback, turnBase } = useGame.getState();
    if (!playback || !map) return;
    if (index === -1) {
      if (turnBase) {
        map.setOwnership(turnBase.owners, turnBase.controllers);
        map.recomputeLabels(turnBase.owners);
        onLabelsChanged();
        pushFronts();
      }
    } else if (index < playback.events.length) {
      const ev = playback.events[index];
      if (ev.mapDiff?.length) {
        for (const d of ev.mapDiff) map.setProvince(d.province, d.owner, d.controller);
        map.recomputeLabels(map.owners());
        onLabelsChanged();
        pushFronts();
        map.focusOn(ev.mapDiff.map((d) => d.province), { minZoom: 0.45, maxZoom: 0.95, duration: 900 });
      }
    }
  }, [index, onLabelsChanged]);

  // Advance (held while a confirm dialog pauses playback).
  useEffect(() => {
    if (index === null || paused) return;
    const { playback } = useGame.getState();
    if (!playback) return;
    const done = index >= playback.events.length;
    const t = window.setTimeout(
      () => {
        if (done) useGame.setState({ playback: null, mapHold: false });
        else useGame.setState((s) => (s.playback ? { playback: { ...s.playback, index: index + 1 } } : {}));
      },
      index === -1 ? 400 : done ? 0 : STEP_MS,
    );
    return () => window.clearTimeout(t);
  }, [index, paused]);

  return null;
}
