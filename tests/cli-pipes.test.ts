/**
 * `-` as a map's path: standard input to read, standard output to write, so the commands chain in a pipe. The
 * readers and writers take their streams here; the built command was run by hand through a four-step pipe.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { outputFormat, writeBack, writeOutput } from "../cli/src/exchange";
import { setHeader } from "../cli/src/edit";
import { loadMapInput, readInput, STDIO, toStdout } from "../cli/src/files";
import { CliError } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import { scenarioName, serializeScenario } from "../src/formats/chk/scenario";
import { TEST_MAPS_DIR } from "./support/maps";

const bytesOf = (name: string) => new Uint8Array(readFileSync(join(TEST_MAPS_DIR, name)));
const stream = (bytes: Uint8Array) => Readable.from([bytes.subarray(0, 100), bytes.subarray(100)]);

/** Everything written to a stream, once it ends. */
async function collect(write: (out: PassThrough) => Promise<unknown>): Promise<Uint8Array> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  await write(out);
  out.end();
  await new Promise((r) => out.on("end", r));
  return new Uint8Array(Buffer.concat(chunks));
}

describe("scmjs: `-` for standard input and output", () => {
  it("reads a map from a pipe and names it by its bytes", async () => {
    const scx = await readInput(STDIO, stream(bytesOf("ums.scx")));
    expect([scx.path, scx.name, scx.kind]).toEqual([STDIO, "stdin.scx", "map"]);
    expect(scx.bytes).toEqual(bytesOf("ums.scx"));
    const doc = await loadMapInput(scx);
    expect(scenarioName(doc.scenario)).toBe("Test Scenario");
    // A bare scenario has no magic, only a section name first.
    const opened = await openMapBytes(bytesOf("melee.scx"), "melee.scx");
    const chk = await readInput(STDIO, stream(serializeScenario(opened.scenario)));
    expect([chk.name, chk.kind]).toEqual(["stdin.chk", "map"]);
    expect(outputFormat(await loadMapInput(chk), STDIO, null)).toBe("chk");
    const text = await readInput(STDIO, Readable.from([Buffer.from("hello there, not a map")]));
    expect(text.kind).toBeNull();
  });

  it("refuses an empty pipe with a hint", async () => {
    await expect(readInput(STDIO, Readable.from([]))).rejects.toMatchObject({ exitCode: 2, message: "Nothing came on standard input" } satisfies Partial<CliError>);
  });

  it("writes to standard output for `-`, or when the map came from it and there is no --out", async () => {
    expect(toStdout(STDIO, null)).toBe(true);
    expect(toStdout(STDIO, "a.scx")).toBe(false);
    expect(toStdout("a.scx", STDIO)).toBe(true);
    expect(toStdout("a.scx", null)).toBe(false);
    const input = await readInput(STDIO, stream(bytesOf("ums.scx")));
    const doc = await loadMapInput(input);
    setHeader(doc, { name: "Piped" });
    let written: { path: string; bytes: number } | undefined;
    const bytes = await collect(async (out) => { written = await writeBack(doc, input.path, null, out); });
    expect(written).toEqual({ path: STDIO, bytes: bytes.length });
    const again = await openMapBytes(bytes, "stdin.scx");
    expect(scenarioName(again.scenario)).toBe("Piped");
    // As it came: an archive, compressed and encrypted as the test map is.
    expect(again.origin?.compression).toBe(doc.origin?.compression);
    expect(again.origin?.encrypted).toBe(doc.origin?.encrypted);
    expect([...again.extras.keys()]).toEqual([...doc.extras.keys()]);
  });

  it("writeOutput takes a stream for `-` and a path for a file", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(await collect((out) => writeOutput(bytes, STDIO, out))).toEqual(bytes);
    // A missing folder is made; a path through a file is said, exit 2.
    const dir = mkdtempSync(join(tmpdir(), "scmjs-pipes-"));
    await writeOutput(bytes, join(dir, "new-folder", "x.scx"));
    expect(readFileSync(join(dir, "new-folder", "x.scx"))).toEqual(Buffer.from(bytes));
    const e = await writeOutput(bytes, join(TEST_MAPS_DIR, "ums.scx", "x.scx")).catch((x: unknown) => x as CliError);
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).message).toMatch(/a part of the path is a file/);
    expect((e as CliError).exitCode).toBe(2);
  });
});
