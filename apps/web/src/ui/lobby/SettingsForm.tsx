import { useEffect, useState } from "react";
import type { GameSettings } from "@worldline/shared";
import { updateSettings } from "../../game/actions.ts";
import { JUMP_OPTIONS } from "../../game/format.ts";
import { useGame } from "../../game/store.ts";
import { Field, Panel, SectionTitle, Toggle } from "../common/ui.tsx";

const TIMERS = [
  { s: 0, label: "No timer" },
  { s: 60, label: "1 minute" },
  { s: 180, label: "3 minutes" },
  { s: 300, label: "5 minutes" },
  { s: 600, label: "10 minutes" },
  { s: 1200, label: "20 minutes" },
];

export function SettingsForm() {
  const settings = useGame((s) => s.view!.settings);
  const isHost = useGame((s) => s.view!.you.isHost);
  const [chain, setChain] = useState(settings.modelChain.join("\n"));
  useEffect(() => setChain(settings.modelChain.join("\n")), [settings.modelChain]);

  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => updateSettings({ [key]: value } as Partial<GameSettings>);
  const ro = !isHost;
  const timerOptions = TIMERS.some((t) => t.s === settings.turnTimer) ? TIMERS : [...TIMERS, { s: settings.turnTimer, label: `${settings.turnTimer} s` }];

  return (
    <Panel
      title="Rules of the World"
      subtitle={isHost ? "You are the host" : "Only the host can change these"}
      className="absolute top-16 right-3 max-h-[calc(100%-5rem)] w-[320px]"
      bodyClassName="p-4 space-y-3"
    >
      <SectionTitle>Simulation</SectionTitle>
      <Field label="Difficulty">
        <select className="hud-input" disabled={ro} value={settings.difficulty} onChange={(e) => set("difficulty", e.target.value as GameSettings["difficulty"])}>
          <option value="easy">Easy — the world bends to you</option>
          <option value="normal">Normal</option>
          <option value="hard">Hard — rivals push back</option>
          <option value="realistic">Realistic — no favours</option>
        </select>
      </Field>
      <Field label="AI behaviour">
        <select className="hud-input" disabled={ro} value={settings.aiBehaviour} onChange={(e) => set("aiBehaviour", e.target.value as GameSettings["aiBehaviour"])}>
          <option value="plausible">Plausible — leaders act in character</option>
          <option value="dynamic">Dynamic — surprises and upheaval</option>
        </select>
      </Field>

      <SectionTitle>Turns</SectionTitle>
      <Field label="Default jump">
        <select className="hud-input" disabled={ro} value={settings.jumpDays} onChange={(e) => set("jumpDays", Number(e.target.value))}>
          {JUMP_OPTIONS.map((o) => (
            <option key={o.days} value={o.days}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Turn timer">
        <select className="hud-input" disabled={ro} value={settings.turnTimer} onChange={(e) => set("turnTimer", Number(e.target.value))}>
          {timerOptions.map((t) => (
            <option key={t.s} value={t.s}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Toggle label="Players vote on the jump" checked={settings.jumpVoting} disabled={ro} onChange={(v) => set("jumpVoting", v)} />

      <SectionTitle>Language model</SectionTitle>
      <Toggle label="Economy mode (fewer AI calls)" checked={settings.economyMode} disabled={ro} onChange={(v) => set("economyMode", v)} />
      <Field label="Reasoning effort">
        <select className="hud-input" disabled={ro} value={settings.reasoningEffort} onChange={(e) => set("reasoningEffort", e.target.value as GameSettings["reasoningEffort"])}>
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
      </Field>
      <Field label="Model chain" hint="One model per line; later models are fallbacks. Plain ids go to OpenRouter; prefix anthropic:, openai:, gemini: or local: to use a direct key set on the server (e.g. anthropic:claude-opus-5-5).">
        <textarea
          className="hud-input min-h-20 resize-y font-mono text-[11.5px] leading-relaxed"
          disabled={ro}
          value={chain}
          spellCheck={false}
          onChange={(e) => setChain(e.target.value)}
          onBlur={() => {
            const list = chain.split("\n").map((l) => l.trim()).filter(Boolean);
            if (list.length && list.join("\n") !== settings.modelChain.join("\n")) set("modelChain", list);
          }}
        />
      </Field>
    </Panel>
  );
}
