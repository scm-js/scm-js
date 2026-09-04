/**
 * The documentation site generator (`scripts/build-docs.mjs` and `scripts/lib/docs/`).
 *
 * What is worth pinning is the two things that go wrong silently. One is the split: the
 * site's pages *are* the `##` headings of `README.md` and `docs/*.md`, so a `#` inside a
 * fenced shell block becoming a page, or a section losing its body, would publish a
 * broken site from documents that read perfectly on GitHub. The other is the links:
 * those documents are written to be read as blobs, and every relative path in them has
 * to become either a page here or a link back to the repository — a rule with no visible
 * symptom short of clicking every link.
 *
 * The API reference is generated from `plugin-api/index.d.ts`, which a clone does not
 * have until `npm run build:plugin-types` runs, so those cases skip when it is absent
 * (as the real-map suites do) rather than failing a fresh checkout.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain .mjs build scripts, imported for their pure parts.
import { headingsIn, renderMarkdown, slug, splitPages } from "../scripts/lib/docs/markdown.mjs";
// @ts-expect-error - as above.
import { buildGuide, linkResolver, resolvePath, SOURCES } from "../scripts/lib/docs/site.mjs";
// @ts-expect-error - as above.
import { buildReference, docCommentFor, isGroupType, parseDeclarations, parseDoc, assignTypes } from "../scripts/lib/docs/api.mjs";
// @ts-expect-error - as above.
import { highlight } from "../scripts/lib/docs/render.mjs";
// @ts-expect-error - as above.
import { firstLine, plainTextOf } from "../scripts/build-docs.mjs";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");
const DTS = join(root, "plugin-api/index.d.ts");
const haveTypes = existsSync(DTS);

describe("splitting a guide into pages", () => {
  it("takes the `#` as the title and a page per `##`", () => {
    const { title, intro, sections } = splitPages("# Title\n\nlede\n\n## One\n\na\n\n## Two\n\nb\n");
    expect(title).toBe("Title");
    expect(intro).toBe("lede");
    expect(sections.map((s: { title: string }) => s.title)).toEqual(["One", "Two"]);
    expect(sections[1].body).toBe("b");
  });

  it("leaves a `#` inside a fenced block alone", () => {
    const { sections } = splitPages("# T\n\n```sh\n# a comment\n## another\n```\n\n## Real\n\nx\n");
    expect(sections.map((s: { title: string }) => s.title)).toEqual(["Real"]);
    expect(headingsIn("```sh\n## no\n```\n\n### yes\n")).toEqual([{ depth: 3, text: "yes", slug: "yes" }]);
  });

  it("slugs a heading the way GitHub does, so the documents' own `#fragment` links still land", () => {
    expect(slug("What works, and what does not")).toBe("what-works-and-what-does-not");
    expect(slug("`api.terrain` and ISOM")).toBe("apiterrain-and-isom");
  });

  it("keeps every line of every guide: nothing is dropped between the pages", () => {
    for (const source of SOURCES) {
      const text = read(source.file);
      const { intro, sections } = splitPages(text);
      const kept = [intro, ...sections.map((s: { body: string }) => s.body)].join("\n").split("\n").filter((l: string) => l.trim()).length;
      const headings = headingsIn(text).filter((h: { depth: number }) => h.depth <= 2).length;
      const all = text.split("\n").filter((l) => l.trim()).length;
      expect(kept).toBe(all - headings);
    }
  });

  it("gives every guide at least two pages", () => {
    for (const source of SOURCES) {
      expect(buildGuide(source, read(source.file)).pages.length).toBeGreaterThan(1);
    }
  });
});

describe("links", () => {
  const guides = SOURCES.map((s: { file: string }) => buildGuide(s, read(s.file)));
  const resolve = linkResolver(guides);

  it("resolves a path against the document it was written in", () => {
    expect(resolvePath("docs/plugins.md", "../README.md")).toEqual({ path: "README.md", above: 0 });
    expect(resolvePath("README.md", "docs/game-data.md")).toEqual({ path: "docs/game-data.md", above: 0 });
    expect(resolvePath("docs/development.md", "../../releases")).toEqual({ path: "releases", above: 1 });
  });

  it("turns a cross-document link into a page here", () => {
    expect(resolve("README.md", "docs/plugins.md")).toBe("/plugins/");
    expect(resolve("docs/plugins.md", "../README.md")).toBe("/guide/");
    expect(resolve("docs/development.md", "game-data.md#getting-the-files")).toBe("/game-data/getting-the-files/");
  });

  it("sends a `#fragment` to whichever page that heading ended up on", () => {
    const at = resolve("README.md", "#keyboard");
    expect(at).toBe("/guide/keyboard/");
  });

  it("sends everything else in the repository back to GitHub, and leaves absolute links alone", () => {
    expect(resolve("README.md", "LICENSE")).toBe("https://github.com/scm-js/scm-js/blob/main/LICENSE");
    expect(resolve("docs/development.md", "../../releases")).toBe("https://github.com/scm-js/scm-js/releases");
    expect(resolve("README.md", "https://editor.scmjs.dev")).toBe("https://editor.scmjs.dev");
  });

  it("leaves no relative link in any guide pointing at a file the site does not serve", () => {
    for (const guide of guides) {
      for (const page of guide.pages) {
        const html = renderMarkdown(page.body, { rewriteLink: (h: string) => resolve(guide.file, h) });
        for (const m of html.matchAll(/href="([^"]+)"/g)) {
          expect(m[1], `${guide.file} § ${page.title}`).toMatch(/^(https?:|\/|#)/);
        }
      }
    }
  });
});

describe("rendering", () => {
  it("gives a heading an id and an anchor, shifted to the page's own level", () => {
    const html = renderMarkdown("### Deep\n", { shift: -1 });
    expect(html).toContain('<h2 id="deep">');
    expect(html).toContain('href="#deep"');
  });

  it("colours code and links the names it is given", () => {
    const html = highlight('const x: Rect = { x0: 0 }; // note', { names: new Set(["Rect"]), urlFor: () => "/api/types/#rect" });
    expect(html).toContain('<a class="t" href="/api/types/#rect">Rect</a>');
    expect(html).toContain('<span class="k">const</span>');
    expect(html).toContain('<span class="c">// note</span>');
  });

  it("escapes what it does not colour", () => {
    expect(highlight("a < b && c > d")).toContain("&lt;");
    expect(plainTextOf("<p>a &amp; <code>b</code></p>")).toBe("a & b");
  });

  it("takes a page's first sentence for its card and its description", () => {
    expect(firstLine("Layers along the left rail. And more.\n\nNext para.")).toBe("Layers along the left rail.");
    expect(firstLine("```sh\nnpm run dev\n```\n\nThe dev server.")).toBe("The dev server.");
  });
});

describe("doc comments", () => {
  it("reads the comment above a declaration, and only that one", () => {
    const source = "/** first */\ninterface A {}\n// a note\n/** second */\ninterface B {}\n";
    const decls = parseDeclarations(source);
    expect(decls.map((d: { name: string; summary: string }) => [d.name, d.summary])).toEqual([["A", "first"], ["B", "second"]]);
  });

  it("keeps the indentation inside a comment, so a code sample survives", () => {
    const source = "/**\n * Text.\n *\n *     indented\n */\ninterface A {}\n";
    const decls = parseDeclarations(source);
    expect(decls[0].summary).toBe("Text.\n\n    indented");
  });

  it("splits `@example` out of the prose", () => {
    const doc = parseDoc("Does a thing.\n\n@example\nconst a = 1;\n\n@deprecated use b");
    expect(doc.summary).toBe("Does a thing.");
    expect(doc.examples).toEqual(["const a = 1;"]);
    expect(doc.tags).toEqual([{ name: "deprecated", text: "use b" }]);
  });

  it("is the same reader `docCommentFor` uses on a member", () => {
    const source = "interface A {\n  /** m. */\n  m(): void;\n}\n";
    expect(parseDeclarations(source)[0].members[0].summary).toBe("m.");
    expect(typeof docCommentFor).toBe("function");
  });
});

/**
 * `docs/plugins.md` is the plugin author's guide, and both ways it goes wrong are quiet.
 *
 * It can go **stale**: a group renamed or a member dropped leaves prose naming a call that
 * no longer exists, and a reader only finds out when their plugin does not compile. Every
 * `api.x.y` in it is therefore resolved against the declarations — inline code and prose
 * as well as fenced blocks, since the wrong ones found by hand (`api.on` for
 * `api.events.on`) were all in prose.
 *
 * And it can drift **off-audience**: the document is split at *Host side (for editor
 * developers)*, and everything above it is written for somebody who has the npm package
 * and none of this repository. A Jotai atom or a `src/` path above that line is a fact
 * they cannot act on, so it belongs below it.
 */
describe.skipIf(!haveTypes)("the plugin guide", () => {
  const guide = read("docs/plugins.md");
  const authorHalf = guide.slice(0, guide.indexOf("## Host side"));
  const reference = haveTypes ? buildReference(readFileSync(DTS, "utf8")) : null;

  it("names no call the API does not declare", () => {
    const groups = new Map(reference!.groups.map((g: { property: string }) => [g.property, g]));
    const root = new Set([...groups.keys(), ...reference!.plain.map((m: { name: string }) => m.name)]);
    const bad: string[] = [];
    for (const m of guide.matchAll(/\bapi\.([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?/g)) {
      const [, group, member] = m;
      if (group === "ts") continue; // `api.ts`, the editor's own file, named on the host side
      if (!root.has(group)) { bad.push(`api.${group}`); continue; }
      const g = groups.get(group) as { members: { name: string }[] } | undefined;
      if (g && member && !g.members.some((x) => x.name === member)) bad.push(`api.${group}.${member}`);
    }
    expect([...new Set(bad)]).toEqual([]);
  });

  it("documents every group of the API", () => {
    const tour = guide.slice(guide.indexOf("## The API, group by group"), guide.indexOf("## Host side"));
    const missing = reference!.groups.filter((g: { property: string }) => !tour.includes(`api.${g.property}`));
    expect(missing.map((g: { property: string }) => g.property)).toEqual([]);
  });

  it("keeps the editor's internals out of the author's half", () => {
    const internals = /\b(\w+Atom|src\/[\w./-]+|host\.ts|loader\.ts|builtin\.ts|MapViewport|MenuBar|usePlugins|Jotai)\b/g;
    expect([...new Set([...authorHalf.matchAll(internals)].map((m) => m[0]))]).toEqual([]);
  });
});

describe.skipIf(!haveTypes)("the API reference", () => {
  const dts = haveTypes ? readFileSync(DTS, "utf8") : "";

  it("finds a group for every `…Api` member of PluginApi", () => {
    const reference = buildReference(dts);
    expect(reference.groups.length).toBeGreaterThan(15);
    for (const group of reference.groups) {
      expect(isGroupType(group.name)).toBe(true);
      expect(group.members.length).toBeGreaterThan(0);
    }
    // What is left on the root is data and `log`, not a group with no page.
    expect(reference.plain.map((m: { name: string }) => m.name).sort()).toEqual(["apiVersion", "log", "plugin"]);
  });

  it("documents every group, so no page reads as a bare interface name", () => {
    const missing = buildReference(dts).groups.filter((g: { summary: string }) => !g.summary);
    expect(missing.map((g: { property: string }) => g.property)).toEqual([]);
  });

  it("puts every declared type on exactly one page", () => {
    const reference = buildReference(dts);
    const { perGroup, shared } = assignTypes(reference);
    const placed = [...perGroup.values()].flat().length + shared.length;
    expect(placed).toBe(reference.types.length);
    const names = new Set([...[...perGroup.values()].flat(), ...shared].map((t: { name: string }) => t.name));
    expect(names.size).toBe(reference.types.length);
  });
});
