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
import { format, josa, LOCALES, locale, makeTranslator, messageKey, placeholderNames, resolveLocale, setLocale, t, tc, translate } from "../src/i18n";
import ko from "../src/i18n/ko.json";
import { checkCatalogue, extractMessages, messagesIn, updatedCatalogue } from "../scripts/lib/i18n.mjs";
import { MOD_MESSAGES, renderMessage, say } from "@scm-js/mod";
import cliKo from "../cli/src/ko.json";
import { modText } from "../cli/src/i18n";

const SRC = join(import.meta.dirname, "..", "src");
const CLI = join(import.meta.dirname, "..", "cli", "src");

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
    expect(josa("Marine", "을")).toBe("Marine을(를)");
    expect(josa("game.rep", "으로")).toBe("game.rep(으)로");
    expect(josa("Player 3", "이")).toBe("Player 3이"); // 삼
    expect(josa("Player 2", "이")).toBe("Player 2가"); // 이
    expect(josa("Location 1", "으로")).toBe("Location 1로"); // 일: ㄹ takes 로
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

  it("lets a translation show a package sentence's hidden parameter in place of a shown one, and nothing else", () => {
    const text = "{path} could not be opened: {why}";
    const messages = new Map([[text, { text, context: "", uses: [], hidden: ["reason"] }]]);
    const check = (translation: string) => checkCatalogue(messages, { [text]: translation }).mismatched.length;
    expect(check("{path|을} 열지 못했습니다: {reason}")).toBe(0);
    expect(check("{path|을} 열지 못했습니다: {why}")).toBe(0);
    expect(check("{path|을} 열지 못했습니다: {nope}")).toBe(1);
    expect(check("열지 못했습니다: {reason}")).toBe(1);
    expect(check("{path|을} 열지 못했습니다")).toBe(1);
  });
});

// Two trees, each with its own catalogues: the editor's (`src/i18n/<locale>.json`) and the command line's
// (`cli/src/<locale>.json`), so neither bundle carries the other's words.
for (const [tree, root, catalogueOf] of [
  ["the editor's", SRC, (id: string) => join(SRC, "i18n", `${id}.json`)],
  ["the command line's", CLI, (id: string) => join(CLI, `${id}.json`)],
] as const) {
  describe(`${tree} catalogues`, () => {
    const { messages, errors } = extractMessages(root);

    it("every t() in the source takes a literal", () => {
      expect(errors).toEqual([]);
    });

    it("has something to translate", () => {
      expect(messages.size).toBeGreaterThan(0);
    });

    for (const { id } of LOCALES) {
      if (id === "en") continue;
      it(`${id}.json has exactly the source's keys, with the source's placeholders`, () => {
        const catalogue = JSON.parse(readFileSync(catalogueOf(id), "utf8"));
        const { missing, unused, mismatched } = checkCatalogue(messages, catalogue);
        expect({ missing, unused, mismatched }).toEqual({ missing: [], unused: [], mismatched: [] });
      });
    }
  });
}

// `@scm-js/mod` hands its sentences over as data (`MOD_MESSAGES`: key, English template, parameters), translated by the
// template where they are shown. Each tree that imports the package asks for every template, so a sentence the package
// adds is missing from both catalogues, and the check above fails, until it is translated.
describe("@scm-js/mod's sentences", () => {
  const templates = Object.values(MOD_MESSAGES).map((m) => m.text);

  it("are asked for by both trees, every one", () => {
    for (const root of [SRC, CLI]) {
      const { messages } = extractMessages(root);
      expect(templates.filter((text) => !messages.has(text)), root).toEqual([]);
    }
  });

  it("are in Korean in both catalogues, rendered with their parameters by the translator", () => {
    for (const catalogue of [ko, cliKo] as Record<string, string>[]) expect(templates.filter((text) => !catalogue[text])).toEqual([]);
    setLocale("ko");
    try {
      const said = say("exe-unreadable", { path: "BG.exe", why: say("overlay-form", { at: 1024, form: 2, known: 1 }) });
      const text = renderMessage(said, (template, params) => translate(template, params));
      expect(text).toContain("BG.exe");
      expect(text).toContain("1024");
      expect(text).not.toContain("cannot be read");
      const copy = renderMessage(say("game-copy", { folder: "Starcraft", list: "StarDat.mpq", more: 2 }), (template, params) => translate(template, params));
      expect(copy).toContain("외 2개");
    } finally { setLocale("en"); }
  });

  it("carry hidden parameters to the check: an archive that could not be opened shows its reason translated, its English as before", () => {
    for (const root of [SRC, CLI]) {
      const { messages } = extractMessages(root);
      for (const key of ["archive-unopenable", "exe-archive-unopenable"] as const) expect(messages.get(MOD_MESSAGES[key].text)?.hidden, `${root} ${key}`).toEqual(["reason"]);
    }
    const why = "The hash table is damaged";
    const opened = say("archive-unopenable", { path: "made.mpq", why, reason: say("mpq-damaged", { detail: why }) });
    const inExe = say("exe-archive-unopenable", { path: "Made.exe", at: 1024, why, reason: say("mpq-damaged", { detail: why }) });
    expect(modText(opened)).toBe(`made.mpq could not be opened as an archive: ${why}`);
    expect(modText(inExe)).toBe(`the archive inside Made.exe (at byte 1024) could not be opened: ${why}`);
    setLocale("ko");
    try {
      expect(modText(opened)).toBe(`made.mpq을(를) 아카이브로 열지 못했습니다: 손상되었습니다(${why})`);
      expect(modText(inExe)).toBe(`Made.exe 안의 아카이브(1024바이트 위치)를 열지 못했습니다: 손상되었습니다(${why})`);
      // (a message made without the reason, as 1.0.0 made it: the library's text stands in)
      const bare = { ...opened, params: { path: "made.mpq", why } } as typeof opened;
      expect(modText(bare)).toBe(`made.mpq을(를) 아카이브로 열지 못했습니다: ${why}`);
    } finally { setLocale("en"); }
  });
});
