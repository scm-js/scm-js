/**
 * `scmjs bot new | init | build | update`: a BWAPI bot of your own built into a `.scmbot` file for scmjs.dev/play.
 * The toolchain is the Docker image ghcr.io/scm-js/scmbot (github.com/scm-js/scmbot, where the guide is); this runs
 * it in the bot's folder, as the toolchain's own `scmbot` wrapper does.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { t } from "./i18n";
import { CliError, mark, pc, print } from "./ui";

export const BOT_IMAGE = "ghcr.io/scm-js/scmbot";
export const BOT_GUIDE = "https://github.com/scm-js/scmbot";

/** Docker's version, or null when there is no Docker to run (not installed, or its engine not started). */
export function dockerVersion(): string | null {
  const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * `docker run`'s arguments: the folder mounted at /bot, its name given for `new` (the toolchain sees only /bot), this
 * command's name for the toolchain's messages, and on Linux and macOS the files written as the person running this
 * rather than as root.
 */
export function dockerArgs(o: { folder: string; args: string[]; image: string; tty: boolean; user: string | null }): string[] {
  return [
    "run", "--rm", ...(o.tty ? ["-it"] : ["-i"]),
    "-v", `${o.folder}:/bot`, "-e", `SCMBOT_FOLDER=${basename(o.folder)}`, "-e", "SCMBOT_COMMAND=scmjs bot",
    ...(o.user ? ["-u", o.user] : []),
    o.image, ...o.args,
  ];
}

const hasImage = (image: string) => spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;

function needDocker(): void {
  if (dockerVersion()) return;
  const installed = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
  throw new CliError(
    installed ? t("Docker is installed but not running") : t("scmjs bot needs Docker"),
    installed ? t("Start Docker (Docker Desktop on Windows and macOS), then run this again.") : t("Install it from {url}, then run this again.", { url: "https://docs.docker.com/get-docker/" }),
    2,
  );
}

/**
 * Before a build, what the toolchain would refuse after starting Docker: scmbot.json's licence file missing (`bot new`
 * names `LICENSE` and writes none — the licence is the author's to choose). Said here with what to do, exit 2.
 */
export function checkBotFolder(dir = process.cwd()): void {
  const file = join(dir, "scmbot.json");
  if (!existsSync(file)) return;
  let license: unknown;
  try { license = (JSON.parse(readFileSync(file, "utf8")) as { license?: unknown }).license; } catch { return; }
  if (typeof license === "string" && license && !existsSync(join(dir, license))) {
    throw new CliError(t("scmbot.json names {file} as the bot's licence, and there is no {file} here.", { file: license }), t("Add the licence your bot is under as {file} (any licence you choose: it goes with every build), or name another file in scmbot.json's \"license\".", { file: license }), 2);
  }
}

/** Runs the toolchain with `args` in this folder; the toolchain's own output and exit code are the command's. */
export async function runBot(args: string[], image = process.env.SCMBOT_IMAGE || BOT_IMAGE): Promise<void> {
  if (args[0] === "build") checkBotFolder();
  needDocker();
  if (!hasImage(image)) print(pc.dim(t("Downloading the bot toolchain ({image}), once. It is a few GB.", { image })));
  const user = process.platform === "win32" || !process.getuid ? null : `${process.getuid()}:${process.getgid?.()}`;
  const child = spawn("docker", dockerArgs({ folder: process.cwd(), args, image, tty: !!process.stdout.isTTY && !!process.stdin.isTTY, user }), { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => { child.on("error", () => resolve(125)); child.on("close", (c) => resolve(c ?? 1)); });
  // (125 to 127 are Docker's own: the toolchain never started — the image could not be fetched, or run. That is a
  // command that could not start its work, 2; the toolchain's own failures keep its code.)
  if (code >= 125 && code <= 127) throw new CliError(t("The bot toolchain could not be started ({image})", { image }), t("Docker said why, above. scmjs bot update fetches the toolchain again."), 2);
  if (code) process.exitCode = code;
}

/** `scmjs bot update`: the newest toolchain, the one the play page expects. */
export async function updateBot(image = process.env.SCMBOT_IMAGE || BOT_IMAGE): Promise<void> {
  needDocker();
  print(pc.dim(t("Fetching {image}…", { image })));
  const child = spawn("docker", ["pull", image], { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => { child.on("error", () => resolve(1)); child.on("close", (c) => resolve(c ?? 1)); });
  if (code) throw new CliError(t("The toolchain could not be fetched"), t("docker pull {image} said why, above.", { image }));
  print(`${mark.ok} ${t("The bot toolchain is up to date")}`);
}
