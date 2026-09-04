import { describe, expect, it } from "vitest";
import {
  bleedingLines,
  DEFAULT_TEXT_COLOR,
  fixBleeding,
  INSERTABLE_CODES,
  plainText,
  RESET_CODE,
  runsOf,
  textCode,
  TEXT_CODES,
} from "../src/editor/textColors";

/** `\x06Red` — write control bytes the way a map carries them. */
const b = (n: number) => String.fromCharCode(n);

describe("the code table", () => {
  it("covers every byte the game gives a meaning, once each", () => {
    const bytes = TEXT_CODES.map((t) => t.byte);
    expect(new Set(bytes).size).toBe(bytes.length);
    expect(bytes).toEqual([...bytes].sort((x, y) => x - y));
    expect(bytes[0]).toBe(0x01);
    expect(bytes[bytes.length - 1]).toBe(0x1f);
  });

  it("writes each code the way every StarCraft editor does", () => {
    expect(textCode(0x0e)?.code).toBe("<0E>");
    expect(textCode(0x04)?.code).toBe("<04>");
  });

  it("carries an rgb for exactly the colour codes", () => {
    for (const t of TEXT_CODES) {
      if (t.effect === "color") expect(t.rgb).toMatch(/^#[0-9a-f]{6}$/);
      else expect(t.rgb).toBeNull();
    }
  });

  /**
   * The numbering the editor shipped before was one byte early from 0x12 up, which is
   * what these pin: the community table (wiki.staredit.net/wiki/Color) puts right align
   * on 0x12 and player 9's green — not black — on 0x18.
   */
  it("puts the alignment and player codes where the game does", () => {
    expect(textCode(0x12)).toMatchObject({ effect: "align", label: "Right align" });
    expect(textCode(0x13)).toMatchObject({ effect: "align", label: "Centre align" });
    expect(textCode(0x14)).toMatchObject({ effect: "invisible" });
    expect(textCode(0x18)).toMatchObject({ effect: "color", rgb: "#088008", player: 9 });
    expect(textCode(0x1a)).toMatchObject({ effect: "nothing" });
  });

  it("numbers the twelve player colours in order", () => {
    const players = TEXT_CODES.filter((t) => t.player).map((t) => t.player);
    expect(players).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("offers everything but whitespace and the do-nothing byte as a button", () => {
    const bytes = INSERTABLE_CODES.map((t) => t.byte);
    expect(bytes).not.toContain(0x09);
    expect(bytes).not.toContain(0x0a);
    expect(bytes).not.toContain(0x0d);
    expect(bytes).not.toContain(0x1a);
    expect(bytes).toContain(0x0b);
    expect(bytes).toContain(0x12);
  });
});

describe("runsOf", () => {
  it("starts in the default colour and switches on a code", () => {
    const [line] = runsOf(`hi ${b(0x06)}there`);
    expect(line.runs).toEqual([
      { text: "hi ", color: DEFAULT_TEXT_COLOR, invisible: false, clipped: false },
      { text: "there", color: "#c81818", invisible: false, clipped: false },
    ]);
  });

  it("carries a colour across a newline, as Remastered does", () => {
    const lines = runsOf(`${b(0x06)}one\ntwo`);
    expect(lines).toHaveLength(2);
    expect(lines[1].runs[0].color).toBe("#c81818");
  });

  it("resets at a newline under the 1.16.1 rule", () => {
    const lines = runsOf(`${b(0x06)}one\ntwo`, { resetPerLine: true });
    expect(lines[1].runs[0].color).toBe(DEFAULT_TEXT_COLOR);
  });

  it("treats CRLF as one line break", () => {
    expect(runsOf("a\r\nb")).toHaveLength(2);
    expect(runsOf("a\rb")).toHaveLength(2);
  });

  it("marks text an invisible code hides rather than dropping it", () => {
    const [line] = runsOf(`shown${b(0x0b)}hidden`);
    expect(line.runs.map((r) => [r.text, r.invisible])).toEqual([["shown", false], ["hidden", true]]);
  });

  it("drops what follows a remove-beyond, for that line only", () => {
    const lines = runsOf(`keep${b(0x0c)}gone\nnext`);
    expect(lines[0].runs.map((r) => r.text)).toEqual(["keep"]);
    expect(lines[1].runs.map((r) => r.text)).toEqual(["next"]);
  });

  it("reads the alignment codes onto the line", () => {
    expect(runsOf(`${b(0x12)}right`)[0].align).toBe("right");
    expect(runsOf(`${b(0x13)}middle`)[0].align).toBe("center");
    expect(runsOf("plain")[0].align).toBe("left");
  });

  it("ignores a byte the game gives no meaning, and keeps tabs", () => {
    const [line] = runsOf(`a${b(0x1a)}b\tc`);
    expect(line.runs.map((r) => r.text).join("")).toBe("ab\tc");
  });

  it("takes <01> back to the colour the string started in", () => {
    const [line] = runsOf(`${b(0x06)}red${b(0x01)}back`);
    expect(line.runs[1].color).toBe(DEFAULT_TEXT_COLOR);
  });
});

describe("plainText", () => {
  it("strips the control bytes and keeps the whitespace", () => {
    expect(plainText(`${b(0x06)}Hello${b(0x0b)}\tworld\n!`)).toBe("Hello\tworld\n!");
  });
});

describe("the Remastered newline change", () => {
  it("finds a line that inherits a colour it never set", () => {
    expect(bleedingLines(`${b(0x06)}red\nplain`)).toMatchObject([{ line: 1, carried: { byte: 0x06, code: "<06>", rgb: "#c81818" } }]);
  });

  it("says nothing about a line that sets its own colour first", () => {
    expect(bleedingLines(`${b(0x06)}red\n${b(0x04)}white`)).toEqual([]);
    expect(bleedingLines(`${b(0x06)}red\n${b(0x01)}default`)).toEqual([]);
  });

  it("looks past an alignment code to the colour behind it", () => {
    expect(bleedingLines(`${b(0x06)}red\n${b(0x13)}${b(0x04)}centred`)).toEqual([]);
  });

  it("says nothing about a single-line string, or one that sets no colour at all", () => {
    expect(bleedingLines(`${b(0x06)}all one line`)).toEqual([]);
    expect(bleedingLines("one\ntwo\nthree")).toEqual([]);
  });

  it("ignores a blank line, which draws nothing to look wrong", () => {
    expect(bleedingLines(`${b(0x06)}red\n\n`)).toEqual([]);
  });

  it("clears the carry when a line ends on the mimic", () => {
    expect(bleedingLines(`${b(0x06)}red${b(0x01)}\nplain`)).toEqual([]);
  });

  it("reports every affected line of a longer string", () => {
    expect(bleedingLines(`${b(0x06)}a\nb\nc`).map((x) => x.line)).toEqual([1, 2]);
  });
});

describe("fixBleeding", () => {
  it("writes the default colour at the head of each bleeding line", () => {
    expect(fixBleeding(`${b(0x06)}red\nplain`)).toBe(`${b(0x06)}red\n${RESET_CODE}plain`);
  });

  it("leaves a string that does not bleed exactly as it was", () => {
    const clean = `${b(0x06)}red\n${b(0x04)}white`;
    expect(fixBleeding(clean)).toBe(clean);
    expect(fixBleeding("no codes at all")).toBe("no codes at all");
  });

  it("keeps the line breaks it found, CRLF included", () => {
    expect(fixBleeding(`${b(0x06)}a\r\nb`)).toBe(`${b(0x06)}a\r\n${RESET_CODE}b`);
  });

  it("is idempotent", () => {
    const once = fixBleeding(`${b(0x06)}a\nb\nc`);
    expect(fixBleeding(once)).toBe(once);
    expect(bleedingLines(once)).toEqual([]);
  });

  /** The point of the whole exercise: fixed text draws the same under both rules. */
  it("makes both games draw the string the same way", () => {
    const fixed = fixBleeding(`${b(0x06)}red\nplain\n${b(0x07)}green\nplain again`);
    const colorsOf = (resetPerLine: boolean) =>
      runsOf(fixed, { resetPerLine }).map((l) => l.runs.map((r) => r.color));
    expect(colorsOf(false)).toEqual(colorsOf(true));
  });

  it("leaves what the string says untouched", () => {
    const text = `${b(0x06)}red\nplain\nmore`;
    expect(plainText(fixBleeding(text))).toBe(plainText(text));
  });
});
