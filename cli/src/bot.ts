/**
 * `scmjs bot new | init | build | update`: a BWAPI bot of your own built into a `.scmbot` file for scmjs.dev/play.
 * The toolchain is the Docker image ghcr.io/scm-js/scmbot (github.com/scm-js/scmbot, where the guide is); this runs
 * it in the bot's folder, as the toolchain's own `scmbot` wrapper does.
 */
import { spawn, spawnSync } from "node:child_process";
import { basename } from "node:path";
import { CliError, mark, pc, print } from "./ui";

export const BOT_IMAGE = "ghcr.io/scm-js/scmbot";
export const BOT_GUIDE = "https://github.com/scm-js/scmbot";

/** Docker's version, or null when there is no Docker to run (not installed, or its engine not started). */
export function dockerVersion(): string | null {
  const r = spawnSync("docker", ["version", "--format", "{{.Server.Version}}"], { encoding: "utf8", timeout: 10_000 });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

/**
 * `docker run`'s arguments: the folder mounted at /bot, its name given for `new` (the toolchain sees only /bot), and
 * on Linux and macOS the files written as the person running this rather than as root.
 */
export function dockerArgs(o: { folder: string; args: string[]; image: string; tty: boolean; user: string | null }): string[] {
  return [
    "run", "--rm", ...(o.tty ? ["-it"] : ["-i"]),
    "-v", `${o.folder}:/bot`, "-e", `SCMBOT_FOLDER=${basename(o.folder)}`,
    ...(o.user ? ["-u", o.user] : []),
    o.image, ...o.args,
  ];
}

const hasImage = (image: string) => spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;

function needDocker(): void {
  if (dockerVersion()) return;
  const installed = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
  throw new CliError(
    installed ? "Docker is installed but not running" : "scmjs bot needs Docker",
    installed ? "Start Docker (Docker Desktop on Windows and macOS), then run this again." : "Install it from https://docs.docker.com/get-docker/, then run this again.",
  );
}

/** Runs the toolchain with `args` in this folder; the toolchain's own output and exit code are the command's. */
export async function runBot(args: string[], image = process.env.SCMBOT_IMAGE || BOT_IMAGE): Promise<void> {
  needDocker();
  if (!hasImage(image)) print(pc.dim(`Downloading the bot toolchain (${image}), once. It is a few GB.`));
  const user = process.platform === "win32" || !process.getuid ? null : `${process.getuid()}:${process.getgid?.()}`;
  const child = spawn("docker", dockerArgs({ folder: process.cwd(), args, image, tty: !!process.stdout.isTTY && !!process.stdin.isTTY, user }), { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => { child.on("error", () => resolve(1)); child.on("close", (c) => resolve(c ?? 1)); });
  if (code) process.exitCode = code;
}

/** `scmjs bot update`: the newest toolchain, the one the play page expects. */
export async function updateBot(image = process.env.SCMBOT_IMAGE || BOT_IMAGE): Promise<void> {
  needDocker();
  print(pc.dim(`Fetching ${image}…`));
  const child = spawn("docker", ["pull", image], { stdio: "inherit" });
  const code = await new Promise<number>((resolve) => { child.on("error", () => resolve(1)); child.on("close", (c) => resolve(c ?? 1)); });
  if (code) throw new CliError("The toolchain could not be fetched", `docker pull ${image} said why, above.`);
  print(`${mark.ok} The bot toolchain is up to date`);
}
