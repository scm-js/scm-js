import { afterEach, describe, expect, it, vi } from "vitest";
import { resetAssetSource, setAssetSource, type AssetSource } from "../src/gamedata/source";
import { loadTilesetGraphics } from "../src/formats/tileset/load";

/** The smallest set of files the decoder takes: one CV5 group, one VF4/VX4 megatile, one VR4 minitile, a palette. */
const FILES: Record<string, number> = { cv5: 52, vf4: 32, vx4: 32, vr4: 64, wpe: 1024 };

describe("fetching a tileset", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetAssetSource(); });

  it("does not take the dev server's page for a missing Remastered file, even when its size would pass", async () => {
    setAssetSource({ kind: "bundled", base: "/", label: "test", tried: [] } as unknown as AssetSource);
    const asked: string[] = [];
    // 8,704 bytes is 136 VX4EX records: the size check alone took the page, and every tile drew black.
    const page = new Uint8Array(8704).fill(0x3c);
    vi.stubGlobal("fetch", async (url: string) => {
      const name = String(url).split("/").pop()!;
      asked.push(name);
      const ext = name.split(".").pop()!;
      if (ext === "vx4ex") return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
      const size = FILES[ext];
      return size ? new Response(new Uint8Array(size), { status: 200, headers: { "content-type": "application/octet-stream" } }) : new Response(null, { status: 404 });
    });
    const tileset = await loadTilesetGraphics("jungle");
    expect(asked).toContain("jungle.vx4ex");
    expect(asked).toContain("jungle.vx4");
    expect(tileset).toBeTruthy();
  });
});
