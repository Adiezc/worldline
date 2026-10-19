// HUD building blocks: panels, buttons, bars, chips.
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.tsx";
import { useGame } from "../../game/store.ts";
import { countryMap } from "../../game/selectors.ts";
import { selectCountry } from "../../game/actions.ts";
import { Flag } from "./Flag.tsx";

export function Panel({
  title,
  subtitle,
  actions,
  onClose,
  children,
  className = "",
  bodyClassName = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  onClose?: () => void;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`hud-panel pointer-events-auto flex min-h-0 flex-col overflow-hidden animate-hud-in ${className}`}>
      {(title || onClose || actions) && (
        <header className="flex shrink-0 items-center gap-2 border-b border-panel-edge/50 px-4 py-2.5">
          <div className="min-w-0 flex-1">
            {title && <h2 className="truncate font-display text-[15px] tracking-[0.12em] text-gold-bright">{title}</h2>}
            {subtitle && <div className="truncate text-[11px] text-parchment/50">{subtitle}</div>}
          </div>
          {actions}
          {onClose && (
            <button onClick={onClose} className="rounded p-1 text-parchment/50 hover:bg-white/5 hover:text-parchment" aria-label="Close">
              <Icon name="close" size={14} />
            </button>
          )}
        </header>
      )}
      <div className={`hud-scroll min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const VARIANTS: Record<Variant, string> = {
  primary:
    "border-gold/80 bg-gradient-to-b from-[#b48a45] to-[#8a6630] text-[#1d140a] shadow-[inset_0_1px_0_rgb(255_235_190/0.35)] hover:from-[#c79a52] hover:to-[#9a7338]",
  secondary: "border-panel-edge bg-panel-light/80 text-parchment hover:border-gold/70 hover:text-gold-bright",
  ghost: "border-transparent bg-transparent text-parchment/70 hover:bg-white/5 hover:text-parchment",
  danger: "border-fail/60 bg-fail/10 text-[#f0b2aa] hover:bg-fail/20",
  success: "border-success/60 bg-success/10 text-[#bfe6c0] hover:bg-success/20",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  busy,
  children,
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; icon?: IconName; busy?: boolean }) {
  const sz = size === "sm" ? "h-7 px-2.5 text-[11px] gap-1.5" : size === "lg" ? "h-10 px-5 text-sm gap-2" : "h-8 px-3 text-xs gap-1.5";
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex shrink-0 items-center justify-center rounded border font-display tracking-[0.08em] whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${sz} ${VARIANTS[variant]} ${className}`}
    >
      {busy ? <Spinner /> : icon && <Icon name={icon} size={size === "sm" ? 12 : 14} />}
      {children}
    </button>
  );
}

export function IconButton({ icon, label, active, onClick, badge, className = "" }: { icon: IconName; label: string; active?: boolean; onClick?: () => void; badge?: number; className?: string }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`relative grid h-9 w-9 place-items-center rounded border transition-colors ${
        active ? "border-gold bg-gold/15 text-gold-bright" : "border-panel-edge/70 bg-panel/80 text-parchment/70 hover:border-gold/60 hover:text-parchment"
      } ${className}`}
    >
      <Icon name={icon} size={17} />
      {!!badge && (
        <span className="absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-fail px-1 text-[10px] font-semibold text-white">{badge}</span>
      )}
    </button>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-3 w-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`} />;
}

export function Bar({ value, max = 100, color, className = "" }: { value: number; max?: number; color: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-black/40 ring-1 ring-white/5 ${className}`}>
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/** Plain colour square, for legends and other non-country uses (countries get a Flag). */
export function Swatch({ color, size = 12, className = "" }: { color?: string; size?: number; className?: string }) {
  return (
    <span
      className={`inline-block shrink-0 rounded-[2px] border border-black/50 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)] ${className}`}
      style={{ background: color ?? "#777", width: size, height: size }}
    />
  );
}

/** Flag of the country with this tag in the current game (placeholder when unknown). */
export function TagFlag({ tag, size, className }: { tag: string; size?: number; className?: string }) {
  const c = useGame((s) => (s.view ? countryMap(s.view.countries).get(tag) : undefined));
  return <Flag country={c ?? { tag }} size={size} className={className} />;
}

/** Country name with its flag; click selects the country. */
export function CountryChip({ tag, onClick, small }: { tag: string; onClick?: () => void; small?: boolean }) {
  const c = useGame((s) => (s.view ? countryMap(s.view.countries).get(tag) : undefined));
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick();
        else selectCountry(tag, { focus: true });
      }}
      className={`inline-flex max-w-full items-center gap-1.5 rounded-sm border border-panel-edge/50 bg-black/20 text-parchment/85 hover:border-gold/60 hover:text-parchment ${small ? "px-1.5 py-0 text-[10.5px]" : "px-2 py-0.5 text-[11.5px]"}`}
      title={c?.name ?? tag}
    >
      <Flag country={c ?? { tag }} size={small ? 12 : 14} title={false} />
      <span className="truncate">{c?.name ?? tag}</span>
    </button>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mt-4 mb-2 flex items-center gap-2 first:mt-0">
      <h3 className="hud-label">{children}</h3>
      <div className="gilt-rule flex-1 opacity-60" />
      {right}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-2 text-xs text-parchment/40 italic">{children}</p>;
}

export function Badge({ children, tone = "gold", className = "" }: { children: ReactNode; tone?: "gold" | "red" | "green" | "grey" | "amber" | "blue"; className?: string }) {
  const tones = {
    gold: "border-gold/60 text-gold-bright bg-gold/10",
    red: "border-fail/60 text-[#f0b2aa] bg-fail/10",
    green: "border-success/60 text-[#bfe6c0] bg-success/10",
    amber: "border-partial/60 text-[#f1d39a] bg-partial/10",
    blue: "border-sky-400/50 text-sky-200 bg-sky-400/10",
    grey: "border-white/20 text-parchment/60 bg-white/5",
  };
  return <span className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-px whitespace-nowrap text-[10px] font-semibold tracking-wider uppercase ${tones[tone]} ${className}`}>{children}</span>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block">
      <span className="hud-label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-parchment/40">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 py-1 text-left text-[13px] text-parchment/85 disabled:opacity-60"
    >
      <span>{label}</span>
      <span className={`relative h-4.5 w-8 shrink-0 rounded-full border transition-colors ${checked ? "border-gold bg-gold/40" : "border-panel-edge bg-black/40"}`}>
        <span className={`absolute top-[2px] h-3 w-3 rounded-full transition-all ${checked ? "left-[15px] bg-gold-bright" : "left-[2px] bg-parchment/50"}`} />
      </span>
    </button>
  );
}

export function Modal({ children, onClose, className = "" }: { children: ReactNode; onClose?: () => void; className?: string }) {
  return (
    <div className="pointer-events-auto fixed inset-0 z-40 grid place-items-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div className={`hud-panel max-h-[86vh] max-w-full overflow-hidden animate-hud-in ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export const outcomeTone = (o: "success" | "partial" | "fail") => (o === "success" ? "green" : o === "partial" ? "amber" : "red") as "green" | "amber" | "red";
export const outcomeColor = (o: "success" | "partial" | "fail") => (o === "success" ? "#6fbf73" : o === "partial" ? "#d9a441" : "#d0574d");

/** Two-button confirmation in the HUD style (used for irreversible host actions). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel = "Confirm",
  tone = "primary",
  icon,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Portalled: HUD panels use backdrop-filter, which would trap a fixed overlay inside them.
  return createPortal(
    <Modal onClose={onCancel} className="w-[min(420px,calc(100%-2rem))]">
      <div className="px-5 pt-4 pb-3">
        <h2 className="font-display text-[16px] tracking-[0.12em] text-gold-bright">{title}</h2>
        <div className="mt-2 text-[13px] leading-relaxed text-parchment/75">{children}</div>
      </div>
      <footer className="flex justify-end gap-2 border-t border-panel-edge/50 px-5 py-3">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant={tone} icon={icon} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </Button>
      </footer>
    </Modal>,
    document.body,
  );
}
