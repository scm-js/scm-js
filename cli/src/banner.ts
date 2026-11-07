/**
 * The overview's banner (`scmjs`, `scmjs --help`, `scmjs help`): the app mark beside the name, the version and what
 * the command is for, then the commands in their groups and the options on one line. A command's own help stays
 * commander's.
 */
import type { Command, Help } from "commander";
import { pc, rgb, truecolor, unicode, visible } from "./ui";

/**
 * The app mark, the wireframe globe of `public/favicon.svg` and the splash screen, in braille (2 × 4 dots a
 * character): the splash's sphere (`src/components/splash/starfield.ts`) with 6 rings and 8 segments, turned 0.3 rad
 * about y and −0.45 about x, its near half and its outline, on 32 × 32 dots.
 */
export const GLOBE = [
  "   ⣠⡴⢶⡿⣿⢿⢿⣲⢦⣄   ",
  " ⣠⠞⣡⠟⠯⢤⡧⠬⢷⡴⠛⠮⡳⣄ ",
  "⢰⢳⡼⠁  ⡞   ⢣  ⣘⣾⡆",
  "⡇⡼⠉⠙⠒⢦⠧⠤⠤⠤⠼⡖⠋⠁⠘⣾",
  "⡷⣇   ⢸     ⢧  ⣠⣿",
  "⠸⣏⠙⠒⠦⢼⠤⠤⠤⠤⠤⢼⠒⠋⢡⠇",
  " ⠙⢦⣀⡀⢸     ⣞⣀⡴⠋ ",
  "   ⠙⠻⠭⣯⣓⣒⣫⠽⠟⠋   ",
];

/** The same globe in ASCII, for a console without braille (the old Windows one, where ui.ts's marks fall back too). */
export const GLOBE_ASCII = [
  "     .-'''-.     ",
  "   .'/  |  \\'.   ",
  "  /-+---+---+-\\  ",
  " |  |   |   |  | ",
  " |==+===+===+==| ",
  "  \\-+---+---+-/  ",
  "   '.\\  |  /.'   ",
  "     '-...-'     ",
];

/** The logo's violet (#a06cf0), or the terminal's magenta without 24-bit colour. */
const violet = (s: string) => (truecolor ? rgb("#a06cf0", s) : pc.magenta(s));

/**
 * `text` beside the globe, centred on its height; the text alone when the terminal is narrower than both. `width` is
 * the terminal's (80 when it is not one).
 */
export function banner(text: string[], { width = 80, ascii = !unicode } = {}): string[] {
  const art = ascii ? GLOBE_ASCII : GLOBE;
  const artWidth = Math.max(...art.map((l) => l.length));
  const indent = "  ", gap = "   ";
  if (indent.length + artWidth + gap.length + Math.max(...text.map((l) => visible(l).length)) > width) return text;
  const top = Math.max(0, Math.floor((art.length - text.length) / 2));
  return art.map((l, i) => (text[i - top] ? `${indent}${violet(l.padEnd(artWidth))}${gap}${text[i - top]}` : `${indent}${violet(l.trimEnd())}`));
}

/** The overview, in place of commander's: the banner, the command groups as commander lays them out, the options. */
export function rootHelp(cmd: Command, helper: Help, version: string, opts: { ascii?: boolean } = {}): string {
  const termWidth = helper.padWidth(cmd, helper);
  const out = banner([
    `${pc.bold(pc.cyan(cmd.name()))} ${pc.bold(version)}`,
    "scmJS on the command line",
    pc.dim("StarCraft: Brood War maps, replays, plugins and bots"),
    "",
    `${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`,
    `${helper.styleTitle("Docs:")}  ${pc.cyan("https://docs.scmjs.dev")}`,
  ], { width: helper.helpWidth ?? 80, ...opts });
  // No blank line here: the globe's own bottom row, below the text, keeps the groups off the title, and the overview
  // is held to 23 lines (a 24-row terminal keeps the globe on screen).
  // The groups follow one another with no blank line between (each row is a command the 23 lines have room for
  // only then); the one blank line is before Options.
  const groups = helper.groupItems([...cmd.commands], helper.visibleCommands(cmd), (sub) => sub.helpGroup() || "Commands:");
  for (const [heading, commands] of groups) {
    const list = helper.formatItemList(heading, commands.map((sub) =>
      helper.formatItem(helper.styleSubcommandTerm(helper.subcommandTerm(sub)), termWidth, helper.styleSubcommandDescription(helper.subcommandDescription(sub)), helper)), helper);
    out.push(...list.filter((l) => l !== ""));
  }
  out.push("");
  out.push(`${helper.styleTitle("Options:")} ${helper.visibleOptions(cmd).map((o) => helper.styleOptionTerm(helper.optionTerm(o))).join("   ")}`, "");
  return out.join("\n");
}
