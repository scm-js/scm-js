import { memo, useEffect, useRef } from "react";
import { PLAYER_COLORS, playerColorIndex } from "../../data/players";
import { getUnitSprite } from "../../formats/units/sprites";
import { useGrpRevision, useUnitAssets } from "../../hooks/useUnitAssets";
import { useTileset } from "../../hooks/useTileset";

/**
 * A unit type drawn in a player's colour, scaled to fit `size`. Uses the open map's
 * tileset palette like the viewport does; a coloured swatch stands in until the
 * graphics arrive.
 */
export const UnitPreview = memo(function UnitPreview({ unitId, owner, colors, size }: { unitId: number; owner: number; colors: readonly number[] | null | undefined; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { loaded: assets } = useUnitAssets();
  const { loaded: tileset } = useTileset();
  const grpRevision = useGrpRevision();
  const colorIndex = playerColorIndex(colors, owner);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const sprite = assets && tileset ? getUnitSprite(assets, unitId, colorIndex, tileset.tileset.palette, tileset.name) : null;
    if (!sprite) {
      ctx.fillStyle = PLAYER_COLORS[colorIndex].hex;
      ctx.fillRect(size * 0.3, size * 0.3, size * 0.4, size * 0.4);
      return;
    }
    const scale = Math.min(1, size / Math.max(sprite.width, sprite.height));
    const w = sprite.width * scale, h = sprite.height * scale;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(sprite.image, (size - w) / 2, (size - h) / 2, w, h);
  }, [assets, tileset, grpRevision, unitId, colorIndex, size]);

  return <canvas ref={ref} className="unit-preview" style={{ width: size, height: size }} />;
});
