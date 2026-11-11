/**
 * `scmjs completion bash` run by bash itself: the script sourced and its function called with the words typed, as bash
 * calls it on TAB (COMP_WORDS, COMP_CWORD). zsh and fish are not on this machine; their scripts are read in
 * tests/cli-maps.test.ts.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { completionScript } from "../cli/src/completion";
import { program } from "../cli/src/main";

const hasBash = spawnSync("bash", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasBash)("scmjs completion bash, in bash", () => {
  const dir = mkdtempSync(join(tmpdir(), "scmjs-completion-"));
  const script = join(dir, "scmjs.bash");
  writeFileSync(script, completionScript(program, "bash"));
  for (const f of ["a.scx", "b.scm", "notes.txt"]) writeFileSync(join(dir, f), "");

  /** What TAB offers after `words` (the last is the word being completed, "" for none), in a folder of three files. */
  const complete = (...words: string[]): string[] => {
    const r = spawnSync("bash", ["-c", `source "$1"; shift; COMP_WORDS=("$@"); COMP_CWORD=$(( \${#COMP_WORDS[@]} - 1 )); _scmjs; printf '%s\\n' "\${COMPREPLY[@]}"`, "bash", script, "scmjs", ...words], { cwd: dir, encoding: "utf8" });
    expect(r.stderr).toBe("");
    return r.stdout.split("\n").filter(Boolean).sort();
  };
  const files = ["a.scx", "b.scm", "notes.txt", "scmjs.bash"];

  it("offers the commands, the hidden ones the guide documents too", () => {
    expect(complete("ab")).toEqual(["about"]);
    expect(complete("")).toEqual(expect.arrayContaining(["map", "replay", "about", "lsp", "completion", "login", "logout", "help"]));
    expect(complete("map", "")).toContain("diff");
    expect(complete("map", "")).not.toContain("a.scx");
  });

  it("offers files for a command's argument, and options once a file is typed", () => {
    expect(complete("map", "check", "")).toEqual(files);
    expect(complete("map", "diff", "a.scx", "--")).toEqual(expect.arrayContaining(["--rev", "--json", "--picture"]));
    // A command with commands of its own that runs by itself too: both.
    expect(complete("map", "test", "")).toEqual(["record", ...files].sort());
  });

  it("takes a value after an option that has one, and offers its choices", () => {
    expect(complete("--lang", "ko", "map", "")).toContain("diff");
    expect(complete("--lang", "")).toEqual(["en", "ko"]);
    expect(complete("map", "check", "a.scx", "--lang", "")).toEqual(["en", "ko"]);
    expect(complete("map", "share", "a.scx", "--keep", "")).toEqual(["day", "forever", "month", "week"]);
    expect(complete("map", "diff", "a.scx", "--out", "")).toEqual(files);
    // A value that is not a file has nothing to offer.
    expect(complete("map", "log", "a.scx", "-n", "")).toEqual([]);
    // And the word after it is an argument again.
    expect(complete("map", "diff", "--rev", "HEAD", "")).toEqual(files);
  });

  it("offers an argument's choices", () => {
    expect(complete("completion", "")).toEqual(["bash", "fish", "zsh"]);
    expect(complete("help", "ma")).toEqual(["map"]);
  });
});
