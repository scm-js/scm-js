/**
 * `scmjs map unpack|pack` (cli/src/archive.ts over `readArchive`/`writeArchiveBytes`): a map file as a folder and
 * back, byte for byte where it matters. Maps come from tests/maps and from archives made here; folders are temporary.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes, readArchive, writeArchiveBytes } from "../src/editor/mapFile";
import { createScenario } from "../src/formats/chk/create";
import { serializeScenario } from "../src/formats/chk/scenario";
import { loadMap, saveMap } from "../src/formats/mpq/scm";
import { applySounds, wavMemberName } from "../src/editor/sounds";
import { internString } from "../src/editor/settings";
import { fileFor, listMembers, MANIFEST_FILE, memberFor, packMap, unpackMap, type ArchiveManifest } from "../cli/src/archive";
import { diffMaps } from "../cli/src/diff";
import { CliError } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-archive-"));
const ums = () => new Uint8Array(readFileSync(testMap("ums.scx")));
const manifestOf = (dir: string) => JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")) as ArchiveManifest;

describe("scmjs map unpack / pack", () => {
  it("names a file for a member and a member for a file", () => {
    expect(fileFor("staredit\\scenario.chk")).toBe("staredit/scenario.chk");
    expect(fileFor("staredit\\wav\\a: b?.wav")).toBe("staredit/wav/a%3A b%3F.wav");
    expect(fileFor("..\\x")).toBe("%2E%2E/x");
    expect(memberFor("staredit/wav/a%3A b%3F.wav")).toBe("staredit\\wav\\a: b?.wav");
    expect(memberFor(fileFor("odd%name\\f.bin"))).toBe("odd%name\\f.bin");
  });

  it("lists the members, the scenario first", async () => {
    const r = await listMembers(ums());
    expect(r.members[0]).toMatchObject({ name: "staredit\\scenario.chk", kind: "scenario" });
    expect(r.members.length).toBeGreaterThanOrEqual(2);
    expect(r.members.slice(1).every((m) => m.kind === "member" && m.bytes > 0)).toBe(true);
    expect(r.listfile).toBe(true);
  });

  it("unpacks a map into a folder and packs it back to the same map", async () => {
    const dir = join(tmp(), "ums");
    const u = await unpackMap(ums(), "ums.scx", dir);
    expect(u.files).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(dir, "staredit", "scenario.chk"))).toBe(true);
    const manifest = manifestOf(dir);
    expect(manifest).toMatchObject({ version: 1, fileName: "ums.scx", listfile: true, stored: null });
    expect(manifest.scenario.compression).toBe((await readArchive(ums())).origin!.compression);
    expect(manifest.members.map((m) => m.name)).toEqual([...(await readArchive(ums())).extras.keys()]);
    // The scenario's bytes are the archive's, untouched.
    expect(new Uint8Array(readFileSync(join(dir, "staredit", "scenario.chk")))).toEqual((await readArchive(ums())).chk);

    const p = await packMap(dir);
    expect(p.path).toBe(join(dir, "..", "ums.scx").replace(/\/ums\/\.\.\//, "/"));
    expect(p.added).toEqual([]);
    expect(p.members).toBe(manifest.members.length);
    const back = new Uint8Array(readFileSync(p.path));
    const [a, b] = [await readArchive(ums()), await readArchive(back)];
    expect(b.chk).toEqual(a.chk);
    expect([...b.extras.entries()].sort()).toEqual([...a.extras.entries()].sort());
    expect(b.origin).toMatchObject({ compression: a.origin!.compression, encrypted: a.origin!.encrypted });
    expect(diffMaps({ name: "a", doc: await openMapBytes(ums(), "a") }, { name: "b", doc: await openMapBytes(back, "b") }).same).toBe(true);
  });

  it("takes a file added to the folder in as a member, and --out and --compression", async () => {
    const dir = join(tmp(), "ums");
    await unpackMap(ums(), "ums.scx", dir);
    mkdirSync(join(dir, "trigscript"));
    writeFileSync(join(dir, "trigscript", "main.ts"), "// a script dropped in\n");
    const out = join(tmp(), "with-script.scx");
    const p = await packMap(dir, { out, compression: "zlib" });
    expect(p.added).toEqual(["trigscript\\main.ts"]);
    expect(p.compression).toBe("zlib");
    const back = await readArchive(new Uint8Array(readFileSync(out)));
    expect(new TextDecoder().decode(back.extras.get("trigscript\\main.ts"))).toBe("// a script dropped in\n");
    expect(back.origin?.compression).toBe("zlib");
  });

  it("keeps a protected map's nameless members and its missing file list", async () => {
    const WAV = wavMemberName("probe.wav");
    const scn = createScenario({ width: 32, height: 32, era: 0 });
    const wavs = scn.wavs!.slice();
    wavs[0] = internString(scn, WAV);
    applySounds(scn, wavs);
    const sound = new Uint8Array(3000).map((_, i) => (i * 7) & 0xff);
    const secret = new Uint8Array([9, 8, 7, 6, 5]);
    const bytes = await saveMap(serializeScenario(scn), { extras: new Map([[WAV, sound], ["unknown\\member.bin", secret]]), listfile: false, compress: "pkware", encrypt: true });

    const dir = join(tmp(), "protected");
    const u = await unpackMap(bytes, "protected.scx", dir);
    expect(u.stored).toBe(1);
    const manifest = manifestOf(dir);
    expect(manifest.listfile).toBe(false);
    expect(manifest.scenario).toMatchObject({ compression: "pkware", encrypted: true });
    expect(manifest.members.map((m) => m.name)).toEqual([WAV]);
    expect(manifest.stored?.members[0].file).toBe("stored/001.bin");
    expect(readdirSync(join(dir, "stored"))).toEqual(["001.bin"]);

    const p = await packMap(dir, { out: join(dir, "..", "packed.scx") });
    expect(p.stored).toBe(1);
    expect(p.encrypted).toBe(true);
    const back = await loadMap(new Uint8Array(readFileSync(p.path)));
    expect(back.files).toBeNull();
    const again = await readArchive(new Uint8Array(readFileSync(p.path)));
    expect(again.extras.get(WAV)).toEqual(sound);
    expect(again.stored?.members).toHaveLength(1);
    expect(again.stored?.members[0].data).toEqual((await readArchive(bytes)).stored!.members[0].data);
  });

  it("round-trips a built map as it is, with the build's members", async () => {
    // A map "built" by a step: the editor's own packer is what makes one; here the shape is enough (source beside a changed scenario).
    const built = await writeArchiveBytes((await readArchive(ums())).chk, { extras: new Map([["scmjs\\source.chk", new Uint8Array([1, 2, 3])], ["scmjs\\build.json", new TextEncoder().encode("{}")]]), compression: "pkware" });
    const dir = join(tmp(), "built");
    const u = await unpackMap(built, "built.scx", dir);
    expect(u.manifest.members.map((m) => m.name).sort()).toEqual(["scmjs\\build.json", "scmjs\\source.chk"]);
    const p = await packMap(dir);
    const back = await readArchive(new Uint8Array(readFileSync(p.path)));
    expect(back.extras.get("scmjs\\source.chk")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses a folder with no scenario, a bad manifest, and a .chk with members", async () => {
    const empty = tmp();
    await expect(packMap(empty)).rejects.toThrow(/has no staredit\/scenario\.chk/);
    await expect(packMap(join(empty, "nowhere"))).rejects.toThrow(CliError);
    const dir = join(tmp(), "ums");
    await unpackMap(ums(), "ums.scx", dir);
    await expect(packMap(dir, { out: join(tmp(), "x.chk") })).rejects.toThrow(/bare \.chk/);
    writeFileSync(join(dir, MANIFEST_FILE), "{ not json");
    await expect(packMap(dir)).rejects.toThrow(/could not be read/);
  });
});
