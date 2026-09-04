/**
 * The colour and layout codes StarCraft reads out of a string, and what a string looks
 * like once the game has read them.
 *
 * Bytes 0x01–0x1F are control codes: most set the text colour, a few move the text or
 * hide it, and 0x09 / 0x0A / 0x0D are the ordinary whitespace `escapeControls` leaves
 * literal. The table is the one the community documents (wiki.staredit.net/wiki/Color,
 * cross-checked against the reference tables mirrored on staredit-network.fandom.com) —
 * the twelve player colours in it are the classic Brood War player palette, which is what
 * confirms the numbering. **The editor's older table was wrong from 0x12 up**: it had the
 * alignment codes one byte early and called 0x18 black, when 0x18 is player 9's green.
 *
 * `RGB` values are the palette entries the game draws with; they are constants here rather
 * than read from game data because the font palette is not one of the files `npm run
 * extract` pulls out (only `tunit.pcx` lands in `public/game/`), and a swatch needs a
 * colour whether or not the archives are present.
 *
 * ## Remastered
 *
 * `runsOf` models **Remastered's** rule, not 1.16.1's: a colour set on one line carries
 * onto the next line of the same string. In 1.16.1 every newline reset the text to the
 * default colour, so a string written before the remaster can render differently now —
 * `bleedingLines` finds exactly that case, and the Repair plugin turns it into a finding
 * offering to write the reset the old game supplied for free.
 */

/** What a control byte does. Colours carry an `rgb`; the rest are layout or visibility. */
export type CodeEffect = "color" | "mimic" | "invisible" | "align" | "clip" | "nothing" | "space";

export interface TextCode {
  byte: number;
  /** `<0E>`, the way every StarCraft editor writes it. */
  code: string;
  label: string;
  effect: CodeEffect;
  /** `#rrggbb` for `effect: "color"`, else null. */
  rgb: string | null;
  /** Which player's colour this is, for the ones that are a player colour (1-based). */
  player?: number;
}

/** `<0E>` — how every StarCraft editor writes a control byte. */
export const escapeCode = (byte: number) => `<${byte.toString(16).toUpperCase().padStart(2, "0")}>`;

const c = (byte: number, label: string, rgb: string, player?: number): TextCode =>
  ({ byte, code: escapeCode(byte), label, effect: "color", rgb, ...(player ? { player } : {}) });

const x = (byte: number, label: string, effect: CodeEffect): TextCode =>
  ({ byte, code: escapeCode(byte), label, effect, rgb: null });

/**
 * Every byte below 0x20 the game gives a meaning, in order. 0x0D is a carriage return
 * and 0x1A does nothing at all — both are listed so the editor can say so rather than
 * showing an unexplained `<XX>`.
 */
export const TEXT_CODES: readonly TextCode[] = [
  x(0x01, "Mimic (keeps the current colour)", "mimic"),
  c(0x02, "Cyan", "#b8b8e8"),
  c(0x03, "Yellow", "#dcdc3c"),
  c(0x04, "White", "#ffffff"),
  c(0x05, "Grey", "#847474"),
  c(0x06, "Red", "#c81818"),
  c(0x07, "Green", "#10fc18"),
  c(0x08, "Red — player 1", "#f40404", 1),
  x(0x09, "Tab", "space"),
  x(0x0a, "Newline", "space"),
  x(0x0b, "Invisible", "invisible"),
  x(0x0c, "Remove beyond (newline in the small font)", "clip"),
  x(0x0d, "Carriage return", "space"),
  c(0x0e, "Blue — player 2", "#0c48cc", 2),
  c(0x0f, "Teal — player 3", "#2cb494", 3),
  c(0x10, "Purple — player 4", "#88409c", 4),
  c(0x11, "Orange — player 5", "#f88c14", 5),
  x(0x12, "Right align", "align"),
  x(0x13, "Centre align", "align"),
  x(0x14, "Invisible", "invisible"),
  c(0x15, "Brown — player 6", "#703014", 6),
  c(0x16, "White — player 7", "#cce0d0", 7),
  c(0x17, "Yellow — player 8", "#fcfc38", 8),
  c(0x18, "Green — player 9", "#088008", 9),
  c(0x19, "Brighter yellow — player 10", "#fcfc7c", 10),
  x(0x1a, "Nothing", "nothing"),
  c(0x1b, "Pinkish — player 11", "#ecc4b0", 11),
  c(0x1c, "Dark cyan — player 12", "#4068d4", 12),
  c(0x1d, "Grey-green", "#74a47c"),
  c(0x1e, "Blue-grey", "#9090b8"),
  c(0x1f, "Turquoise", "#00e4fc"),
];

const BY_BYTE = new Map(TEXT_CODES.map((t) => [t.byte, t]));

export function textCode(byte: number): TextCode | undefined {
  return BY_BYTE.get(byte);
}

/**
 * The codes worth offering as buttons: the colours, plus the layout and visibility ones.
 * Tab, the newlines and the do-nothing byte are left out — they are typed, not clicked.
 */
export const INSERTABLE_CODES: readonly TextCode[] = TEXT_CODES.filter(
  (t) => t.effect !== "space" && t.effect !== "nothing",
);

/** What the game starts a string in, and what 1.16.1 reset to at every newline. */
export const DEFAULT_TEXT_COLOR = "#b8b8e8";

/* ── Reading a string the way the game draws it ──────────── */

export type Align = "left" | "right" | "center";

/** One stretch of text in a single colour. */
export interface TextRun {
  text: string;
  /** `#rrggbb`; the default colour until a code says otherwise. */
  color: string;
  /** After `<0B>` / `<14>`: the game draws nothing, but the text is still there. */
  invisible: boolean;
  /** After `<0C>` in the large font: the rest of the line is dropped. */
  clipped: boolean;
}

export interface TextLine {
  runs: TextRun[];
  align: Align;
}

export interface RunOptions {
  /**
   * Reset to `DEFAULT_TEXT_COLOR` at every newline, the way 1.16.1 did. Remastered
   * carries the colour across, which is the default here.
   */
  resetPerLine?: boolean;
  /** What `<01>` mimics and what the string starts in. */
  initialColor?: string;
}

/**
 * Split a string into lines of coloured runs. Pure, and deliberately forgiving: an
 * unknown control byte is dropped rather than shown, exactly as the game ignores it.
 */
export function runsOf(text: string, options: RunOptions = {}): TextLine[] {
  const initial = options.initialColor ?? DEFAULT_TEXT_COLOR;
  const lines: TextLine[] = [];
  let runs: TextRun[] = [];
  let align: Align = "left";
  let color = initial;
  let invisible = false;
  let clipped = false;
  let buf = "";

  const flush = () => {
    if (buf) runs.push({ text: buf, color, invisible, clipped });
    buf = "";
  };
  const endLine = () => {
    flush();
    lines.push({ runs, align });
    runs = [];
    align = "left";
    clipped = false;
    // 0x0B / 0x14 hide the rest of the string, not the rest of the line, so `invisible`
    // deliberately survives a newline; the colour only resets on the old game's rule.
    if (options.resetPerLine) color = initial;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const b = ch.charCodeAt(0);
    if (b >= 0x20 || b === 0x09) {
      // A clipped line still accumulates nothing: the game has stopped drawing it.
      if (!clipped) buf += ch;
      continue;
    }
    if (b === 0x0a) { endLine(); continue; }
    if (b === 0x0d) { if (text[i + 1] === "\n") i++; endLine(); continue; }
    const def = BY_BYTE.get(b);
    if (!def) continue;
    switch (def.effect) {
      case "color": flush(); color = def.rgb!; break;
      case "mimic": flush(); color = initial; break;
      case "invisible": flush(); invisible = true; break;
      case "clip": flush(); clipped = true; break;
      case "align": flush(); align = def.byte === 0x12 ? "right" : "center"; break;
      default: break;
    }
  }
  flush();
  lines.push({ runs, align });
  return lines;
}

/** The visible mark a line break becomes when a string is drawn on one line. */
export const NEWLINE_MARK = " \u23ce ";

/**
 * The same reading, flattened to a single line of runs — what a field or a list row shows
 * when there is one line's worth of room. Line breaks become a `NEWLINE_MARK` run in the
 * colour the line ended in, so a two-line string still reads as two lines' worth of text
 * rather than running together, and alignment (which needs a line to act on) is dropped.
 */
export function inlineRuns(text: string, options: RunOptions = {}): TextRun[] {
  const lines = runsOf(text, options);
  const out: TextRun[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) {
      const prev = out[out.length - 1];
      out.push({
        text: NEWLINE_MARK,
        color: prev?.color ?? options.initialColor ?? DEFAULT_TEXT_COLOR,
        invisible: prev?.invisible ?? false,
        clipped: false,
      });
    }
    for (const run of lines[i].runs) if (run.text !== "") out.push(run);
  }
  return out;
}

/** The text with every control byte removed — what the string actually says. */
export function plainText(text: string): string {
  let out = "";
  for (const ch of text) {
    const b = ch.charCodeAt(0);
    if (b >= 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) out += ch;
  }
  return out;
}

/* ── The Remastered newline change ───────────────────────── */

export interface BleedingLine {
  /** 0-based index of the line that inherits a colour it did not set. */
  line: number;
  /** The code Remastered carries onto it — the whole entry, so a caller can name it. */
  carried: TextCode;
}

/**
 * The lines of `text` that render differently in Remastered than in 1.16.1: a line that
 * sets no colour of its own, following a line that left one set. 1.16.1 reset at the
 * newline and drew these in the default colour; Remastered carries the previous colour on.
 *
 * A line whose first control byte is a colour is fine either way — it says what it wants
 * before anything is drawn. A line with no text on it at all is also fine: nothing is
 * drawn, so nothing can look wrong.
 */
export function bleedingLines(text: string): BleedingLine[] {
  const out: BleedingLine[] = [];
  const lines = text.split(/\r\n|\n|\r/);
  let carried: TextCode | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const first = firstEffect(line);
    const setsColorFirst = first === "color" || first === "mimic";
    if (i > 0 && carried !== null && !setsColorFirst && plainText(line).trim() !== "") {
      out.push({ line: i, carried });
    }
    const last = lastColorOf(line);
    // A line that sets no colour leaves the previous one running; the mimic clears it.
    if (last !== null || hasMimic(line)) carried = last;
  }
  return out;
}

/** Whether the line takes the colour back to the default with `<01>`. */
function hasMimic(line: string): boolean {
  for (const ch of line) if (ch.charCodeAt(0) === 0x01) return true;
  return false;
}

/** The effect of the first control byte on a line, before any visible character. */
function firstEffect(line: string): CodeEffect | null {
  for (const ch of line) {
    const b = ch.charCodeAt(0);
    if (b >= 0x20 || b === 0x09) return null;
    const def = BY_BYTE.get(b);
    if (!def) continue;
    if (def.effect === "color" || def.effect === "mimic") return def.effect;
    // Alignment and visibility codes come before the colour often enough to skip past.
    if (def.effect === "align" || def.effect === "invisible" || def.effect === "clip") continue;
    return def.effect;
  }
  return null;
}

/** The colour code a line leaves set, or null when it sets none (the mimic clears it). */
function lastColorOf(line: string): TextCode | null {
  let color: TextCode | null = null;
  for (const ch of line) {
    const def = BY_BYTE.get(ch.charCodeAt(0));
    if (!def) continue;
    if (def.effect === "color") color = def;
    else if (def.effect === "mimic") color = null;
  }
  return color;
}

/**
 * The byte `fixBleeding` writes: 0x02, the cyan that *is* `DEFAULT_TEXT_COLOR`. `<01>`
 * (mimic) reads as the default too, but says so indirectly — an explicit colour is what
 * survives being read back by another editor, and it is exactly the reset 1.16.1 supplied.
 */
export const RESET_CODE = "\x02";

/**
 * `text` with the default colour written at the head of every line `bleedingLines` names,
 * so Remastered draws it the way 1.16.1 did. Idempotent: the lines it fixes stop bleeding,
 * so running it again changes nothing.
 */
export function fixBleeding(text: string): string {
  const bleeding = new Set(bleedingLines(text).map((b) => b.line));
  if (bleeding.size === 0) return text;
  const parts = text.split(/(\r\n|\n|\r)/);
  let line = 0;
  let out = "";
  for (const part of parts) {
    if (part === "\r\n" || part === "\n" || part === "\r") { out += part; line++; continue; }
    out += bleeding.has(line) ? RESET_CODE + part : part;
  }
  return out;
}
