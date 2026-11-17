/**
 * The tables in the guides that mirror code: each is checked against the code it describes,
 * read at run time through that code's public entry (not by scanning its source), so a table
 * that falls behind fails here rather than going stale on the documentation site.
 *
 * - `docs/ai-tools.md`, "The tools": every MCP tool `createMcpServer()` registers, and the count
 *   the prose gives.
 * - `docs/cli.md`, "Command reference": every command `buildProgram()` has that is not hidden,
 *   and no command it does not have. A hidden command may be listed (`scmjs login`) or not.
 * - `docs/core.md`, "What is in it": every name the export table gives is exported by
 *   `@scm-js/core`'s entry.
 * - `docs/guide.md`, "Plugins", and the list under `docs/plugins.md` "What is available": the
 *   default plugins of `src/plugins/defaults.ts` and whether each starts on.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Command } from "commander";
import { createMcpServer } from "../cli/src/mcp";
import { buildProgram } from "../cli/src/main";
import * as core from "../core/src/index";
import { DEFAULT_REMOTE_PLUGINS } from "../src/plugins/defaults";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

/** The text of a `##` or `###` section, from its heading to the next heading of its level or above. */
function section(file: string, heading: string): string {
  const text = read(file);
  const depth = /^#+/.exec(heading)![0].length;
  const at = text.indexOf(`\n${heading}\n`);
  if (at < 0) throw new Error(`${file}: no "${heading}"`);
  const rest = text.slice(at + heading.length + 2);
  const next = rest.search(new RegExp(`^#{1,${depth}} `, "m"));
  return next < 0 ? rest : rest.slice(0, next);
}

/** The cells of each body row of every table in a piece of text. */
function tableRows(text: string): string[][] {
  return text.split("\n")
    .filter((line) => line.startsWith("|") && !/^\|\s*-/.test(line))
    .map((line) => line.slice(1, line.endsWith("|") ? -1 : undefined).split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|")))
    .filter((cells, i, all) => !(i === 0 || all[i - 1] === undefined) || !isHeader(cells));
}
const isHeader = (cells: string[]) => cells.every((cell) => !cell.includes("`") && !cell.includes("["));

/** The `code` spans of a cell, in order. */
const spans = (cell: string) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

describe("the MCP tool table in docs/ai-tools.md", () => {
  const { tools } = createMcpServer();
  const text = section("docs/ai-tools.md", "## The tools");

  it("lists every tool the server registers, and no other", () => {
    const listed = tableRows(text).flatMap((cells) => spans(cells[0]));
    expect([...new Set(listed)].sort()).toEqual([...tools].sort());
    expect(listed.length, "a tool listed twice").toBe(new Set(listed).size);
  });

  it("gives the number of tools", () => {
    expect(/There are (\d+)\./.exec(text)?.[1]).toBe(String(tools.length));
  });
});

describe("the command reference in docs/cli.md", () => {
  /** Every command by its words after `scmjs`, with whether it is hidden and whether it has commands under it. */
  const commands = new Map<string, { hidden: boolean; group: boolean }>();
  const walk = (cmd: Command, path: string[]) => {
    for (const sub of cmd.commands) {
      if (sub.name() === "help") continue;
      const words = [...path, sub.name()];
      commands.set(words.join(" "), { hidden: Boolean((sub as unknown as { _hidden?: boolean })._hidden), group: sub.commands.some((c) => c.name() !== "help") });
      walk(sub, words);
    }
  };
  walk(buildProgram(), []);

  /**
   * The commands one cell names. A span starting `scmjs` is a command: its words up to the first
   * argument or option, `a|b` naming several at that place and `[a|b]` optional commands under it.
   * A span with no `scmjs` (`init` in "`scmjs bot new`, `init`") is a sibling of the cell's last
   * command; before any command (the GitHub Action's `uses:`) it is not one.
   */
  function named(cell: string): string[] {
    const out: string[] = [];
    let parent: string[] | null = null;
    for (const span of spans(cell)) {
      const words = span.split(/\s+/);
      let path: string[][];
      if (words[0] === "scmjs") { path = [[]]; words.shift(); }
      else if (parent) path = [parent];
      else continue;
      let last = path;
      for (const word of words) {
        if (/^\[[^\]]*\|/.test(word)) {
          const alternatives = word.slice(1, -1).split("|");
          for (const p of path) out.push(p.join(" "));
          last = path.flatMap((p) => alternatives.map((a) => [...p, a]));
          path = last;
          break;
        }
        if (/^[<[-]/.test(word) || word.includes("…")) break;
        path = path.flatMap((p) => word.split("|").map((w) => [...p, w]));
        last = path;
      }
      for (const p of last) out.push(p.join(" "));
      parent = last[0].slice(0, -1);
    }
    return out;
  }

  const listed = new Set(tableRows(section("docs/cli.md", "## Command reference")).flatMap((cells) => named(cells[0])));

  it("names only commands there are", () => {
    expect([...listed].filter((name) => !commands.has(name))).toEqual([]);
  });

  it("names every command that is not hidden", () => {
    const missing = [...commands].filter(([name, c]) => !c.hidden && !c.group && !listed.has(name)).map(([name]) => name);
    expect(missing).toEqual([]);
  });
});

describe("the export table in docs/core.md", () => {
  it("names only what the package exports", () => {
    const table = tableRows(section("docs/core.md", "## What is in it"));
    // Names only: a call written with its arguments (`raceLabel(id, races)`) is its name; text
    // in code that is not an identifier (`mod.json`, `rez\network.tbl`) is not a name.
    const names = table.flatMap((cells) => spans(cells[1] ?? ""))
      .map((span) => span.replace(/\(.*$/, ""))
      .filter((span) => /^[A-Za-z_]\w*$/.test(span))
      .filter((span) => !NOT_EXPORTS.has(span));
    expect(names.length).toBeGreaterThan(100);
    expect(names.filter((name) => !(name in core))).toEqual([]);
  });
});

/**
 * Words in the core table's code spans that are not the package's names: the fields of
 * `mod.json`'s `races` rows, and fields of what `readMod` and `exeArchive` return.
 */
const NOT_EXPORTS = new Set<string>(["races", "letter", "like", "identity", "kind", "archive", "form", "bytes", "at"]);

describe("the default plugins in docs/guide.md and docs/plugins.md", () => {
  const repoOf = (spec: string) => /^github:scm-js\/([\w-]+)@/.exec(spec)![1];
  const defaults = new Map(DEFAULT_REMOTE_PLUGINS.map((p) => [repoOf(p.spec), p.enabled]));
  const rows = tableRows(section("docs/guide.md", "## Plugins")).map((cells) => ({
    name: /^\[([^\]]+)\]/.exec(cells[0])![1],
    repo: /github\.com\/scm-js\/([\w-]+)\)/.exec(cells[0])![1],
    starts: cells[1],
  }));

  it("the guide's table has every default, and says whether it starts on", () => {
    const listedDefaults = rows.filter((r) => r.starts !== "Browse");
    expect(new Map(listedDefaults.map((r) => [r.repo, r.starts === "On"]))).toEqual(defaults);
    expect(rows.filter((r) => r.starts === "Browse" && defaults.has(r.repo)).map((r) => r.name)).toEqual([]);
  });

  it("the plugin guide names the same defaults", () => {
    const text = section("docs/plugins.md", "### What is available");
    const on = /These plugins come with the editor and start on: (.+?)\. /.exec(text.replace(/\s+/g, " "))![1];
    const names = on.split(/, | and /).map((n) => n.trim());
    expect(names.sort()).toEqual(rows.filter((r) => r.starts === "On").map((r) => r.name).sort());
    for (const r of rows.filter((r) => r.starts === "Off")) expect(text.replace(/\s+/g, " ")).toMatch(new RegExp(`${r.name}[^.]*starts off`));
  });
});
