import { daysBetween, projectStatus, type GameView, type Project, type ProjectSchedule } from "@worldline/shared";
import { abandonProject, addOrder, setLeftTab } from "../../game/actions.ts";
import { fmtShortDate } from "../../game/format.ts";
import { countryMap } from "../../game/selectors.ts";
import { useGame } from "../../game/store.ts";
import { Badge, Bar, Button, Empty, Panel, SectionTitle } from "../common/ui.tsx";
import { Flag } from "../common/Flag.tsx";

const SCHEDULE: Record<ProjectSchedule, { label: string; tone: "gold" | "red" | "green" | "grey" | "amber" | "blue"; color: string }> = {
  onTrack: { label: "On track", tone: "green", color: "#6fae73" },
  behind: { label: "Behind", tone: "amber", color: "#d9a441" },
  dueSoon: { label: "Due soon", tone: "blue", color: "#7fb3d9" },
  overdue: { label: "Overdue", tone: "red", color: "#d0574d" },
  completed: { label: "Completed", tone: "gold", color: "#c9a45c" },
  failed: { label: "Failed", tone: "red", color: "#d0574d" },
  abandoned: { label: "Abandoned", tone: "grey", color: "#8a8a8a" },
};

/**
 * Long-running efforts: programmes, megaprojects, reforms. Orders launch them, each turn moves
 * them on, and the schedule status is worked out from the game date.
 */
export function ProjectsPanel({ onClose }: { onClose: () => void }) {
  const view = useGame((s) => s.view)!;
  const me = view.you.country;
  const all = view.projects ?? [];
  const mine = all.filter((p) => p.country === me);
  const active = mine.filter((p) => p.status === "active");
  const finished = mine.filter((p) => p.status !== "active").slice(-8).reverse();
  const abroad = all.filter((p) => p.country !== me && p.status === "active").sort((a, b) => b.progress - a.progress).slice(0, 8);

  return (
    <Panel title="Projects" subtitle="Long-running national efforts" onClose={onClose} className="max-h-full" bodyClassName="px-4 py-3">
      {!me && <Empty>Spectators have no projects.</Empty>}
      {me && (
        <p className="mb-3 text-[11.5px] leading-snug text-parchment/55">
          Order something that takes more than one turn, such as a rail network, a reform or a build-up, and it becomes a project. Each turn moves it on; push it with further orders.
        </p>
      )}
      {me && (
        <div className="mb-3">
          <Button
            size="sm"
            icon="plus"
            onClick={() => {
              addOrder("Launch a long-term programme to ");
              setLeftTab("orders");
            }}
          >
            Draft a project order
          </Button>
        </div>
      )}
      {me && !active.length && <Empty>No projects under way.</Empty>}
      <div className="space-y-3">
        {active.map((p) => <ProjectCard key={p.id} p={p} view={view} own />)}
      </div>
      {finished.length > 0 && (
        <>
          <SectionTitle>Finished</SectionTitle>
          <ul className="space-y-1.5">
            {finished.map((p) => (
              <li key={p.id} className="flex items-center gap-2 text-[12px] text-parchment/60">
                <Badge tone={SCHEDULE[projectStatus(p, view.date)].tone}>{SCHEDULE[projectStatus(p, view.date)].label}</Badge>
                <span className="min-w-0 flex-1 truncate" title={p.goal}>{p.name}</span>
                {p.ended && <span className="shrink-0 text-[10.5px] text-parchment/40">{fmtShortDate(p.ended)}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      {abroad.length > 0 && (
        <>
          <SectionTitle>Abroad</SectionTitle>
          <div className="space-y-2">
            {abroad.map((p) => <ProjectCard key={p.id} p={p} view={view} />)}
          </div>
        </>
      )}
    </Panel>
  );
}

function ProjectCard({ p, view, own }: { p: Project; view: GameView; own?: boolean }) {
  const status = projectStatus(p, view.date);
  const s = SCHEDULE[status];
  const left = daysBetween(view.date, p.due);
  const country = countryMap(view.countries).get(p.country);
  const locked = view.phase !== "orders";
  return (
    <div className="rounded border border-panel-edge bg-black/20 px-3 py-2.5">
      <div className="flex items-start gap-2">
        {!own && <Flag country={country ?? { tag: p.country }} size={16} className="mt-0.5" />}
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] leading-snug font-semibold text-parchment">{p.name}</div>
          {own && p.goal && <div className="mt-0.5 text-[11px] leading-snug text-parchment/55">{p.goal}</div>}
        </div>
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Bar value={p.progress} color={s.color} className="flex-1" />
        <span className="w-9 text-right text-[11px] text-parchment/70 tabular-nums">{Math.round(p.progress)}%</span>
      </div>
      <div className="mt-1 text-[10.5px] text-parchment/45">
        Due {fmtShortDate(p.due)} · {left >= 0 ? `${left} days left` : `${-left} days overdue`}
      </div>
      {own && p.milestones.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {p.milestones.map((m, i) => (
            <li key={i} className={`flex items-center gap-1.5 text-[11.5px] ${m.done ? "text-parchment/80" : "text-parchment/45"}`}>
              <span className={m.done ? "text-success" : "text-parchment/30"}>{m.done ? "✓" : "○"}</span>
              <span className="min-w-0 flex-1 truncate">{m.text}</span>
              {m.done && <span className="text-[10px] text-parchment/35">{fmtShortDate(m.done)}</span>}
            </li>
          ))}
        </ul>
      )}
      {p.note && <div className="mt-2 text-[11px] leading-snug text-parchment/55 italic">{p.note}</div>}
      {own && (
        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            icon="trash"
            disabled={locked}
            onClick={() => {
              if (confirm(`Abandon "${p.name}" at ${Math.round(p.progress)}%? This cannot be undone.`)) abandonProject(p.id);
            }}
          >
            Abandon
          </Button>
        </div>
      )}
    </div>
  );
}
