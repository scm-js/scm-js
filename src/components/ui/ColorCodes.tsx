/**
 * The chrome every field that accepts StarCraft's `<XX>` control codes gets.
 * `editor/textColors.ts` is the whole of the knowledge; these only render it.
 *
 * There are three surfaces, and a field takes as many as it has room for:
 *
 * - **read** — the string drawn the way the game draws it (`StringPreview` for a block,
 *   `InlineString` for a row). A compact field shows this *as* the field until it takes
 *   focus, so a colour costs no extra chrome at all; the source is one click away.
 * - **edit** — the ordinary input, showing the bytes escaped as `<XX>`.
 * - **insert** — `ColorCodeBar`, a button per code drawn in the colour it produces. A
 *   dialog with room keeps it open; everywhere else it is a popover on the field's own
 *   button, so four force names cost one bar rather than four.
 *
 * `ColorTextField` is those three composed, and owns the escape round trip so no caller
 * repeats it. They are here rather than beside the String Editor because the codes are
 * typed in more than one dialog — and because the dialog modules are lazy chunks that
 * nothing on the startup path may import statically.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useAtomValue } from "jotai";
import { Popover } from "radix-ui";
import { Palette } from "lucide-react";
import {
  DEFAULT_TEXT_COLOR,
  INSERTABLE_CODES,
  inlineRuns,
  runsOf,
  type TextLine,
  type TextRun,
} from "../../editor/textColors";
import { escapeControls, unescapeControls } from "../../editor/strings";
import { preferencesAtom } from "../../atoms/preferencesAtoms";

/**
 * Whether previews follow 1.16.1's rule (the colour resets at every line break) or
 * Remastered's (it carries on). One preference, so every preview in the chrome agrees;
 * a caller may still pin it to compare the two, which is what the String Editor does.
 */
export function useClassicText(): boolean {
  return useAtomValue(preferencesAtom).classicText;
}

/* ── The insert bar ─────────────────────────────────────── */

export interface ColorCodeBarProps {
  /** Called with the `<XX>` text to insert at the caret. */
  onInsert: (code: string) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * One button per code. A colour shows as its own swatch with the hex on the tooltip; the
 * layout and visibility codes keep the `<XX>` label, since there is no colour to show.
 *
 * A chip refuses the mousedown rather than taking focus: the caret it is about to insert
 * at lives in a field that must still have it when the click lands.
 */
export function ColorCodeBar({ onInsert, disabled, className = "" }: ColorCodeBarProps) {
  return (
    <span className={`code-bar ${className}`.trim()}>
      {INSERTABLE_CODES.map((t) => (
        <button
          key={t.byte}
          type="button"
          className={t.rgb ? "code-chip" : "code-chip is-effect"}
          title={`${t.code} — ${t.label}${t.rgb ? ` (${t.rgb})` : ""}`}
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInsert(t.code)}
        >
          {t.rgb ? <span className="code-swatch" style={{ background: t.rgb }} /> : null}
          <span className="code-label">{t.code}</span>
        </button>
      ))}
    </span>
  );
}

/* ── The read surfaces ──────────────────────────────────── */

export interface StringPreviewProps {
  text: string;
  /**
   * Reset the colour at every newline, the way 1.16.1 did. Left out, the `classicText`
   * preference decides; pass it only to pin one rule against the other.
   */
  resetPerLine?: boolean;
  /** Shown in place of the render when the string is empty. */
  placeholder?: string;
  className?: string;
}

/**
 * The string as StarCraft draws it: colours applied, alignment honoured, and the text an
 * `<0B>` / `<14>` hides drawn faintly with a strike rather than dropped — the point of a
 * preview in an editor is to show what is *there*, including what the player will not see.
 */
export function StringPreview({ text, resetPerLine, placeholder, className = "" }: StringPreviewProps) {
  const classic = useClassicText();
  const lines = runsOf(text, { resetPerLine: resetPerLine ?? classic });
  const empty = lines.every((l) => l.runs.every((r) => r.text === ""));
  return (
    <div className={`string-preview ${className}`.trim()} style={{ color: DEFAULT_TEXT_COLOR }}>
      {empty && placeholder ? (
        <span className="faint">{placeholder}</span>
      ) : (
        lines.map((line, i) => <PreviewLine key={i} line={line} />)
      )}
    </div>
  );
}

function PreviewLine({ line }: { line: TextLine }) {
  return (
    <div className="string-preview-line" style={{ textAlign: line.align }}>
      {line.runs.length === 0 ? " " : line.runs.map((run, i) => <Run key={i} run={run} />)}
    </div>
  );
}

function Run({ run }: { run: TextRun }) {
  return (
    <span
      className={run.invisible ? "is-hidden" : undefined}
      style={{ color: run.color }}
      title={run.invisible ? "Hidden in game" : undefined}
    >
      {run.text}
    </span>
  );
}

export interface InlineStringProps {
  /** A null entry (a blank slot in the string table) draws as the placeholder. */
  text: string | null;
  resetPerLine?: boolean;
  placeholder?: string;
  className?: string;
}

/**
 * The same reading on one line, for a list row or a field-shaped box: line breaks show as
 * a return mark rather than wrapping. Nothing here sets a background — the caller's box
 * supplies it, and every box that uses this is already the editor's own near-black, which
 * is what the game's colours were chosen against.
 *
 * Text no code has coloured keeps the chrome's own colour rather than the game's default
 * cyan (`initialColor: "inherit"`). A row or a field showing an ordinary string then looks
 * exactly as it did before there was a preview here at all, and only a string that really
 * carries a colour stands out — which is the point. The plate is where the game's own
 * default belongs, since it draws the game's own ground with it.
 */
export function InlineString({ text, resetPerLine, placeholder, className = "" }: InlineStringProps) {
  const classic = useClassicText();
  const runs = text === null ? [] : inlineRuns(text, { resetPerLine: resetPerLine ?? classic, initialColor: "inherit" });
  const empty = runs.every((r) => r.text.trim() === "");
  return (
    <span className={`string-inline ${className}`.trim()}>
      {empty && placeholder !== undefined ? (
        <span className="faint">{placeholder}</span>
      ) : (
        runs.map((run, i) => <Run key={i} run={run} />)
      )}
    </span>
  );
}

/* ── Caret-aware insertion ──────────────────────────────── */

/**
 * The insert half of a field that shows escaped text: replaces the selection in `el` with
 * `code` and puts the caret after it. The caller owns the value, so this hands back the
 * new string rather than writing it.
 */
export function insertAtCaret(el: HTMLTextAreaElement | HTMLInputElement | null, shown: string, code: string): string {
  const at = el ? el.selectionStart ?? shown.length : shown.length;
  const end = el ? el.selectionEnd ?? shown.length : shown.length;
  const next = shown.slice(0, at) + code + shown.slice(end);
  if (el) requestAnimationFrame(() => { el.focus(); el.setSelectionRange(at + code.length, at + code.length); });
  return next;
}

/* ── The field ──────────────────────────────────────────── */

export interface ColorTextFieldProps {
  /** The string as it is stored — control bytes and all, not escaped. */
  value: string;
  /** Called with the edited string, again unescaped. */
  onChange: (value: string) => void;
  /**
   * Where the read surface goes. `"swap"` (the default) makes it the field itself until
   * the field takes focus — no extra chrome, which is what lets a list of names have one
   * each. `"below"` keeps a plate under the field, for a dialog whose whole subject is
   * the string. `"none"` for a field with no room for either.
   */
  preview?: "swap" | "below" | "none";
  /**
   * The insert bar: on the field's own button (`"popover"`, the default), always open
   * above the field (`"bar"`), or absent — which is right for a string the game never
   * draws, where a colour code would only confuse the editor's own lists.
   */
  codes?: "popover" | "bar" | "none";
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
  title?: string;
  /** Goes on the input (or on the read surface standing in for it). */
  className?: string;
  /** Goes on the wrapper the bar, the field and the plate sit in — `"grow"` and the like. */
  wrapClassName?: string;
  style?: CSSProperties;
  /**
   * Goes on that wrapper. Width belongs here rather than on `style`: the field fills the
   * wrapper so that the code button can sit beside it, so a width set on the field itself
   * would do nothing.
   */
  wrapStyle?: CSSProperties;
}

/**
 * A text field whose value carries control bytes: shown escaped while it is being edited,
 * drawn the way the game draws it the rest of the time, with the codes a click away.
 */
export function ColorTextField({
  value,
  onChange,
  preview = "swap",
  codes = "popover",
  multiline,
  rows = 4,
  placeholder,
  disabled,
  maxLength,
  title,
  className = "",
  wrapClassName = "",
  style,
  wrapStyle,
}: ColorTextFieldProps) {
  const [editing, setEditing] = useState(false);
  const [barOpen, setBarOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const leaving = useRef<number | null>(null);
  const swap = preview === "swap";
  const showInput = !swap || editing;
  const shown = escapeControls(value);

  // Entering the edit surface replaces the read one, so focus has to be moved onto it by
  // hand; the caret goes to the end, since a click on coloured text cannot say where in
  // the escaped source it landed.
  useEffect(() => () => { if (leaving.current !== null) clearTimeout(leaving.current); }, []);

  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const n = el.value.length;
    el.setSelectionRange(n, n);
  }, [editing]);

  const insert = (code: string) => onChange(unescapeControls(insertAtCaret(inputRef.current, shown, code)));

  /**
   * Going back to the read surface is deferred one task on purpose. The blur arrives
   * while the browser is still moving focus onto whatever was clicked, and pulling the
   * input out of the tree in the middle of that makes a dialog's focus trap take the
   * focus back — Radix refocuses its container whenever the focused node is removed, so
   * clicking straight from one of these fields into another landed on the dialog instead.
   */
  const leave = () => {
    if (leaving.current !== null) clearTimeout(leaving.current);
    leaving.current = window.setTimeout(() => {
      leaving.current = null;
      setEditing(false);
      setBarOpen(false);
    }, 0);
  };
  const stay = () => {
    if (leaving.current === null) return;
    clearTimeout(leaving.current);
    leaving.current = null;
  };
  const boxStyle: CSSProperties | undefined = multiline ? { minHeight: `${(rows * 1.45 + 0.85).toFixed(2)}em`, ...style } : style;

  const field = showInput ? (
    multiline ? (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        className={`textarea ${className}`.trim()}
        style={boxStyle}
        rows={rows}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        title={title}
        onChange={(e) => onChange(unescapeControls(e.target.value))}
        onFocus={stay}
        onBlur={swap ? leave : () => setBarOpen(false)}
      />
    ) : (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type="text"
        className={`input ${className}`.trim()}
        style={boxStyle}
        value={shown}
        placeholder={placeholder}
        disabled={disabled}
        maxLength={maxLength}
        title={title}
        onChange={(e) => onChange(unescapeControls(e.target.value))}
        onFocus={stay}
        onBlur={swap ? leave : () => setBarOpen(false)}
      />
    )
  ) : (
    <div
      className={`${multiline ? "textarea" : "input"} color-read ${className}`.trim()}
      style={boxStyle}
      role="textbox"
      aria-readonly="true"
      tabIndex={disabled ? -1 : 0}
      title={title ?? "Click to edit the text and its <XX> codes"}
      onFocus={() => { if (!disabled) setEditing(true); }}
      onMouseDown={(e) => { if (!disabled) { e.preventDefault(); setEditing(true); } }}
    >
      <InlineString text={value} placeholder={placeholder ?? ""} />
    </div>
  );

  const body = (
    <div className={`color-text ${codes === "popover" ? "has-codes" : ""}`.trim()}>
      {field}
      {codes === "popover" && (
        <Popover.Trigger asChild>
          <button
            type="button"
            className="btn icon sm color-text-codes"
            disabled={disabled}
            title="Insert a text colour or layout code"
            aria-label="Insert a text colour code"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { if (!showInput) setEditing(true); setBarOpen((o) => !o); }}
          >
            <Palette size={12} />
          </button>
        </Popover.Trigger>
      )}
    </div>
  );

  return (
    <div className={`color-text-wrap ${wrapClassName}`.trim()} style={wrapStyle}>
      {codes === "bar" && <ColorCodeBar onInsert={insert} disabled={disabled} />}
      {codes === "popover" ? (
        <Popover.Root open={barOpen} onOpenChange={setBarOpen}>
          <Popover.Anchor asChild>{body}</Popover.Anchor>
          <Popover.Portal>
            <Popover.Content
              className="popover code-popover"
              side="bottom"
              align="start"
              sideOffset={4}
              collisionPadding={8}
              // The caret is in the field behind this; taking focus would lose it.
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <ColorCodeBar onInsert={insert} disabled={disabled} />
              <p className="hint" style={{ margin: "6px 0 0" }}>Inserted at the caret. Codes may also be typed as &lt;XX&gt;.</p>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        body
      )}
      {preview === "below" && <StringPreview text={value} placeholder={placeholder} />}
    </div>
  );
}
