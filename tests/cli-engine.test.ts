/**
 * The engine's cache (cli/src/engine.ts): the fetch is said on standard error whatever the command, and runners the
 * play page no longer names are removed once newer ones are fetched, the engine's own files kept.
 */
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ensureEngine } from "../cli/src/engine";
import { stagedEngine } from "./support/mapRunner";

const made: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "scmjs-engine-test-")); made.push(d); return d; };
const servers: ReturnType<typeof createServer>[] = [];
afterAll(() => { for (const s of servers) s.close(); for (const d of made) rmSync(d, { recursive: true, force: true }); });

async function serve(dir: string): Promise<string> {
  const server = createServer((req, res) => {
    const path = join(dir, decodeURIComponent((req.url ?? "/").replace(/^\/play\/engine\//, "")));
    if (!existsSync(path)) { res.statusCode = 404; res.end(); return; }
    res.end(readFileSync(path));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}/play`;
}

describe("scmjs: the engine's cache", () => {
  it("says a fetch on standard error, never standard output, and removes the runners no longer named", async () => {
    const staged = stagedEngine(tmp());
    const url = await serve(staged.dir);
    const cache = tmp();
    const out = vi.spyOn(process.stdout, "write");
    const err = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await ensureEngine(url, cache, (l) => process.stdout.write(l));
      expect(out).not.toHaveBeenCalled();
      expect(String(err.mock.calls[0]?.[0])).toMatch(/Fetching the game engine .*about 25 MB to download/);
    } finally { out.mockRestore(); err.mockRestore(); }
    const build = join(cache, "engine", staged.build);
    // A deploy with a newer map runner: the old one goes once the new one is here; the rest stays.
    writeFileSync(join(build, "replay-0dd0dd.mjs"), "// an old replay runner\n");
    writeFileSync(join(staged.dir, staged.build, "map-beef0001.cjs"), "// the new map runner\n");
    const current = JSON.parse(readFileSync(join(staged.dir, "current.json"), "utf8"));
    writeFileSync(join(staged.dir, "current.json"), JSON.stringify({ ...current, mapRunner: "map-beef0001.cjs" }));
    const quiet = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try { await ensureEngine(url, cache); } finally { quiet.mockRestore(); }
    expect(readdirSync(build).sort()).toEqual(["base-s1.bin", "core.js", "game.js", "interface.bin", "map-beef0001.cjs", "run-feedface.cjs"]);
  });
});
