/**
 * The two pieces of chrome every field that accepts StarCraft's `<XX>` control codes gets:
 * a bar of buttons that insert one, each drawn in the colour it produces, and a preview
 * of the string as the game draws it. `editor/textColors.ts` is the whole of the knowledge;
 * these only render it.
 *
 * They are here rather than beside the String Editor because the codes are typed in more
 * than one dialog (Map Properties' name and description, force and unit names, trigger
 * display text) — and because the dialog modules are lazy chunks that nothing on the
 * startup path may import statically.
 */
import {
  DEFAULT_TEXT_COLOR,
  INSERTABLE_CODES,
  runsOf,
  type TextLine,
} from "../../editor/textColors";

/* ── The insert bar ─────────────────────────────────────── */

export interface ColorCodeBarProps {
  /** Called with the `<XX>` text to insert at the caret. */
  onInsert: (code: string) => void;
  disabled?: boolean;
}

/**
 * One button per code. A colour shows as its own swatch with the hex on the tooltip; the
 * layout and visibility codes keep the `<XX>` label, since there is no colour to show.
 */
export function ColorCodeBar({ onInsert, disabled }: ColorCodeBarProps) {
  return (
    <span className="code-bar">
      {INSERTABLE_CODES.map((t) => (
        <button
          key={t.byte}
          type="button"
          className={t.rgb ? "code-chip" : "code-chip is-effect"}
          title={`${t.code} — ${t.label}${t.rgb ? ` (${t.rgb})` : ""}`}
          disabled={disabled}
          onClick={() => onInsert(t.code)}
        >
          {t.rgb ? <span className="code-swatch" style={{ background: t.rgb }} /> : null}
          <span className="code-label">{t.code}</span>
        </button>
      ))}
    </span>
  );
}

/* ── The preview ────────────────────────────────────────── */

export interface StringPreviewProps {
  text: string;
  /**
   * Reset the colour at every newline, the way 1.16.1 did. Off by default: Remastered
   * carries it across, and Remastered is what the map will be played on.
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
  const lines = runsOf(text, { resetPerLine });
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
      {line.runs.length === 0 ? (
        " "
      ) : (
        line.runs.map((run, i) => (
          <span
            key={i}
            className={run.invisible ? "is-hidden" : undefined}
            style={{ color: run.color }}
            title={run.invisible ? "Hidden in game" : undefined}
          >
            {run.text}
          </span>
        ))
      )}
    </div>
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

