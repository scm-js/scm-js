// `npm run doctor`: is this machine ready to work on scmJS? Node, the installed packages, the game data the editor
// draws with and the tests that need it, the browser the browser tests drive. Each finding says what to run.
// Nothing is changed. Exit 1 when something blocks `npm run dev` or `npm test`; a missing extra is only reported.
//   npm run doctor
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromiumState, gameData, starcraftFolder, wsl } from "./lib/devenv.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const at = (...p) => join(root, ...p);
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const [green, yellow, red, dim, bold] = [paint(32), paint(33), paint(31), paint(2), paint(1)];
let blocked = false;

/** ok: fine; warn: works, with less; bad: blocks dev or tests. `fix` is what to run, `note` what it means. */
function say(state, what, detail, { fix, note } = {}) {
  const mark = state === "ok" ? green("✔") : state === "warn" ? yellow("▲") : red("✖");
  if (state === "bad") blocked = true;
  console.log(`${mark} ${bold(what)}${detail ? `  ${detail}` : ""}`);
  if (note) console.log(dim(`    ${note}`));
  if (fix) console.log(`    ${fix}`);
}

console.log(bold("scmJS doctor") + dim(`  ${process.platform}${wsl ? " (WSL)" : ""} ${process.arch}`) + "\n");

// Node: package.json's engines, which the extraction scripts need (type stripping).
const want = JSON.parse(readFileSync(at("package.json"), "utf8")).engines.node.replace(/^>=/, "");
const older = (a, b) => { const [x, y] = [a, b].map((v) => v.replace(/^v/, "").split(".").map(Number)); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
if (older(process.version, want)) say("bad", "Node", `${process.version}, needs ${want} or newer`, { fix: "nvm install 22   (the repository's .nvmrc says 22)" });
else say("ok", "Node", process.version);

// Packages: installed, and from the lockfile as it is now.
// npm keeps node_modules/.package-lock.json as what it installed; a package whose version differs from the lockfile's
// (a pull that changed the dependencies) is what makes a working tree fail in odd ways.
const marker = at("node_modules", ".package-lock.json");
if (!existsSync(marker)) say("bad", "Packages", "not installed", { fix: "npm ci" });
else {
  const want = JSON.parse(readFileSync(at("package-lock.json"), "utf8")).packages ?? {};
  const have = JSON.parse(readFileSync(marker, "utf8")).packages ?? {};
  // Optional packages (one platform's binary of esbuild, say) are only installed where they apply; links have no version.
  const stale = Object.entries(want)
    .filter(([path, p]) => path !== "" && !p.optional && !p.link && have[path]?.version !== p.version)
    .map(([path]) => path.replace(/^.*node_modules\//, ""));
  if (stale.length) say("warn", "Packages", `${stale.length} ${stale.length === 1 ? "differs" : "differ"} from package-lock.json (${stale.slice(0, 3).join(", ")}${stale.length > 3 ? ", …" : ""})`, { fix: "npm ci", note: "The dependencies changed since you last installed." });
  else say("ok", "Packages", "installed, as package-lock.json says");
}

// The default plugins the build compiles in, fetched by predev/prebuild.
const vendored = existsSync(at("plugins")) && readdirSync(at("plugins")).some((d) => existsSync(at("plugins", d, "vendored.json")));
say(vendored ? "ok" : "warn", "Default plugins", vendored ? "fetched into plugins/" : "not fetched yet", vendored ? {} : { note: "The first npm run dev or npm run build fetches them, so it needs the network once." });

// Game data: what the editor draws with (public/), and the archives and maps some test suites read (fixtures/).
const found = starcraftFolder();
const data = gameData(root);
if (data.extracted) say("ok", "Game data", "extracted into public/");
else say("warn", "Game data", "not extracted", {
  fix: found ? `npm run extract -- --from "${found}"` : "npm run extract -- --from <your StarCraft folder>",
  note: `${found ? `StarCraft 1.16 is at ${found}. ` : "It needs a classic StarCraft (1.16) folder with StarDat.mpq and BrooDat.mpq. "}Without it terrain is flat colours, and the tileset and unit test suites skip.${found ? "" : " Remastered's files are read only by Help ▸ Game Data… in the editor."}`,
});
say(data.archives ? "ok" : "warn", "Test archives", data.archives ? "fixtures/data/ has StarDat.mpq and BrooDat.mpq" : "fixtures/data/ has no StarDat.mpq and BrooDat.mpq", data.archives ? {} : { fix: found ? `cp "${found}/StarDat.mpq" "${found}/BrooDat.mpq" fixtures/data/` : undefined, note: "The suites that read the archives themselves skip without them. Never commit them." });
say(data.maps ? "ok" : "warn", "Test maps", data.maps ? `${data.maps} in fixtures/maps/` : "none in fixtures/maps/", data.maps ? {} : { fix: found ? `cp "${found}/Maps/Ladder/"*.sc? fixtures/maps/   (or any maps of Blizzard's you have)` : undefined, note: "The suites that open Blizzard's maps skip without them; tests/maps/ (generated, committed) always run. Never commit them." });

// The browser tests' Chromium: installed, and able to start (on Linux and WSL it needs system libraries).
const browser = await chromiumState(root);
if (browser.state === "ok") say("ok", "Browser tests", "Chromium starts");
else if (browser.state === "missing") say("warn", "Browser tests", "Chromium is not installed", { fix: "npx playwright install chromium", note: "npm run test:e2e needs it; nothing else does." });
else if (browser.state === "libraries") say("warn", "Browser tests", "Chromium is missing system libraries", { fix: "sudo npx playwright install-deps chromium", note: `${browser.library ?? "A library Playwright can install"} is missing.` });
else say("warn", "Browser tests", "Chromium did not start", { note: browser.text });

console.log("\n" + (blocked ? red("Fix the ✖ lines first.") : `${green("Ready.")} ${dim("npm run dev starts the editor; npm run verify runs what CI runs.")}`));
process.exitCode = blocked ? 1 : 0;
