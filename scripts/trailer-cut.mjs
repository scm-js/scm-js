/**
 * The trailer's cut (`trailer/script.md`), put together from the recorded shots.
 *
 * Takes the shots `scripts/trailer.mjs` recorded (trailer/build/shots/), in the order of the
 * edit list below, and joins them with a fade up from black at the start and down to black
 * at the end. Each shot's line is laid over it in the lower third, fading in and out. A shot
 * not recorded yet stands in as a short card with its name, so the cut shows the pacing of
 * the whole thing. The lines and the cards are drawn by the browser, in the same page
 * styles, and written as PNGs.
 *
 *   npm i --no-save playwright               # as for scripts/trailer.mjs
 *   node scripts/trailer-cut.mjs [--browser <chrome>]
 *
 * Writes trailer/build/cut/trailer-1080p.mp4 and a 720p copy beside it. Runs the ffmpeg
 * named in FFMPEG (and the ffprobe next to it) from trailer/build/ with relative paths, so a
 * Windows ffmpeg.exe works under WSL. No music yet: the cut is silent.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const at = args.indexOf(name); return at === -1 ? fallback : args[at + 1]; };
const BROWSER = opt("--browser", process.env.SCMJS_BROWSER ?? "");
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const BUILD = join(root, "trailer/build");
const OUT = join(BUILD, "cut");
const FPS = 30;

/** The edit, in order. A shot is one recorded file or a montage's cuts; `text` is its line. */
const EDIT = [
  { shot: "01", fadeIn: 1.2 },
  { shot: "02" },
  { shot: "03" },
  { shot: "04", text: "Edit your maps with your friends." },
  { shot: "05", text: "Use powerful features." },
  { shot: "06", text: "See the ground as your units will walk it." },
  { shot: "07", text: "Write your triggers in TypeScript." },
  { shot: "08", text: "Use the AI assistant." },
  { shot: "09", text: "Write your own plugins." },
  { shot: "10", text: "Open any map." },
  { shot: "11", fadeOut: 1.2 },
];
/** When a line shows: this long after its shot starts, for at most this long, fading this long each way. */
const TEXT = { after: 0.8, hold: 4.5, fade: 0.45 };
/** How long a card stands in for a shot not recorded yet. */
const CARD = 2.5;

let chromium;
try { ({ chromium } = await import("playwright")); } catch {
  console.error("playwright is not installed. Run: npm i --no-save playwright");
  process.exit(1);
}

const run = (cmd, argv) => {
  const res = spawnSync(cmd, argv, { cwd: BUILD, encoding: "utf8", maxBuffer: 1 << 26 });
  if (res.status !== 0) throw new Error(`${cmd} failed: ${res.stderr?.slice(-2000)}`);
  return res.stdout;
};
const duration = (rel) => Number(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", rel]).trim());

/** The recorded files of a shot, in order: shot-05.mp4, or a montage's shot-06a.mp4, shot-06b.mp4, … */
function filesOf(shot) {
  const one = `shots/shot-${shot}.mp4`;
  if (existsSync(join(BUILD, one))) return [one];
  const cuts = [];
  for (const c of "abcdefghij") {
    const f = `shots/shot-${shot}${c}.mp4`;
    if (!existsSync(join(BUILD, f))) break;
    cuts.push(f);
  }
  return cuts;
}

const PAGE_CSS = `
  @import url("https://fonts.googleapis.com/css2?family=Marcellus&family=IBM+Plex+Sans:wght@500;600&display=swap");
  html, body { margin: 0; width: 1920px; height: 1080px; background: transparent; }
  .line { position: absolute; left: 132px; bottom: 150px; max-width: 1300px; font: 400 60px/1.2 "Marcellus", Georgia, serif;
    color: #f6f3fb; letter-spacing: .01em; text-shadow: 0 2px 4px rgba(0,0,0,.9), 0 0 28px rgba(0,0,0,.75); }
  .line::before { content: ""; display: block; width: 64px; height: 3px; margin-bottom: 22px; background: #ff5fa2;
    box-shadow: 0 0 12px rgba(255, 95, 162, .6); }
  .card { width: 1920px; height: 1080px; background: #07050d; display: grid; place-content: center; justify-items: center; gap: 18px; }
  .card h2 { margin: 0; font: 400 72px/1.1 "Marcellus", Georgia, serif; color: #f6f3fb; }
  .card p { margin: 0; font: 600 22px/1 "IBM Plex Sans", system-ui, sans-serif; letter-spacing: .3em; text-transform: uppercase; color: #c9b3ff; }
`;

async function renderImages(texts, cards) {
  const browser = await chromium.launch({ ...(BROWSER ? { executablePath: BROWSER } : {}), args: ["--no-sandbox"] });
  try {
    const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
    const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    for (const { file, text } of texts) {
      await page.setContent(`<style>${PAGE_CSS}</style><div class="line">${esc(text)}</div>`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(OUT, file), omitBackground: true });
    }
    for (const { file, name } of cards) {
      await page.setContent(`<style>${PAGE_CSS}</style><div class="card"><h2>${esc(name)}</h2><p>Not recorded yet</p></div>`, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: join(OUT, file) });
    }
  } finally {
    await browser.close();
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  // The timeline: every input in order, with where each shot starts.
  const inputs = []; // { args, seconds }
  const texts = [], cards = [], lines = [];
  let t = 0, fadeIn = 0, fadeOut = 0;
  for (const [i, part] of EDIT.entries()) {
    const files = filesOf(part.shot);
    const start = t;
    if (files.length) {
      for (const f of files) { const d = duration(f); inputs.push({ args: ["-i", f], seconds: d }); t += d; }
    } else {
      const file = `card-${part.shot}.png`;
      cards.push({ file, name: part.name ?? `Shot ${part.shot}` });
      inputs.push({ args: ["-loop", "1", "-framerate", String(FPS), "-t", String(CARD), "-i", `cut/${file}`], seconds: CARD });
      t += CARD;
    }
    if (part.fadeIn) fadeIn = part.fadeIn;
    if (part.fadeOut) fadeOut = part.fadeOut;
    if (part.text && files.length) {
      const file = `line-${i}.png`;
      texts.push({ file, text: part.text });
      const from = start + TEXT.after;
      lines.push({ file, from, to: Math.min(from + TEXT.hold, t - 0.4) });
    }
    console.log(`${part.shot}: ${start.toFixed(1)}–${t.toFixed(1)} s${files.length ? "" : " (card)"}${part.text ? ` · "${part.text}"` : ""}`);
  }
  const total = t;
  await renderImages(texts, cards);

  // One graph: every piece brought to the same size and rate, joined, faded at both ends,
  // and each line laid over with its own fade.
  const argv = ["-hide_banner", "-loglevel", "error", "-y"];
  for (const inp of inputs) argv.push(...inp.args);
  for (const l of lines) argv.push("-loop", "1", "-framerate", String(FPS), "-t", total.toFixed(2), "-i", `cut/${l.file}`);
  const f = [];
  inputs.forEach((_, k) => f.push(`[${k}:v]fps=${FPS},scale=1920:1080,setsar=1,format=yuv420p[v${k}]`));
  f.push(`${inputs.map((_, k) => `[v${k}]`).join("")}concat=n=${inputs.length}:v=1:a=0[joined]`);
  f.push(`[joined]fade=t=in:st=0:d=${fadeIn || 0.01},fade=t=out:st=${(total - (fadeOut || 0.01)).toFixed(2)}:d=${fadeOut || 0.01}[base0]`);
  lines.forEach((l, j) => {
    const k = inputs.length + j;
    f.push(`[${k}:v]format=rgba,fade=t=in:st=${l.from.toFixed(2)}:d=${TEXT.fade}:alpha=1,fade=t=out:st=${(l.to - TEXT.fade).toFixed(2)}:d=${TEXT.fade}:alpha=1[t${j}]`);
    f.push(`[base${j}][t${j}]overlay=0:0:format=auto:shortest=1[base${j + 1}]`);
  });
  f.push(`[base${lines.length}]format=yuv420p[out]`);
  run(FFMPEG, [...argv, "-filter_complex", f.join(";"), "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", "20",
    "-movflags", "+faststart", "cut/trailer-1080p.mp4"]);
  run(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-i", "cut/trailer-1080p.mp4", "-vf", "scale=1280:720:flags=lanczos",
    "-c:v", "libx264", "-preset", "slow", "-crf", "28", "-movflags", "+faststart", "cut/trailer-720p.mp4"]);
  console.log(`wrote trailer/build/cut/trailer-1080p.mp4 and trailer-720p.mp4 (${Math.floor(total / 60)}:${(total % 60).toFixed(1).padStart(4, "0")})`);
}

await main();
