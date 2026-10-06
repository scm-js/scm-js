/**
 * Help ▸ What's New: which notes a build shows, when they are announced, the Markdown
 * reader — and every committed notes file read through it, so a file written in syntax
 * the dialog cannot draw fails here rather than showing its asterisks to a reader.
 */
import { describe, expect, it } from "vitest";
import {
  compareVersions, isPrerelease, notesVersionFor, parseInline, parseNotes, shouldAnnounce,
  type Block, type Inline, type ListItem,
} from "../src/editor/releaseNotes";
import { RELEASE_NOTES } from "../src/data/releaseNotes";

describe("versions", () => {
  it("orders by release number, numerically", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.6.2", "0.6.2")).toBe(0);
    expect(compareVersions("0.6.3-nightly.20261005.242", "0.6.2")).toBeGreaterThan(0);
  });

  it("knows a build between releases", () => {
    expect(isPrerelease("0.6.3-nightly.20261005.242")).toBe(true);
    expect(isPrerelease("0.6.2")).toBe(false);
  });

  it("gives a release its own notes and a nightly the last release's", () => {
    const have = ["0.6.2", "0.6.1", "0.5.0"];
    expect(notesVersionFor("0.6.2", have)).toBe("0.6.2");
    expect(notesVersionFor("0.6.3-nightly.20261005.242", have)).toBe("0.6.2");
    expect(notesVersionFor("0.6.0", have)).toBe("0.5.0");
    expect(notesVersionFor("0.4.0", have)).toBeNull();
    expect(notesVersionFor("0.6.2", [])).toBeNull();
  });
});

describe("shouldAnnounce", () => {
  it("announces notes newer than the ones last seen, once", () => {
    expect(shouldAnnounce("0.6.1", "0.6.2", true)).toBe(true);
    expect(shouldAnnounce("0.6.2", "0.6.2", true)).toBe(false);
    expect(shouldAnnounce("0.7.0", "0.6.2", true)).toBe(false);
  });

  it("tells a returning user with nothing remembered, but not a first visit", () => {
    expect(shouldAnnounce(null, "0.6.2", true)).toBe(true);
    expect(shouldAnnounce(null, "0.6.2", false)).toBe(false);
  });

  it("says nothing when the build has no notes", () => {
    expect(shouldAnnounce("0.6.1", null, true)).toBe(false);
  });
});

describe("parseInline", () => {
  it("reads bold, italic, code and links", () => {
    expect(parseInline("Use **File ▸ Save**, *for a day*, `npm update` or [the guide](https://docs.scmjs.dev/plugins/).")).toEqual([
      { kind: "text", text: "Use " },
      { kind: "bold", children: [{ kind: "text", text: "File ▸ Save" }] },
      { kind: "text", text: ", " },
      { kind: "italic", children: [{ kind: "text", text: "for a day" }] },
      { kind: "text", text: ", " },
      { kind: "code", text: "npm update" },
      { kind: "text", text: " or " },
      { kind: "link", url: "https://docs.scmjs.dev/plugins/", children: [{ kind: "text", text: "the guide" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves code alone and nests inside bold", () => {
    expect(parseInline("`a * b * c`")).toEqual([{ kind: "code", text: "a * b * c" }]);
    expect(parseInline("**the `.bak` file**")).toEqual([
      { kind: "bold", children: [{ kind: "text", text: "the " }, { kind: "code", text: ".bak" }, { kind: "text", text: " file" }] },
    ]);
  });

  it("keeps a link that is not a web address as text", () => {
    expect(parseInline("[x](javascript:alert(1))")).toEqual([{ kind: "text", text: "[x](javascript:alert(1))" }]);
  });
});

describe("parseNotes", () => {
  const sections = parseNotes([
    "An opening paragraph",
    "wrapped over two lines.",
    "",
    "## Drawing",
    "",
    "- Scrolling is smoother,",
    "  most noticeably zoomed out.",
    "- Preferences:",
    "  - **General**: one",
    "    wrapped.",
    "  - **View**: two",
    "",
    "- After a blank line.",
    "",
    "A closing paragraph.",
    "",
    "## For plugin authors",
    "* `scenario()` is read-only.",
  ].join("\n"));

  it("splits on headings, with the lead untitled", () => {
    expect(sections.map((s) => s.title)).toEqual([null, "Drawing", "For plugin authors"]);
    expect(sections.map((s) => s.forPluginAuthors)).toEqual([false, false, true]);
    expect(sections[0].blocks).toEqual([{ kind: "paragraph", inline: [{ kind: "text", text: "An opening paragraph wrapped over two lines." }] }]);
  });

  it("joins wrapped items, nests one level and carries a list over a blank line", () => {
    const [list, closing] = sections[1].blocks;
    expect(closing).toEqual({ kind: "paragraph", inline: [{ kind: "text", text: "A closing paragraph." }] });
    if (list.kind !== "list") throw new Error("expected a list");
    expect(list.items.length).toBe(3);
    expect(list.items[0]).toEqual({ inline: [{ kind: "text", text: "Scrolling is smoother, most noticeably zoomed out." }], children: [] });
    expect(list.items[1].children.length).toBe(2);
    expect(list.items[1].children[0].inline).toEqual([{ kind: "bold", children: [{ kind: "text", text: "General" }] }, { kind: "text", text: ": one wrapped." }]);
    expect(list.items[2].inline).toEqual([{ kind: "text", text: "After a blank line." }]);
  });
});

/** Every run of plain text a parsed file would put on screen. */
function plainText(blocks: Block[]): string[] {
  const out: string[] = [];
  const walk = (nodes: Inline[]) => {
    for (const n of nodes) {
      if (n.kind === "text") out.push(n.text);
      else if (n.kind !== "code") walk(n.children);
    }
  };
  const item = (i: ListItem) => { walk(i.inline); i.children.forEach(item); };
  for (const b of blocks) {
    if (b.kind === "list") b.items.forEach(item);
    else walk(b.inline);
  }
  return out;
}

describe("the committed release notes", () => {
  it("are bundled newest first, one per release", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    const versions = RELEASE_NOTES.map((n) => n.version);
    expect(versions).toEqual([...versions].sort((a, b) => compareVersions(b, a)));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it.each(RELEASE_NOTES.map((n) => [n.version, n.markdown] as const))("%s uses only the Markdown the dialog draws", (_version, markdown) => {
    const sections = parseNotes(markdown);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      for (const text of plainText(section.blocks)) {
        // Emphasis left unread, a fence, a table row, an image or an HTML tag would show as typed.
        expect(text).not.toMatch(/\*\*|```|^\s*\||!\[|<\/?[a-z][a-z0-9]*>/i);
        expect(text).not.toMatch(/\]\(/);
      }
    }
  });
});
