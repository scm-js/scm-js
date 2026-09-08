/**
 * The translator (`src/i18n/index.ts`), the extractor (`scripts/lib/i18n.mjs`) and,
 * over the real source, the catalogues: every `t()` in `src/` has a key in every
 * language file, no language file carries a key nothing asks for, and a translation
 * keeps the placeholders of its source. Untranslated (empty) entries are allowed — they
 * show in English — and `npm run i18n` lists them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { format, josa, LOCALES, locale, makeTranslator, messageKey, placeholderNames, resolveLocale, setLocale, t, tc } from "../src/i18n";
import ko from "../src/i18n/ko.json";
import { checkCatalogue, extractMessages, messagesIn, updatedCatalogue } from "../scripts/lib/i18n.mjs";

const SRC = join(import.meta.dirname, "..", "src");

describe("format", () => {
  it("fills plain placeholders and leaves a missing one visible", () => {
    expect(format("Save {name} to {where}", { name: "Map", where: "disk" }, "en")).toBe("Save Map to disk");
    expect(format("Save {name}", {}, "en")).toBe("Save {name}");
    expect(format("no braces", undefined, "en")).toBe("no braces");
  });

  it("picks a plural branch by the language's rules, with exact matches first", () => {
    const m = "{n, plural, =0 {no maps} one {# map} other {# maps}}";
    expect(format(m, { n: 0 }, "en")).toBe("no maps");
    expect(format(m, { n: 1 }, "en")).toBe("1 map");
    expect(format(m, { n: 1234 }, "en")).toBe("1,234 maps");
    // Korean has one category; a Korean message writes only `other`.
    expect(format("맵 {n, plural, other {#개}}", { n: 1 }, "ko")).toBe("맵 1개");
  });

  it("selects, nests, and formats numbers for the locale", () => {
    expect(format("{kind, select, scm {a StarCraft map} other {a Brood War map}} with {n, plural, one {# unit} other {# units}}", { kind: "scm", n: 2 }, "en")).toBe("a StarCraft map with 2 units");
    expect(format("{n}", { n: 1000000 }, "en")).toBe("1000000");
    expect(format("{n, plural, other {#}}", { n: 1000000 }, "en")).toBe("1,000,000");
  });

  it("appends the Korean particle that agrees with the value", () => {
    expect(josa("맵", "을")).toBe("맵을");
    expect(josa("유닛", "이")).toBe("유닛이");
    expect(josa("위치", "를")).toBe("위치를");
    expect(josa("위치", "은")).toBe("위치는");
    expect(josa("서울", "으로")).toBe("서울로");
    expect(josa("부산", "으로")).toBe("부산으로");
    expect(josa("Marine", "을")).toBe("Marine을");
    expect(format("{name|을} 저장", { name: "맵" }, "ko")).toBe("맵을 저장");
    expect(format("{name|가} 저장", { name: "위치" }, "ko")).toBe("위치가 저장");
  });

  it("names the placeholders a message uses, inside plural and select branches too", () => {
    expect(placeholderNames("{a} and {b|을} and {n, plural, one {# {c}} other {#}}")).toEqual(["a", "b", "n", "c"]);
  });
});

describe("t", () => {
  it("falls back to the English text, and switches with the locale", () => {
    setLocale("en");
    expect(t("Map Revision")).toBe("Map Revision");
    setLocale("ko");
    expect(t("Map Revision")).toBe((ko as Record<string, string>)["Map Revision"] || "Map Revision");
    expect(t("A string no catalogue has")).toBe("A string no catalogue has");
    setLocale("en");
  });

  it("keys a context in front of the text", () => {
    expect(messageKey("Open")).toBe("Open");
    expect(messageKey("Open", "menu")).toBe("menuOpen");
    expect(tc("menu", "Open")).toBe("Open");
  });

  it("resolves the preference against the browser's language", () => {
    expect(resolveLocale("auto", "ko-KR")).toBe("ko");
    expect(resolveLocale("auto", "en-US")).toBe("en");
    expect(resolveLocale("auto", "fr")).toBe("en");
    expect(resolveLocale("auto", undefined)).toBe("en");
    expect(resolveLocale("ko", "en-US")).toBe("ko");
    expect(LOCALES.map((l) => l.id)).toContain("ko");
  });

  it("gives a plugin a translator over its own catalogues", () => {
    const { t: pt } = makeTranslator((loc) => (loc === "ko" ? { "Count units": "유닛 세기" } : undefined));
    setLocale("ko");
    expect(pt("Count units")).toBe("유닛 세기");
    expect(pt("Nothing here")).toBe("Nothing here");
    setLocale("en");
    expect(pt("Count units")).toBe("Count units");
    expect(locale()).toBe("en");
  });
});

describe("extraction", () => {
  const source = `
    import { t, tc, msg } from "../i18n";
    const a = t("Save {name}", { name });
    const b = tc("menu", "Open");
    const c = msg("Western (Windows-1252)");
    const d = t(\`Plain template\`);
    const e = t("Save {name}", { name: other });
    const f = t(variable);
    const g = tc(ctx, "text");
  `;

  it("finds every literal call, once per key, and reports the rest", () => {
    const { messages, errors } = messagesIn(source, "x.ts");
    expect(messages.map((m) => m.key)).toEqual(["Save {name}", "menuOpen", "Western (Windows-1252)", "Plain template", "Save {name}"]);
    expect(errors.map((e) => e.line)).toEqual([8, 9]);
  });

  it("ignores a file that does not import the module, whatever it calls t", () => {
    const { messages, errors } = messagesIn(`const t = (x) => x; t(variable); t("literal");`, "y.ts");
    expect(messages).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("checks a catalogue for drift and placeholders, and brings it up to date", () => {
    const messages = new Map([
      ["Save {name}", { text: "Save {name}", context: "", uses: [] }],
      ["Open", { text: "Open", context: "", uses: [] }],
      ["New", { text: "New", context: "", uses: [] }],
    ]);
    const catalogue = { "Save {name}": "{nom} 저장", "Open": "열기", "Gone": "x" };
    const report = checkCatalogue(messages, catalogue);
    expect(report.missing).toEqual(["New"]);
    expect(report.unused).toEqual(["Gone"]);
    expect(report.mismatched).toEqual([{ key: "Save {name}", want: ["name"], have: ["nom"] }]);
    expect(updatedCatalogue(messages, catalogue)).toEqual({ "Save {name}": "{nom} 저장", "Open": "열기", "New": "" });
  });
});

describe("the catalogues", () => {
  const { messages, errors } = extractMessages(SRC);

  it("every t() in the source takes a literal", () => {
    expect(errors).toEqual([]);
  });

  it("has something to translate", () => {
    expect(messages.size).toBeGreaterThan(0);
  });

  for (const { id } of LOCALES) {
    if (id === "en") continue;
    it(`${id}.json has exactly the source's keys, with the source's placeholders`, () => {
      const catalogue = JSON.parse(readFileSync(join(SRC, "i18n", `${id}.json`), "utf8"));
      const { missing, unused, mismatched } = checkCatalogue(messages, catalogue);
      expect({ missing, unused, mismatched }).toEqual({ missing: [], unused: [], mismatched: [] });
    });
  }
});
