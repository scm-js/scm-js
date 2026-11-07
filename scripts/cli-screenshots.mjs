/**
 * The pictures in the command line guide (`docs/cli.md` → `docs/images/cli-*.webp`), taken again.
 *
 * Builds `scmjs`, runs real commands with colour forced on, and draws what they print as a
 * terminal: the output goes through a small terminal emulator here (colours, cursor moves,
 * line erases), becomes a page of fixed-width cells, and headless Chromium photographs it.
 * The PNG files commands write themselves (`map preview --out`, `map diff --picture --out`)
 * are converted the same way. WebP is encoded by the browser's own canvas, lossless for
 * the terminals and at quality 90 for the map pictures, so the only package needed is
 * Playwright, which the end-to-end tests already install.
 *
 *   node scripts/cli-screenshots.mjs [--only overview,map-info] [--out docs/images]
 *                                    [--browser <chrome>] [--starcraft <folder>]
 *                                    [--play-url http://127.0.0.1:8766/play] [--bots <folder>]
 *                                    [--work <folder>]
 *
 * The inputs are only what this repository controls: the generated maps in `tests/maps/`,
 * maps `scmjs map generate` makes, and replays the game engine saves. Never point it at a
 * Blizzard or community map; the pictures are committed.
 *
 * What each picture needs beyond Node:
 *   - your copy of StarCraft (found as the commands find it, or `--starcraft`) for the map
 *     pictures, the generated maps and everything that runs the game;
 *   - the game engine for `map trace`, `map test`, `bot ladder` and `replay watch`, fetched
 *     from scmjs.dev/play, or from `--play-url` (a staged scm-sim deploy served locally,
 *     when the newest runners are not deployed yet);
 *   - built bots for the ladder and the replay watched: `--bots` names a folder with
 *     `ualbertabot.scmbot` and `example.scmbot` (scm-sim's catalogue builds).
 * A picture whose inputs are missing is skipped with a line saying why, and its file is
 * left as it is. Every command runs in a terminal made by util-linux's `script`, 96 columns wide, so it lays its
 * output out as it would on screen; this is why the script runs on Linux.
 *
 * Nothing here is a test: a picture that comes out wrong is seen by looking at it.
 */
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const OUT = resolve(root, opt("--out", "docs/images"));
const ONLY = opt("--only", "")?.split(",").filter(Boolean) ?? [];
const BROWSER = opt("--browser", process.env.SCMJS_BROWSER ?? "");
const STARCRAFT = opt("--starcraft", process.env.SCMJS_STARCRAFT ?? "");
const PLAY_URL = opt("--play-url", process.env.SCMJS_PLAY_URL ?? "");
const BOTS = opt("--bots", "");
const WORK = resolve(opt("--work", "") || mkdtempSync(join(tmpdir(), "scmjs-shots-")));
const SCMJS = join(root, "cli/dist/scmjs.mjs");
/** The terminal's width for the pictures: narrow enough that the text stays legible at the guide's width. */
const COLS = 96;

const { chromium } = await import("playwright").catch(() => {
  console.error("Playwright is not installed. Run npm install (it is a dev dependency), then npx playwright install chromium.");
  process.exit(1);
});

/* ── running the command ──────────────────────────────────────────────────────────── */

const ENV = {
  ...process.env,
  FORCE_COLOR: "1",
  COLORTERM: "truecolor",
  ...(STARCRAFT ? { SCMJS_STARCRAFT: STARCRAFT } : {}),
  ...(PLAY_URL ? { SCMJS_PLAY_URL: PLAY_URL } : {}),
};
delete ENV.NO_COLOR;

/** Runs `scmjs <argv>` in the work folder; the output as the terminal would get it (stdout and stderr in order). */
function scmjs(argv, { allowFail = true } = {}) {
  const r = spawnSync(process.execPath, [SCMJS, ...argv], { cwd: WORK, env: ENV, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0 && !allowFail) throw new Error(`scmjs ${argv.join(" ")} exited ${r.status}\n${r.stderr}`);
  return { text: (r.stdout ?? "") + (r.stderr ?? ""), stdout: r.stdout ?? "", status: r.status };
}

/**
 * Runs `scmjs <argv>` in a terminal `cols` × `rows` (util-linux `script`) and returns what it drew, so the command
 * lays its output out for that width as it would on screen. `keys` are typed after `ms`, for one that waits.
 */
function shell(argv, { cols = COLS, rows = 50, ms = 0, keys = "", timeout = 15 * 60_000 } = {}) {
  const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
  const line = `stty cols ${cols} rows ${rows}; exec ${[process.execPath, SCMJS, ...argv].map(quote).join(" ")}`;
  return new Promise((done, fail) => {
    const child = spawn("script", ["-qfec", line, "/dev/null"], { cwd: WORK, env: ENV, stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d) => { out += d; });
    child.on("error", fail);
    child.on("close", () => done(out));
    if (keys) setTimeout(() => child.stdin.write(keys), ms);
    const stop = setTimeout(() => child.kill("SIGTERM"), ms + timeout);
    child.on("close", () => clearTimeout(stop));
  });
}

/* ── a terminal, as cells ─────────────────────────────────────────────────────────── */

const THEME = {
  bg: "#16181d", fg: "#d7dae0",
  ansi: ["#000000", "#e05561", "#8cc265", "#d18f52", "#4aa5f0", "#c162de", "#42b3c2", "#d7dae0",
    "#5c6370", "#ff616e", "#a5e075", "#f0a45d", "#4dc4ff", "#de73ff", "#4cd1e0", "#ffffff"],
};

function color256(n) {
  if (n < 16) return THEME.ansi[n];
  if (n >= 232) { const v = 8 + (n - 232) * 10; return rgb(v, v, v); }
  const i = n - 16, step = (c) => (c ? 55 + c * 40 : 0);
  return rgb(step(Math.floor(i / 36)), step(Math.floor(i / 6) % 6), step(i % 6));
}
const rgb = (r, g, b) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Hangul, CJK, kana and full-width forms take two cells, as `cli/src/ui.ts` counts them. */
function cellWidth(cp) {
  if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200b || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)) return 2;
  return 1;
}

/** A control sequence after its `ESC [`: private-mode mark, parameters, intermediates, final byte. */
const CSI = /^([?>]?)([\d;]*)([ -/]*)([@-~])/;

/** Plays `text` into a grid of cells: printable characters, CR/LF, CSI cursor moves and erases, SGR colour. */
function emulate(text, cols = 400) {
  const grid = [];
  let x = 0, y = 0;
  const blank = () => ({ ch: " ", w: 1, ...style });
  let style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
  const row = (r) => { while (grid.length <= r) grid.push([]); return grid[r]; };
  const put = (ch, w) => {
    if (x + w > cols) { x = 0; y++; }
    const r = row(y);
    while (r.length < x) r.push(blank());
    r[x] = { ch, w, ...style };
    if (w === 2) r[x + 1] = { ch: "", w: 0, ...style };
    x += w;
  };
  const sgr = (params) => {
    const p = params.length ? params : [0];
    for (let i = 0; i < p.length; i++) {
      const n = p[i];
      if (n === 0) style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false };
      else if (n === 1) style = { ...style, bold: true };
      else if (n === 2) style = { ...style, dim: true };
      else if (n === 3) style = { ...style, italic: true };
      else if (n === 4) style = { ...style, underline: true };
      else if (n === 7) style = { ...style, inverse: true };
      else if (n === 22) style = { ...style, bold: false, dim: false };
      else if (n === 23) style = { ...style, italic: false };
      else if (n === 24) style = { ...style, underline: false };
      else if (n === 27) style = { ...style, inverse: false };
      else if (n >= 30 && n <= 37) style = { ...style, fg: THEME.ansi[n - 30] };
      else if (n >= 90 && n <= 97) style = { ...style, fg: THEME.ansi[n - 90 + 8] };
      else if (n >= 40 && n <= 47) style = { ...style, bg: THEME.ansi[n - 40] };
      else if (n >= 100 && n <= 107) style = { ...style, bg: THEME.ansi[n - 100 + 8] };
      else if (n === 39) style = { ...style, fg: null };
      else if (n === 49) style = { ...style, bg: null };
      else if (n === 38 || n === 48) {
        const c = p[i + 1] === 5 ? color256(p[i + 2]) : p[i + 1] === 2 ? rgb(p[i + 2], p[i + 3], p[i + 4]) : null;
        i += p[i + 1] === 5 ? 2 : 4;
        style = n === 38 ? { ...style, fg: c } : { ...style, bg: c };
      }
    }
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\x1b") {
      const next = text[i + 1];
      if (next === "[") {
        const m = CSI.exec(text.slice(i + 2, i + 66));
        if (!m) continue;
        i += m[0].length + 1;
        if (m[1]) continue; // private modes: the cursor shown or hidden, the alternate screen
        const p = m[2] ? m[2].split(";").map((v) => (v === "" ? 0 : Number(v))) : [];
        const n = p[0] || 1;
        switch (m[4]) {
          case "m": sgr(p); break;
          case "A": y = Math.max(0, y - n); break;
          case "B": y += n; break;
          case "C": x += n; break;
          case "D": x = Math.max(0, x - n); break;
          case "G": x = n - 1; break;
          case "H": case "f": y = (p[0] || 1) - 1; x = (p[1] || 1) - 1; break;
          case "K": { const r = row(y); if ((p[0] ?? 0) === 2) r.length = 0; else if ((p[0] ?? 0) === 0) r.length = Math.min(r.length, x); break; }
          case "J": if ((p[0] ?? 0) >= 2) { grid.length = 0; x = 0; y = 0; } else { grid.length = Math.min(grid.length, y + 1); row(y).length = Math.min(row(y).length, x); } break;
        }
      } else if (next === "]" || next === "_" || next === "P") {
        // OSC, APC (kitty's pictures), DCS: skip to BEL or ST.
        let j = i + 2;
        while (j < text.length && text[j] !== "\x07" && !(text[j] === "\x1b" && text[j + 1] === "\\")) j++;
        i = text[j] === "\x07" ? j : j + 1;
      } else i++;
      continue;
    }
    if (c === "\r") { x = 0; continue; }
    if (c === "\n") { x = 0; y++; row(y); continue; }
    if (c === "\b") { x = Math.max(0, x - 1); continue; }
    if (c === "\t") { x = (Math.floor(x / 8) + 1) * 8; continue; }
    const cp = text.codePointAt(i);
    if (cp > 0xffff) i++;
    if (cp < 0x20) continue;
    const w = cellWidth(cp);
    if (w) put(String.fromCodePoint(cp), w);
  }
  while (grid.length && grid[grid.length - 1].every((cell) => cell.ch === " " && !cell.bg)) grid.pop();
  return grid.map((r) => { while (r.length && r[r.length - 1].ch === " " && !r[r.length - 1].bg) r.pop(); return r; });
}

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function mix(a, b, t) {
  const pa = [1, 3, 5].map((k) => parseInt(a.slice(k, k + 2), 16)), pb = [1, 3, 5].map((k) => parseInt(b.slice(k, k + 2), 16));
  return rgb(...pa.map((v, k) => Math.round(v * (1 - t) + pb[k] * t)));
}

/** The cells as a page: each run of one style a span, the half and full blocks painted rather than drawn as glyphs. */
function terminalHtml(grid) {
  const cols = Math.max(40, ...grid.map((r) => r.length));
  const cellStyle = (c) => {
    let fg = c.fg ?? THEME.fg, bg = c.bg;
    if (c.inverse) [fg, bg] = [bg ?? THEME.bg, fg];
    if (c.dim) fg = mix(fg, bg ?? THEME.bg, 0.45);
    return { fg, bg };
  };
  const rows = grid.map((r) => {
    let html = "";
    let i = 0;
    while (i < r.length) {
      const c = r[i];
      const { fg, bg } = cellStyle(c);
      // ▀ ▄ █: the two halves of the cell painted, so a picture made of them has no seams.
      if (c.ch === "▀" || c.ch === "▄" || c.ch === "█") {
        const back = bg ?? THEME.bg;
        const top = c.ch === "▄" ? back : fg, bottom = c.ch === "▀" ? back : fg;
        html += `<i style="width:1ch;background:linear-gradient(${top} 50%,${bottom} 50%)"></i>`;
        i++;
        continue;
      }
      if (c.w === 2) {
        html += `<i style="width:2ch;color:${fg};${bg ? `background:${bg};` : ""}${c.bold ? "font-weight:bold;" : ""}">${escapeHtml(c.ch)}</i>`;
        i += 2;
        continue;
      }
      let text = "", j = i;
      const key = JSON.stringify([fg, bg, c.bold, c.italic, c.underline]);
      while (j < r.length && r[j].w === 1 && !"▀▄█".includes(r[j].ch)) {
        const s = cellStyle(r[j]);
        if (JSON.stringify([s.fg, s.bg, r[j].bold, r[j].italic, r[j].underline]) !== key) break;
        text += r[j].ch;
        j++;
      }
      if (j === i) { i++; continue; }
      const css = `width:${j - i}ch;color:${fg};${bg ? `background:${bg};` : ""}${c.bold ? "font-weight:bold;" : ""}${c.italic ? "font-style:italic;" : ""}${c.underline ? "text-decoration:underline;" : ""}`;
      html += `<i style="${css}">${escapeHtml(text)}</i>`;
      i = j;
    }
    return `<div>${html}</div>`;
  });
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    .term { display: inline-block; background: ${THEME.bg}; color: ${THEME.fg}; padding: 16px 20px; border-radius: 8px;
      font: 14px/17px "DejaVu Sans Mono", Menlo, Consolas, monospace; width: ${cols}ch; }
    .term div { height: 17px; white-space: pre; overflow: hidden; }
    .term i { display: inline-block; height: 17px; font-style: normal; vertical-align: top; overflow: hidden; }
  </style><div class="term">${rows.join("")}</div>`;
}

/* ── the pictures ─────────────────────────────────────────────────────────────────── */

let browser, page;
async function openBrowser() {
  browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1600, height: 900 } });
}

/** A data URL's bytes, encoded by the page's canvas: lossless at quality 1. */
async function toWebp(png, quality) {
  const url = await page.evaluate(async ({ b64, quality }) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/webp", quality);
  }, { b64: png.toString("base64"), quality });
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

function write(name, bytes) {
  const to = join(OUT, `${name}.webp`);
  writeFileSync(to, bytes);
  console.log(`  ${name}.webp  ${(bytes.length / 1024).toFixed(0)} KB`);
}

/**
 * Draws terminal output and writes it as `<name>.webp`. `cols` is the terminal's width: a longer line wraps there,
 * as it would on screen. A picture made of coloured cells is written at `quality` 0.9; text stays lossless.
 */
async function terminal(name, text, prompt, { cols = COLS, quality = 1 } = {}) {
  // The command line as typed, dim prompt first; it wraps at the terminal's edge like the rest.
  const typed = prompt ? `${String.fromCharCode(27)}[90m$${String.fromCharCode(27)}[39m ${prompt}\n` : "";
  await page.setContent(terminalHtml(emulate(typed + text, cols)));
  await page.evaluate(() => document.fonts.ready);
  const png = await page.locator(".term").screenshot({ omitBackground: true });
  write(name, await toWebp(png, quality));
}

/** A PNG a command wrote, as `<name>.webp`. */
async function picture(name, file) {
  await page.setContent("<!doctype html><title>picture</title>");
  write(name, await toWebp(readFileSync(join(WORK, file)), 0.9));
}

const have = {
  starcraft: () => { try { return JSON.parse(scmjs(["doctor", "--json"]).stdout).checks.some((c) => c.what === "StarCraft" && c.state === "ok"); } catch { return false; } },
  bots: () => !!BOTS && existsSync(join(BOTS, "ualbertabot.scmbot")) && existsSync(join(BOTS, "example.scmbot")),
};

const MAPS = join(root, "tests/maps");
/** The diff picture's edit: units added, removed and moved, and a patch of ground changed, by the plugin API. */
const DIFF_EDIT = `export default (api) => {
  api.document.edit("Revise", (tx) => {
    const units = tx.scenario.units;
    const starts = units.map((u, i) => [u, i]).filter(([u]) => u.unitId === 214);
    const [p1] = starts.find(([u]) => u.owner === 0);
    const minerals = units.map((u, i) => [u, i]).filter(([u]) => u.unitId >= 176 && u.unitId <= 178);
    const far = minerals.sort((a, b) => Math.hypot(b[0].x - p1.x, b[0].y - p1.y) - Math.hypot(a[0].x - p1.x, a[0].y - p1.y));
    tx.removeUnits([far[0][1], far[1][1]]);
    const moved = far[2][1];
    tx.updateUnits([moved], (u) => ({ x: u.x + 96, y: u.y + 64 }));
    const cx = tx.width * 16, cy = tx.height * 16;
    tx.addUnits([0, 0, 0, 0, 7].map((id, k) => tx.makeUnit(id, 0, cx - 160 + k * 40, cy - 96)));
    tx.addUnits([125, 124].map((id, k) => tx.makeUnit(id, 0, p1.x + 160 + k * 96, p1.y + 64)));
    const high = tx.tileAt(Math.floor(p1.x / 32), Math.floor(p1.y / 32));
    tx.setTiles({ x0: Math.floor(tx.width / 2) - 3, y0: Math.floor(tx.height / 2) + 2, x1: Math.floor(tx.width / 2) + 3, y1: Math.floor(tx.height / 2) + 5 }, high);
  });
};
`;

const SHOTS = [
  { name: "cli-overview", async run() { await terminal("cli-overview", await shell([]), "scmjs"); } },
  {
    name: "cli-map-info",
    async run() { copyFileSync(join(MAPS, "ums.scx"), join(WORK, "ums.scx")); await terminal("cli-map-info", await shell(["map", "info", "ums.scx"]), "scmjs map info ums.scx"); },
  },
  {
    name: "cli-map-check",
    async run() {
      for (const f of ["melee.scx", "hybrid.scm", "original.scm"]) copyFileSync(join(MAPS, f), join(WORK, f));
      await terminal("cli-map-check", await shell(["map", "check", "melee.scx", "hybrid.scm", "original.scm"]), "scmjs map check melee.scx hybrid.scm original.scm");
    },
  },
  {
    name: "cli-map-preview", needs: ["starcraft"],
    async run() {
      generate("(2)Jungle Duel.scx", ["--seed", "1207"]);
      await terminal("cli-map-preview", await shell(["map", "preview", "(2)Jungle Duel.scx"]), 'scmjs map preview "(2)Jungle Duel.scx"', { quality: 0.9 });
    },
  },
  {
    name: "cli-generated-map", needs: ["starcraft"],
    async run() {
      generate("(4)Crossing.scx", ["--players", "4", "--tileset", "desert", "--seed", "2026"]);
      scmjs(["map", "preview", "(4)Crossing.scx", "--out", "crossing.png", "--scale", "4"], { allowFail: false });
      await picture("cli-generated-map", "crossing.png");
    },
  },
  {
    name: "cli-map-diff", needs: ["starcraft"],
    async run() {
      generate("(2)Jungle Duel.scx", ["--seed", "1207"]);
      copyFileSync(join(WORK, "(2)Jungle Duel.scx"), join(WORK, "before.scx"));
      writeFileSync(join(WORK, "revise.mjs"), DIFF_EDIT);
      scmjs(["map", "run", "revise.mjs", "before.scx", "--out", "after.scx"], { allowFail: false });
      scmjs(["map", "diff", "before.scx", "after.scx", "--picture", "--out", "review.png", "--scale", "8"]);
      await picture("cli-map-diff", "review.png");
    },
  },
  {
    name: "cli-map-trace", needs: ["starcraft"],
    async run() { copyFileSync(join(MAPS, "ums.scx"), join(WORK, "ums.scx")); await terminal("cli-map-trace", stripFetch(await shell(["map", "trace", "ums.scx"])), "scmjs map trace ums.scx"); },
  },
  {
    name: "cli-map-test", needs: ["starcraft"],
    async run() {
      for (const f of ["ums.scx", "ums.tests.json"]) copyFileSync(join(MAPS, f), join(WORK, f));
      await terminal("cli-map-test", stripFetch(await shell(["map", "test", "ums.scx"])), "scmjs map test ums.scx");
    },
  },
  {
    name: "cli-bot-ladder", needs: ["starcraft", "bots"],
    async run() {
      await ladder();
      const text = readFileSync(join(WORK, "ladder.log"), "utf8");
      await terminal("cli-bot-ladder", stripFetch(text), 'scmjs bot ladder ualbertabot.scmbot:p example.scmbot:t computer:z --maps "(2)Jungle Duel.scx" "(4)Crossing.scx" --frames 20000 --parallel 6 --out ladder', { cols: LADDER_COLS });
    },
  },
  {
    name: "cli-replay-watch", needs: ["starcraft", "bots"],
    async run() {
      await ladder();
      const rep = "ladder/ualbertabot-vs-computer-z_jungle-duel_PvZ_seed1.rep";
      const text = await shell(["replay", "watch", rep, "--from", "3:30", "--speed", "1"], { rows: 42, ms: 6000, keys: "q" });
      await terminal("cli-replay-watch", text, `scmjs replay watch ${rep} --from 3:30 --speed 1`, { quality: 0.9 });
    },
  },
  {
    name: "cli-qr",
    async run() {
      // Not signed in here, so not `map share --qr` itself: the same encoder and drawing, through the built command's code.
      const link = "https://scmjs.dev/editor/map/sJ5Z3w12SFSoLCD6zej-b46a";
      const { createServer } = await import("vite");
      const vite = await createServer({ root, configFile: false, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
      try {
        process.env.FORCE_COLOR = "1";
        const { qrFor } = await vite.ssrLoadModule("/cli/src/qr.ts");
        await terminal("cli-qr", [link, ...qrFor(link, { ascii: false, color: true })].join("\n") + "\n", null);
      } finally { await vite.close(); }
    },
  },
];

function generate(file, argv) {
  if (!existsSync(join(WORK, file))) scmjs(["map", "generate", file, ...argv], { allowFail: false });
}
/** The engine's one-off "Fetching …" line says where the cache is on this computer; it is not part of the picture. */
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g");
const stripFetch = (text) => text.split("\n").filter((l) => !l.replace(SGR, "").startsWith("Fetching ")).join("\n");

/** The ladder's table and game lines are wide; its terminal is too. */
const LADDER_COLS = 132;
let laddered = false;
async function ladder() {
  if (laddered) return;
  generate("(2)Jungle Duel.scx", ["--seed", "1207"]);
  generate("(4)Crossing.scx", ["--players", "4", "--tileset", "desert", "--seed", "2026"]);
  for (const b of ["ualbertabot", "example"]) copyFileSync(join(BOTS, `${b}.scmbot`), join(WORK, `${b}.scmbot`));
  rmSync(join(WORK, "ladder"), { recursive: true, force: true });
  const text = await shell(["bot", "ladder", "ualbertabot.scmbot:p", "example.scmbot:t", "computer:z", "--maps", "(2)Jungle Duel.scx", "(4)Crossing.scx", "--frames", "20000", "--parallel", "6", "--out", "ladder"], { cols: LADDER_COLS });
  writeFileSync(join(WORK, "ladder.log"), text);
  laddered = true;
}

/* ── run ──────────────────────────────────────────────────────────────────────────── */

console.log(`Building scmjs …`);
const built = spawnSync(process.execPath, [join(root, "scripts/build-cli.mjs"), "--quiet"], { cwd: root, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });
console.log(`Working in ${WORK}`);

const check = { starcraft: null, bots: null };
const lacks = (needs = []) => needs.filter((n) => (check[n] ??= have[n]()) === false);

await openBrowser();
try {
  for (const shot of SHOTS) {
    if (ONLY.length && !ONLY.some((o) => shot.name === o || shot.name === `cli-${o}`)) continue;
    const missing = lacks(shot.needs);
    if (missing.length) { console.log(`  ${shot.name}: skipped, no ${missing.join(" or ")} (see the comment at the top)`); continue; }
    try { await shot.run(); } catch (e) { console.log(`  ${shot.name}: failed: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }
  }
} finally {
  await browser.close();
}
if (!opt("--work", "")) rmSync(WORK, { recursive: true, force: true });
else console.log(`Kept the maps, replays and logs in ${WORK}`);
