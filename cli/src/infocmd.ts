/** `scmjs info`: what a map, replay or bot file holds, read by the same functions as `map info` and `replay info`. */
import { Command } from "commander";
import { hasScript } from "./build";
import { plainText } from "../../src/editor/textColors";
import { expectKind, loadMapInput, loadReplayInput, type Input } from "./files";
import { mapReport, printMapInfo, type MapReport } from "./map";
import { printReplayInfo, replayReport } from "./replay";
import { buildOrders, replayNamer, type ReplayNameOptions } from "./replaymod";
import { t } from "./i18n";
import { dot, mark, pc, rows, size } from "./ui";
import { eachFile } from "./cmdkit";
import { jsonOption } from "./options";

export async function mapInfo(input: Input) {
  expectKind(input, "map");
  const doc = await loadMapInput(input);
  const data: MapReport = { ...mapReport(input, doc), script: await hasScript(doc.extras) };
  // JSON: the name as text (colour codes and line breaks out, as the text shows it), the bytes as the map holds them
  // under rawName.
  return { data: { ...data, name: plainText(data.name).replace(/\s+/g, " ").trim(), rawName: data.name }, lines: printMapInfo(data) };
}
export async function replayInfo(input: Input, o: ReplayNameOptions = {}) {
  expectKind(input, "replay");
  const rep = await loadReplayInput(input);
  const names = o.mod || o.builds ? await replayNamer(rep, input.name, { mod: o.mod, starcraft: o.starcraft, costs: !!o.builds, warn: (line) => process.stderr.write(`${mark.warn} ${line}\n`) }) : null;
  // (A race the replay's tag does not name, the mod named with --mod may declare.)
  const races = names?.races ?? [];
  const data = replayReport(input, rep, races);
  if (names) {
    data.names = names.from;
    if (o.builds) data.builds = buildOrders(rep, names);
  }
  return { data, lines: printReplayInfo(data, races) };
}
/** A bot file's header (the scm-sim toolchain's `.scmbot`). */
async function botInfo(input: Input) {
  const n = new DataView(input.bytes.buffer, input.bytes.byteOffset).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(input.bytes.subarray(12, 12 + n))) as Record<string, unknown>;
  const data = { file: { name: input.name, bytes: input.bytes.length }, key: h.key, name: h.name, source: h.source, commit: h.commit, memoryMB: Number(h.memoryPages) / 16, toolchain: h.toolchain, license: String(h.license ?? "").split("\n").find((l) => l.trim())?.trim() ?? "" };
  return { data, lines: [
    pc.bold(String(data.name)), pc.dim(t("A BWAPI bot for the play page")), "",
    ...rows([[t("Key"), String(data.key)], [t("Source"), data.source ? `${data.source}${data.commit ? pc.dim(` @ ${String(data.commit).slice(0, 7)}`) : ""}` : null], [t("Licence"), data.license || null], [t("Memory"), `${data.memoryMB} MB`], [t("Built by"), String(data.toolchain)], [t("File"), `${input.name}${dot}${size(input.bytes.length)}`]]),
  ] };
}

export function addInfoCommand(program: Command): void {
  const json = jsonOption();
  program.command("info").description(t("what a map, replay or bot file holds")).helpGroup(t("Maps and replays:")).argument("<files...>", t("maps (.scm .scx .chk), replays (.rep) or bots (.scmbot)")).addOption(json)
    .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, async (input) => {
      const kind = expectKind(input, "map", "replay", "bot");
      return kind === "map" ? mapInfo(input) : kind === "replay" ? replayInfo(input) : botInfo(input);
    }));
}
