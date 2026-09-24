import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export type SelectorStepNumber = 1 | 2 | 3;

export function SelectorStep({
  number,
  title,
  summary,
  open,
  completed,
  locked = false,
  optional = false,
  autoFocus = false,
  onToggle,
  children,
}: {
  number: SelectorStepNumber;
  title: string;
  summary: string;
  open: boolean;
  completed: boolean;
  locked?: boolean;
  optional?: boolean;
  autoFocus?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const panelId = `product-selector-step-${number}-panel`;

  return (
    <div
      className={`selector-step rounded-lg border bg-ivory transition ${
        open ? "border-champagne/55 shadow-sm" : "border-forest/10"
      } ${locked ? "opacity-55" : ""}`}
      data-selector-step={number}
      data-state={open ? "open" : completed ? "complete" : locked ? "locked" : "closed"}
    >
      <button
        type="button"
        className="grid min-h-14 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-forest focus:outline-none focus:ring-2 focus:ring-inset focus:ring-champagne sm:px-4"
        onClick={onToggle}
        disabled={locked}
        aria-expanded={open}
        aria-controls={panelId}
        autoFocus={autoFocus}
      >
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${
            completed
              ? "border-forest bg-forest text-ivory"
              : "border-champagne/55 bg-cream text-forest"
          }`}
          aria-hidden="true"
        >
          {completed ? <Check size={13} /> : number}
        </span>
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
            {title}
            {optional && (
              <span className="text-[0.62rem] font-medium uppercase tracking-[0.1em] text-forest/45">
                Facultatif
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-ink/50">
            {summary}
          </span>
        </span>
        <ChevronDown
          aria-hidden="true"
          size={17}
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      <fieldset
        id={panelId}
        className={`selector-step-content m-0 min-w-0 border-0 p-0 ${open ? "is-open" : ""}`}
        aria-hidden={!open}
        disabled={!open}
      >
        <div>
          <div className="border-t border-forest/10 px-3 pb-4 pt-3 sm:px-4">
            {children}
          </div>
        </div>
      </fieldset>
    </div>
  );
}

export function OptionGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

export function ChoiceOption({
  label,
  description,
  disabled = false,
  selected,
  onSelect,
  dataValue,
}: {
  label: string;
  description?: string;
  disabled?: boolean;
  selected: boolean;
  onSelect: () => void;
  dataValue: string;
}) {
  return (
    <button
      type="button"
      className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold uppercase tracking-[0.06em] transition focus:outline-none focus:ring-2 focus:ring-champagne focus:ring-offset-2 ${
        disabled
          ? "cursor-not-allowed border-forest/10 bg-forest/[0.035] text-forest/35"
          : selected
            ? "border-forest bg-forest text-ivory"
            : "border-forest/15 bg-cream/45 text-forest hover:border-champagne hover:bg-cream"
      }`}
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      data-selector-option={dataValue}
      data-available={disabled ? "false" : "true"}
    >
      <span className="block">{label}</span>
      {description && (
        <span className="mt-0.5 block text-[0.62rem] font-medium normal-case tracking-normal">
          {description}
        </span>
      )}
    </button>
  );
}
