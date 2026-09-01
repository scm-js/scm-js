import { memo, useEffect, useRef } from "react";
import { atlasSource } from "../../formats/tileset/atlas";
import { megatileForTile, MEGATILE_PX } from "../../formats/tileset/decode";
import type { DoodadDef } from "../../formats/tileset/doodads";
import type { LoadedTileset } from "../../formats/tileset/load";

/** A doodad's tiles drawn from the atlas, scaled to fit a `width`×`height` box. */
export const DoodadThumb = memo(function DoodadThumb({ loaded, def, width, height, title }: { loaded: LoadedTileset | null; def: DoodadDef; width: number; height: number; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!loaded) return;
    const px = Math.min(width / def.width, height / def.height);
    const ox = (width - px * def.width) / 2, oy = (height - px * def.height) / 2;
    ctx.imageSmoothingEnabled = px < MEGATILE_PX;
    for (let row = 0; row < def.height; row++) {
      for (let col = 0; col < def.width; col++) {
        const id = def.tiles[row * def.width + col];
        if (id === 0) continue;
        const megatile = megatileForTile(loaded.tileset, id);
        if (megatile <= 0) continue;
        const src = atlasSource(loaded.atlas, megatile);
        // Overdraw by a hair so scaled-down tiles leave no seams.
        ctx.drawImage(src.image, src.sx, src.sy, MEGATILE_PX, MEGATILE_PX, ox + col * px, oy + row * px, px + 0.5, px + 0.5);
      }
    }
  }, [loaded, def, width, height]);
  return <canvas ref={ref} className="doodad-thumb" style={{ width, height }} title={title} />;
});
