import {
  forwardRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { Tabs as RTabs, Tooltip as RTooltip } from "radix-ui";
import { ChevronDown, ChevronUp, Construction } from "lucide-react";

/* ── Button ─────────────────────────────────────────────── */

type BtnVariant = "default" | "primary" | "danger" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "md" | "sm";
  icon?: boolean;
  active?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "default", size = "md", icon, active, className = "", type = "button", ...rest },
  ref,
) {
  const cls = [
    "btn",
    variant !== "default" ? variant : "",
    size === "sm" ? "sm" : "",
    icon ? "icon" : "",
    active ? "is-active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return <button ref={ref} type={type} className={cls} {...rest} />;
});

/* ── Inputs ─────────────────────────────────────────────── */

export function TextInput({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="text" className={`input ${className}`} {...rest} />;
}

export function TextArea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`textarea ${className}`} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: readonly (string | { value: string | number; label: string })[];
}

export function Select({ options, className = "", ...rest }: SelectProps) {
  return (
    <select className={`select ${className}`} {...rest}>
      {options.map((o) =>
        typeof o === "string" ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  );
}

export interface NumberInputProps {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  width?: number | string;
}

export function NumberInput({ value, onChange, min = -Infinity, max = Infinity, step = 1, unit, disabled, width }: NumberInputProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <span className="number" style={width ? { width } : undefined}>
      <input
        type="number"
        className="input"
        value={value}
        min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
      />
      <span className="spin">
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => onChange(clamp(value + step))} aria-label="Increment">
          <ChevronUp size={10} />
        </button>
        <button type="button" tabIndex={-1} disabled={disabled} onClick={() => onChange(clamp(value - step))} aria-label="Decrement">
          <ChevronDown size={10} />
        </button>
      </span>
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

export interface CheckProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  radio?: boolean;
}

export function Check({ label, radio, className = "", ...rest }: CheckProps) {
  return (
    <label className={`check ${className}`}>
      <input type={radio ? "radio" : "checkbox"} {...rest} />
      <span>{label}</span>
    </label>
  );
}

/* ── Layout helpers ─────────────────────────────────────── */

export function Group({ title, children, className = "", flush }: { title: string; children: ReactNode; className?: string; flush?: boolean }) {
  return (
    <fieldset className={`group ${flush ? "flush" : ""} ${className}`}>
      <legend>{title}</legend>
      {children}
    </fieldset>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <>
      <label>{label}</label>
      <div className="col" style={{ gap: 2 }}>
        {children}
        {hint && <span className="hint">{hint}</span>}
      </div>
    </>
  );
}

export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="placeholder-note">
      <Construction size={13} />
      <span>{children}</span>
    </div>
  );
}

/* ── ListBox ────────────────────────────────────────────── */

export interface ListBoxProps<T> {
  items: readonly T[];
  selected?: number | null;
  onSelect?: (index: number, item: T) => void;
  render?: (item: T, index: number) => ReactNode;
  showIndex?: boolean;
  className?: string;
  style?: React.CSSProperties;
  header?: string;
  empty?: string;
}

export function ListBox<T>({ items, selected, onSelect, render, showIndex, className = "", style, header, empty }: ListBoxProps<T>) {
  return (
    <div className={`listbox ${className}`} style={style} tabIndex={0} role="listbox">
      {header && <div className="header">{header}</div>}
      {items.length === 0 && <div className="empty">{empty ?? "Nothing here yet."}</div>}
      {items.map((it, i) => (
        <div
          key={i}
          role="option"
          aria-selected={selected === i}
          className={`item ${selected === i ? "selected" : ""}`}
          onClick={() => onSelect?.(i, it)}
        >
          {showIndex && <span className="idx">{i}</span>}
          {render ? render(it, i) : String(it)}
        </div>
      ))}
    </div>
  );
}

/** Convenience: a ListBox that manages its own selection. */
export function useSelection(initial: number | null = 0) {
  return useState<number | null>(initial);
}

/* ── Tabs ───────────────────────────────────────────────── */

export interface TabDef {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
  content: ReactNode;
}

export function Tabs({ tabs, defaultValue, value, onValueChange, compact, className = "" }: { tabs: TabDef[]; defaultValue?: string; value?: string; onValueChange?: (v: string) => void; compact?: boolean; className?: string }) {
  return (
    <RTabs.Root className={`tabs ${compact ? "compact" : ""} ${className}`} defaultValue={defaultValue ?? tabs[0]?.value} value={value} onValueChange={onValueChange}>
      <RTabs.List className="tabs-list">
        {tabs.map((t) => (
          <RTabs.Trigger key={t.value} value={t.value} className="tab">
            {t.icon}
            {t.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((t) => (
        <RTabs.Content key={t.value} value={t.value} className="tab-panel">
          {t.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}

/* ── Tooltip ────────────────────────────────────────────── */

export function Tip({ label, shortcut, children, side = "bottom" }: { label: ReactNode; shortcut?: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root delayDuration={500}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content className="tooltip" side={side} sideOffset={6}>
          <span>{label}</span>
          {shortcut && <span className="kbd">{shortcut}</span>}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

export const TooltipProvider = RTooltip.Provider;

/* ── Swatch ─────────────────────────────────────────────── */

export function Swatch({ color, size, title }: { color: string; size?: number; title?: string }) {
  return <span className="swatch" title={title} style={{ background: color, width: size, height: size }} />;
}
