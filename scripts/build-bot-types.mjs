/**
 * `npm run build:bot-types`: `@scm-js/bot`, the type declarations a JavaScript bot author
 * types against, as **one file** (`bot/dist/index.d.ts`).
 *
 * The bot interface is written in scm-sim, the play page's engine, which is a private
 * repository: `src/bot/api.ts` (`BOT_API`, the view and the orders) and `src/bot/kit.ts`
 * (the short way, `onFrame(game)`, written on it). Both are kept free of imports — `api.ts`
 * imports nothing and `kit.ts` only `./api.ts` — so they can travel. This repository holds
 * copies of the two in `bot/src/`, committed, which is what makes the package buildable,
 * testable and reviewable here without scm-sim:
 *
 *   node scripts/build-bot-types.mjs --from ~/github/scm-sim   # copy the two files in, then build
 *   node scripts/build-bot-types.mjs                           # build from the copies
 *   node scripts/build-bot-types.mjs --check ~/github/scm-sim  # fail if the copies differ from that checkout
 *
 * `--from` copies the files byte for byte and prints the checkout's commit, for the commit
 * message that brings them in; nothing is rewritten, so `--check` is a plain comparison.
 * The build is `dts-bundle-generator` on `tsconfig.bot.json` (strict, no ambient types,
 * `stripInternal`, so the layer's own `@internal` members stay out of a bot author's
 * completion). It refuses a bundle that imports anything, that lacks the names the guide
 * tells people to import, or whose `package.json` major is not `BOT_API`: the package's
 * major is the interface's version, as `@scm-js/plugin-api`'s is the plugin API's.
 *
 * Publishing is by hand, by the user: `npm publish` in `bot/` (its `prepack` runs this).
 * `.claude/internals/cli.md` ("`@scm-js/bot`") has the steps.
 */
import { generateDtsBundle } from "dts-bundle-generator";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { importsIn } from "./build-plugin-types.mjs";

const root = resolve(import.meta.dirname, "..");
export const BOT_DIR = join(root, "bot");
const ENTRY = join(BOT_DIR, "src/index.ts");
const PROJECT = join(root, "tsconfig.bot.json");

/** The two files, as scm-sim names them and as they sit here. */
export const COPIED = [
  { from: "src/bot/api.ts", to: "src/api.ts" },
  { from: "src/bot/kit.ts", to: "src/kit.ts" },
];

/** What a bot author is told to import; a bundle without one of them is broken. */
export const REQUIRED = ["EasyBot", "Game", "Unit", "Units", "BotModule", "BotInit", "BotView", "BotApi"];

/** `BOT_API` as `api.ts` declares it — read, not imported, so this stays a plain script. */
export function botApiVersionOf(source) {
  const m = /export const BOT_API\s*=\s*(\d+)/.exec(source);
  if (!m) throw new Error("Could not find BOT_API in bot/src/api.ts.");
  return Number(m[1]);
}

/** Every module specifier a TypeScript source imports or re-exports, type-only ones included. */
export function sourceImports(text) {
  const found = new Set();
  for (const m of text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gm)) found.add(m[1]);
  for (const m of text.matchAll(/^\s*import\s*["']([^"']+)["']/gm)) found.add(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) found.add(m[1]);
  return [...found];
}

/** What a copied file may import: `api.ts` nothing, `kit.ts` only `./api.ts`. */
export const ALLOWED_IMPORTS = { "src/api.ts": [], "src/kit.ts": ["./api.ts"] };

function checkImports(name, text) {
  const stray = sourceImports(text).filter((s) => !ALLOWED_IMPORTS[name].includes(s));
  if (stray.length > 0) throw new Error(`${name} imports ${stray.join(", ")}; the bot interface's files may import only each other.`);
}

/** Copy the two files in from an scm-sim checkout, and answer its commit. */
export function copyFrom(simDir) {
  for (const { from, to } of COPIED) {
    const source = join(simDir, from);
    if (!existsSync(source)) throw new Error(`${source} does not exist; --from names an scm-sim checkout.`);
    checkImports(to, readFileSync(source, "utf8"));
  }
  mkdirSync(join(BOT_DIR, "src"), { recursive: true });
  for (const { from, to } of COPIED) copyFileSync(join(simDir, from), join(BOT_DIR, to));
  try {
    return execFileSync("git", ["-C", simDir, "log", "-1", "--format=%h %s"], { encoding: "utf8" }).trim();
  } catch {
    return "(not a git checkout)";
  }
}

/** The copies that differ from an scm-sim checkout's files. */
export function differences(simDir) {
  return COPIED.filter(({ from, to }) => {
    try { return readFileSync(join(simDir, from), "utf8") !== readFileSync(join(BOT_DIR, to), "utf8"); } catch { return true; }
  }).map(({ to }) => to);
}

/** The one declaration file, with the banner that says what it is and where it came from. */
export function buildBundle({ generator = generateDtsBundle } = {}) {
  for (const { to } of COPIED) checkImports(to, readFileSync(join(BOT_DIR, to), "utf8"));
  const apiVersion = botApiVersionOf(readFileSync(join(BOT_DIR, "src/api.ts"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(BOT_DIR, "package.json"), "utf8"));
  const major = Number(/^(\d+)\./.exec(pkg.version)?.[1]);
  if (major !== apiVersion) throw new Error(`bot/package.json is ${pkg.version} but BOT_API is ${apiVersion}; the package's major is the interface's version.`);

  const [body] = generator(
    [{ filePath: ENTRY, output: { noBanner: true, sortNodes: false } }],
    { preferredConfigPath: PROJECT },
  );
  const stray = importsIn(body);
  if (stray.length > 0) throw new Error(`The bundle still imports ${stray.join(", ")}; every type it names has to be in the file.`);
  const missing = REQUIRED.filter((name) => !new RegExp(`\\b(?:interface|class|type)\\s+${name}\\b`).test(body));
  if (missing.length > 0) throw new Error(`The bundle does not declare ${missing.join(", ")}.`);
  const banner = [
    "/**",
    ` * Type declarations for scmJS bots: the bot interface (BOT_API ${apiVersion}) and the short way`,
    " * written on it, for a JavaScript bot that plays on scmjs.dev/play or under `scmjs bot run`.",
    " *",
    " * Types only: import them with `import type`, or name them in a JSDoc comment. Everything a",
    " * bot needs at run time is handed to it by the game. The guide is",
    " * https://docs.scmjs.dev/bots/ (docs/bots.md in github.com/scm-js/scm-js).",
    " */",
    "",
  ].join("\n");
  return { apiVersion, version: pkg.version, text: banner + body };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const argv = process.argv.slice(2);
  const value = (name) => { const i = argv.indexOf(name); return i === -1 ? null : resolve(argv[i + 1] ?? ""); };
  try {
    const check = value("--check");
    if (check) {
      const differ = differences(check);
      if (differ.length > 0) {
        console.error(`bot: ${differ.join(", ")} differ from ${check}. Run \`node scripts/build-bot-types.mjs --from ${check}\`.`);
        process.exit(1);
      }
      console.log(`bot: bot/src/ matches ${check}.`);
      process.exit(0);
    }
    const from = value("--from");
    if (from) console.log(`bot: copied api.ts and kit.ts from ${from} at ${copyFrom(from)}.`);
    const { text, apiVersion, version } = buildBundle();
    mkdirSync(join(BOT_DIR, "dist"), { recursive: true });
    writeFileSync(join(BOT_DIR, "dist/index.d.ts"), text);
    console.log(`bot: bot/dist/index.d.ts — ${Math.round(text.length / 1024)} KB, @scm-js/bot ${version}, BOT_API ${apiVersion}.`);
  } catch (err) {
    console.error(`bot: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}
