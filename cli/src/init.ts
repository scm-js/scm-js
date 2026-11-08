/**
 * `scmjs init [folder]`: a folder of maps made a project that git and GitHub look after — the `.gitattributes` lines
 * and `git config` settings that make `git diff` read maps through `scmjs map dump` and `git merge` merge them through
 * `scmjs map merge`, a workflow that runs the scmjs action — Check Map, and on a pull request what changed in each
 * map (and the TrigScript build, for maps with a script) — on every push and pull request, a README listing the maps, and a
 * `.gitignore` for the `.bak` files the desktop app's Save leaves beside a map and the replays `map test` keeps.
 * Nothing that is there is overwritten: the line files get only the lines they lack, the README and the workflow are
 * written only when absent (or with `--force`), and a git setting that holds another value is left alone (or set, with
 * `--force`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, delimiter, dirname, join, relative, resolve, sep } from "node:path";
import { VERSION } from "./about";
import { hasScript } from "./build";
import { loadMapInput, readInput } from "./files";
import { mapReport } from "./map";
import { CliError, dot, gameText, mark, pc, plural, table, visible } from "./ui";

/** The maps a folder holds, by extension. */
const MAP_FILE = /\.(scx|scm|chk)$/i;

/** The settings `git diff` and `git merge` need to go through the command; per clone, so set in the repository. */
export const GIT_SETTINGS: readonly (readonly [key: string, value: string])[] = [
  ["diff.scmjs.textconv", "scmjs map dump"],
  // The whole heading line: git puts what the expression matched in the hunk header, so the 0.9.0 recipe's "^## "
  // gave a bare "##" there.
  ["diff.scmjs.xfuncname", "^## .*"],
  ["diff.scmjs.cachetextconv", "true"],
  // git's merge driver: %O the common ancestor, %A ours (the result is left there), %B theirs, %P the path, for what
  // the command says. Exit 0 is merged; anything else is a conflict, and git leaves %A as the command left it (ours).
  ["merge.scmjs.name", "StarCraft maps, part by part (scmjs map merge)"],
  ["merge.scmjs.driver", "scmjs map merge %O %A %B --out %A --name %P"],
];

/** Values an earlier recipe gave, replaced without --force since they were the command's own. */
const OLD_SETTINGS: Readonly<Record<string, readonly string[]>> = { "diff.scmjs.xfuncname": ["^## "] };

/** A setting as the `git config` line to type, the value quoted when a shell would split or read it. */
export const configLine = ([key, value]: readonly [string, string]) => `git config ${key} ${/^[\w.-]+$/.test(value) ? value : `"${value}"`}`;

/** `.gitattributes`: every map read through the `scmjs` diff driver, and merged through its merge driver. */
export const ATTRIBUTE_LINES = ["*.scx diff=scmjs", "*.scm diff=scmjs", "*.chk diff=scmjs", "*.scx merge=scmjs", "*.scm merge=scmjs", "*.chk merge=scmjs"];
const ATTRIBUTE_COMMENT = "# Maps show in git diff as text (scmjs map dump) and git merge merges them (scmjs map merge); scmjs init sets the git config";

/**
 * `.gitignore`: only what is left beside a map without being asked for by name. The commands write a map back in place
 * or where `--out` says, and `map unpack`'s folder is meant to be kept; the desktop app's Save copies the file it
 * replaces to `<map>.bak`, and `map test` keeps the replays of the scenarios that failed in `<map>.tests/` and, with
 * `--clips`, their clips in `<map>.clips/`.
 */
export const IGNORE_LINES = ["*.bak", "*.tests/", "*.clips/"];
const IGNORE_COMMENT = "# Left beside a map: the file the desktop app's Save replaced (<map>.bak), the replays and clips of failed map tests (<map>.tests/, <map>.clips/)";

/**
 * The TypeScript the action installs for `map build` when the repository has none of its own: the major the TrigScript
 * compiler is built against (the root package.json's `typescript`; tests/cli-init.test.ts holds the action's scripts
 * and this to it).
 */
export const TYPESCRIPT = "typescript@6";

export const WORKFLOW_PATH = ".github/workflows/maps.yml";

export interface InitMap {
  /** The file name, in the folder. */
  file: string;
  name: string;
  width: number;
  height: number;
  tileset: string;
  players: number;
  /** Whether it keeps a TrigScript script; null when this build cannot tell. */
  script: boolean | null;
}

export type FileState = "written" | "replaced" | "added" | "kept";

export interface InitFile {
  /** Where, from the folder (the workflow is at the repository's top, which may be above it). */
  path: string;
  state: FileState;
  /** A few words on what it holds, or why it was left alone. */
  detail: string;
  /** The whole text written (or that would be), or for a line file the lines it takes. */
  content: string;
}

export interface InitGit {
  key: string;
  value: string;
  /** set; already so; another value there (left alone); no repository to set it in. */
  state: "set" | "kept" | "other" | "none";
  current: string | null;
}

export interface InitResult {
  folder: string;
  /** The git repository's top folder, or null when the folder is in none. */
  repository: string | null;
  /** `git init` ran (with `--git`). */
  created: boolean;
  /** Nothing was written (`--print`). */
  printed: boolean;
  maps: InitMap[];
  /** Maps that would not open, with why. */
  skipped: { file: string; error: string }[];
  files: InitFile[];
  git: InitGit[];
  notes: string[];
}

export interface InitOptions {
  force?: boolean;
  /** `git init` the folder when it is in no repository. */
  git?: boolean;
  /** Say what would be written, and write nothing. */
  print?: boolean;
}

function git(dir: string, ...args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  // Only the line end goes: a value may end in a space (the old `^## ` did).
  return { ok: r.status === 0, out: (r.stdout ?? "").replace(/\r?\n$/, ""), err: (r.stderr ?? "").trim() || (r.error?.message ?? "") };
}

/** The repository the folder is in: its top folder, or null (no repository, or no git). */
export function repositoryOf(dir: string): string | null {
  const r = git(dir, "rev-parse", "--show-toplevel");
  return r.ok && r.out ? resolve(r.out) : null;
}

/** A program on PATH, as the shell would find it (PATHEXT's extensions on Windows). */
function onPath(command: string): boolean {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
  return (process.env.PATH ?? "").split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, command + e))));
}

/** A path for a shell line, quoted when it has anything a shell or a glob would read. */
function shellPath(p: string): string {
  return /^[\w./@+-]*$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;
}

/**
 * The maps' paths: one glob per extension the folder has, from the repository's top. Quoted for a shell (the README's
 * commands), or as they are (`quote: false`, the action's `maps` input, one a line, which no shell reads).
 */
export function mapGlobs(prefix: string, files: readonly string[], quote = true): string[] {
  const exts = [...new Set(files.map((f) => f.slice(f.lastIndexOf(".") + 1)))].sort();
  const folder = prefix ? (prefix.endsWith("/") ? prefix : `${prefix}/`) : "";
  const dir = quote && folder ? shellPath(folder) : folder;
  return (exts.length ? exts : ["scx"]).map((e) => `${dir}*.${e}`);
}

/** Where the action lives, for the workflow's comment. */
export const ACTION_PAGE = "https://github.com/scm-js/scm-js/tree/main/action";

/**
 * The workflow: the scmjs action (action/ in this repository) on every push and pull request — Check Map over the
 * maps as annotations beside each map, on a pull request one comment saying what changed in each map with pictures of
 * where, and the TrigScript build for maps that keep a script. The action and the command are pinned to this version,
 * so a run gives the same answer until the project moves them.
 */
export function workflowText(o: { version: string; globs: string[]; scripted: string[] }): string {
  // A plain YAML scalar may not start with `*` (an alias) or hold `: `/` #`; anything but the plainest is quoted.
  const yamlLine = (g: string) => (/^[\w./@+-][\w./*?@+-]*$/.test(g) ? g : JSON.stringify(g));
  return [
    "# Checks the maps on every push and pull request with the scmjs action: Check Map's errors and warnings fail the",
    "# run and show beside each map, and a pull request gets one comment saying what changed in each map, with pictures",
    `# of where. Written by scmjs init (https://docs.scmjs.dev/cli); the action's inputs are at ${ACTION_PAGE}.`,
    "#",
    `# The action and the command are pinned to ${o.version}, so a run gives the same answer until you move them. To`,
    `# move them, change both ${o.version}s below to a newer release (github.com/scm-js/scm-js/releases).`,
    "name: Maps",
    "",
    "on:",
    "  push:",
    "  pull_request:",
    "",
    "permissions:",
    "  contents: read",
    "  pull-requests: write # the comment on a pull request",
    "",
    "jobs:",
    "  maps:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    `      - uses: scm-js/scm-js/action@v${o.version}`,
    "        with:",
    `          version: ${o.version}`,
    o.globs.length === 1 ? `          maps: ${yamlLine(o.globs[0])}` : "          maps: |",
    ...(o.globs.length === 1 ? [] : o.globs.map((g) => `            ${g}`)),
    "          strict: true",
    "          pictures: true",
    ...(o.scripted.length
      ? ["          # Compiles the TrigScript script of each map that keeps one, and writes nothing.", "          build: true"]
      : ["          # For a map with a TrigScript script: compiles it, and writes nothing.", "          # build: true"]),
    "      # scmjs map test plays a map's tests in the game itself, which needs a copy of StarCraft: GitHub's runners",
    "      # have none, so it has no step here. On a runner of your own with the game installed (runs-on: self-hosted),",
    "      # after the action has put scmjs on PATH, this plays them and keeps a GIF of each failed scenario:",
    "      # - run: scmjs map test <map> --format github --clips",
    "",
  ].join("\n");
}

/** Text for a Markdown table cell: one line, no colour bytes, `|` escaped. */
function cell(s: string): string {
  // eslint-disable-next-line no-control-regex -- StarCraft's colour bytes, whatever gameText left
  return visible(gameText(s)).replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** The folder's README: the maps, then the commands people reach for, then what each clone needs once. */
export function readmeText(title: string, maps: readonly InitMap[]): string {
  const globs = mapGlobs("", maps.map((m) => m.file));
  const link = (f: string) => `[${cell(f)}](${encodeURI(f).replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
  const example = maps[0]?.file ?? "ridge.scx";
  const quoted = /^[\w.@+-]+$/.test(example) ? example : `"${example}"`;
  return [
    `# ${title}`,
    "",
    "StarCraft: Brood War maps, kept in git and checked with [scmjs](https://docs.scmjs.dev/cli).",
    "",
    ...(maps.length
      ? [
        "| Map | File | Size | Tileset | Players |",
        "| --- | --- | --- | --- | --- |",
        ...maps.map((m) => `| ${cell(m.name) || "Untitled"} | ${link(m.file)} | ${m.width} × ${m.height} | ${cell(m.tileset)} | ${m.players} |`),
      ]
      : ["No maps yet."]),
    "",
    "## Commands",
    "",
    "`scmjs` is `npm install -g @scm-js/cli`; `npx @scm-js/cli` in its place runs it without installing.",
    "",
    "Check Map, as the editor runs it, over every map (the workflow in `.github/workflows/maps.yml` runs the same on",
    "each push and pull request):",
    "",
    "```sh",
    `scmjs map check ${globs.join(" ")} --strict`,
    "```",
    "",
    "A map as text — header, players, units, locations, triggers, strings — to read or search:",
    "",
    "```sh",
    `scmjs map dump ${quoted}`,
    "```",
    "",
    "What changed in a map since the last commit (any git revision works in place of `HEAD`):",
    "",
    "```sh",
    `scmjs map diff --rev HEAD ${quoted}`,
    "```",
    "",
    "When two branches change the same map, `git merge` merges it part by part through `scmjs map merge`. If both",
    "changed the same thing differently, git stops on the map and the command lists what clashed; settle it with",
    "one side's version, then `git add` the map:",
    "",
    "```sh",
    `scmjs map merge ${quoted} --ours`,
    "```",
    "",
    "## After cloning",
    "",
    "`git diff` and `git log -p` show what changed inside a map, and `git merge` merges maps, once each clone has these",
    "settings. `scmjs init` sets them (and writes nothing that is already here), or by hand:",
    "",
    "```sh",
    ...GIT_SETTINGS.map(configLine),
    "```",
    "",
  ].join("\n");
}

/**
 * The lines of `want` that `text` lacks; for `.gitattributes`, a pattern that already names the attribute the line
 * sets (`diff`, `merge`) counts as there — someone's own driver for it is left alone.
 */
export function missingLines(text: string, want: readonly string[], attributes = false): string[] {
  const have = text.split(/\r?\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter((l) => l && !l.startsWith("#"));
  return want.filter((w) => {
    if (have.includes(w)) return false;
    if (!attributes) return true;
    const [pattern, attribute] = w.split(" ");
    const name = attribute.replace(/=.*$/, "");
    const names = new RegExp(`(^|\\s)-?!?${name}(=|\\s|$)`);
    return !have.some((l) => l.split(" ")[0] === pattern && names.test(l.slice(pattern.length) + " "));
  });
}

/** `text` with `lines` added at the end, under `comment`; a missing final newline is put back first. */
function appendLines(text: string, lines: string[], comment: string): string {
  const head = text && !text.endsWith("\n") ? `${text}\n` : text;
  return `${head}${head ? "\n" : ""}${comment}\n${lines.join("\n")}\n`;
}

/** The maps in the folder (not its subfolders), opened as the editor would, each with its row for the README. */
async function readMaps(dir: string): Promise<{ maps: InitMap[]; skipped: InitResult["skipped"] }> {
  const files = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && MAP_FILE.test(e.name)).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  const maps: InitMap[] = [], skipped: InitResult["skipped"] = [];
  for (const file of files) {
    try {
      const input = await readInput(join(dir, file));
      const doc = await loadMapInput(input);
      const r = mapReport(input, doc);
      maps.push({ file, name: r.name, width: r.width, height: r.height, tileset: r.tileset, players: r.usedSlots.length, script: await hasScript(doc.extras) });
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      skipped.push({ file, error: e.message });
    }
  }
  return { maps, skipped };
}

/** Set up the folder (or, with `print`, work out what would be written). Exits 2 when there is no such folder. */
export async function initFolder(folder: string, o: InitOptions = {}): Promise<InitResult> {
  let dir: string;
  try {
    if (!statSync(folder).isDirectory()) throw new CliError(`${folder} is a file, not a folder`, "scmjs init takes the folder the maps are in.", 2);
    dir = realpathSync(folder);
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new CliError(`No folder ${folder}`, "scmjs init takes the folder the maps are in; . is this one.", 2);
  }
  const notes: string[] = [];
  let repository = repositoryOf(dir);
  let created = false;
  if (!repository && o.git) {
    if (o.print) repository = dir;
    else {
      const r = git(dir, "init", "--quiet");
      if (!r.ok) throw new CliError(`git init did not run in ${folder}: ${r.err.split("\n")[0] || "is git installed?"}`, "Install git (git-scm.com), or leave --git off.", 2);
      repository = repositoryOf(dir) ?? dir;
      created = true;
    }
  }

  const { maps, skipped } = await readMaps(dir);
  const top = repository ?? dir;
  const prefix = relative(top, dir).split(sep).join("/");
  const show = (p: string) => relative(dir, p).split(sep).join("/");
  const files: InitFile[] = [];

  // The line files: the lines they lack, at the end, under a comment.
  for (const [name, want, comment, attributes] of [[".gitattributes", ATTRIBUTE_LINES, ATTRIBUTE_COMMENT, true], [".gitignore", IGNORE_LINES, IGNORE_COMMENT, false]] as const) {
    const path = join(dir, name);
    const text = existsSync(path) ? readFileSync(path, "utf8") : null;
    const lack = missingLines(text ?? "", want, attributes);
    const what = attributes ? "maps diff as text and merge part by part" : "the .bak files Save leaves, map test's replays and clips";
    if (!lack.length) { files.push({ path: show(path), state: "kept", detail: "has the lines already", content: want.join("\n") + "\n" }); continue; }
    const content = appendLines(text ?? "", lack, comment);
    if (!o.print) writeFileSync(path, content);
    files.push({ path: show(path), state: text === null ? "written" : "added", detail: text === null ? what : `${lack.length === 1 ? "a line" : `${lack.length} lines`} added: ${lack.join(", ")}`, content: text === null ? content : lack.join("\n") + "\n" });
  }

  // The whole files: written when absent, or with --force.
  const scripted = maps.filter((m) => m.script).map((m) => (prefix ? `${prefix}/${m.file}` : m.file));
  const whole: [string, string, string][] = [
    [join(top, WORKFLOW_PATH), workflowText({ version: VERSION, globs: mapGlobs(prefix, maps.map((m) => m.file), false), scripted }),
      `checks ${maps.length === 1 ? "the map" : maps.length ? `the ${maps.length} maps` : "the maps"} on push and pull request${scripted.length ? `, builds ${plural(scripted.length, "script")}` : ""}; scmjs ${VERSION}`],
    [join(dir, "README.md"), readmeText(basename(dir), maps), maps.length ? `lists ${maps.length === 1 ? "the map" : `the ${maps.length} maps`}, and the commands` : "the commands"],
  ];
  for (const [path, content, detail] of whole) {
    const there = existsSync(path);
    if (there && !o.force) { files.push({ path: show(path), state: "kept", detail: "there already (--force replaces it)", content }); continue; }
    if (!o.print) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
    files.push({ path: show(path), state: there ? "replaced" : "written", detail, content });
  }

  // The git settings, in the repository.
  const settings: InitGit[] = GIT_SETTINGS.map(([key, value]) => {
    if (!repository) return { key, value, state: "none", current: null };
    const now = git(top, "config", "--get", key);
    const current = now.ok ? now.out : null;
    if (current === value) return { key, value, state: "kept", current };
    if (current !== null && !o.force && !OLD_SETTINGS[key]?.includes(current)) return { key, value, state: "other", current };
    if (!o.print) {
      const r = git(top, "config", key, value);
      if (!r.ok) throw new CliError(`git config ${key} did not take: ${r.err.split("\n")[0]}`);
    }
    return { key, value, state: "set", current };
  });
  if (!repository) notes.push("Not in a git repository, so the git settings were not made: run scmjs init again after git init (or now with --git), or set them by hand (scmjs init --print).");
  else if (settings.some((s) => s.state !== "kept") && !onPath("scmjs")) notes.push("git diff runs scmjs map dump and git merge runs scmjs map merge, and scmjs is not on PATH here: npm install -g @scm-js/cli.");
  if (repository && prefix) notes.push(`The workflow is at the repository's top, where GitHub reads it, and checks ${prefix}/ from there.`);
  if (!maps.length) notes.push("No maps in the folder yet: the workflow checks *.scx, and fails until there is one.");
  if (maps.some((m) => m.script === null)) notes.push("This build of scmjs has no TrigScript compiler, so maps with a script were not looked for.");

  return { folder: dir, repository, created, printed: !!o.print, maps, skipped, files, git: settings, notes };
}

/** The recipe as text to paste, for `--print`: each file (or the lines it takes), then the git commands. */
export function printRecipe(r: InitResult): string {
  const out: string[] = [];
  for (const f of r.files) {
    out.push(`# ${f.path}${f.state === "added" ? " (the lines it lacks, at the end)" : f.state === "kept" ? " (there already)" : ""}`, f.content.replace(/\n$/, ""), "");
  }
  out.push("# git, once in each clone", ...GIT_SETTINGS.map(configLine), "");
  return out.join("\n");
}

const STATE_WORD: Record<FileState, string> = { written: "written", replaced: "replaced", added: "lines added", kept: "left alone" };

/** What was written and what was left alone, one line each, then the notes. */
/** A folder as the person would type it: from here when that is shorter, else the whole path. */
function showFolder(p: string): string {
  const rel = relative(process.cwd(), p);
  return rel === "" ? basename(p) : rel.length < p.length ? rel : p;
}

export function printInit(r: InitResult): string[] {
  const show = showFolder;
  const scripts = r.maps.filter((m) => m.script).length;
  const where = r.created ? "a new git repository" : r.repository === r.folder ? "a git repository" : r.repository ? `in the git repository ${show(r.repository)}` : "not in a git repository";
  const rowsOut: string[][] = r.files.map((f) => f.state === "kept"
    ? [pc.dim(`· ${f.path}`), pc.dim(`${STATE_WORD[f.state]}: ${f.detail}`)]
    : [`${mark.ok} ${f.path}`, f.state === "added" ? f.detail : `${STATE_WORD[f.state]}: ${f.detail}`]);
  // One row per group of settings (`diff.scmjs`, `merge.scmjs`) and state, with the keys' last parts.
  const group = (k: string) => k.slice(0, k.lastIndexOf("."));
  const short = (k: string) => k.slice(k.lastIndexOf(".") + 1);
  for (const prefix of new Set(r.git.map((g) => group(g.key)))) {
    const of = r.git.filter((g) => group(g.key) === prefix);
    const set = of.filter((g) => g.state === "set"), kept = of.filter((g) => g.state === "kept");
    if (set.length) rowsOut.push([`${mark.ok} git config ${prefix}`, `set: ${set.map((g) => short(g.key)).join(", ")}`]);
    if (kept.length) rowsOut.push([pc.dim(`· git config ${prefix}`), pc.dim(`left alone: ${kept.map((g) => short(g.key)).join(", ")} already so`)]);
  }
  for (const g of r.git.filter((x) => x.state === "other")) rowsOut.push([`${mark.warn} git config ${g.key}`, `left alone: it is "${g.current}" (--force sets "${g.value}")`]);
  return [
    `${pc.bold(showFolder(r.folder))}${dot}${plural(r.maps.length, "map")}${scripts ? pc.dim(` (${scripts} with a TrigScript script)`) : ""}${dot}${where}`,
    ...table(rowsOut, 2),
    ...r.skipped.map((s) => `${mark.warn} ${s.file} was left out: ${s.error}`),
    ...r.notes.map((n) => `${mark.info} ${n}`),
  ];
}
