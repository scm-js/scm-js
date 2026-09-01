import { memo, useEffect, useRef } from "react";
import { PLAYER_COLORS, playerColorIndex } from "../../data/players";
import { getImageFrame, getUnitSprite, type ImageFrame } from "../../formats/units/sprites";
import type { SpriteKind } from "../../editor/sprites";
import { spriteFrame, spriteGrp, spriteImageId } from "../../hooks/useSpriteTools";
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

/**
 * A THG2 sprite's graphic: the sprites.dat image at frame 0 for a pure sprite, the unit's
 * editor pose for a unit sprite — mirrored when `flipped`. A diamond stands in until the
 * GRP arrives (or when the unit data is not installed).
 */
export const SpritePreview = memo(function SpritePreview({ kind, id, owner, colors, size, flipped = false }: { kind: SpriteKind; id: number; owner: number; colors: readonly number[] | null | undefined; size: number; flipped?: boolean }) {
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
    let frame: ImageFrame | null = null;
    if (assets && tileset) {
      const imageId = spriteImageId(assets, kind, id);
      if (kind === "unit") frame = getUnitSprite(assets, id, colorIndex, tileset.tileset.palette, tileset.name);
      else if (imageId >= 0) frame = getImageFrame(assets, imageId, 0, flipped, colorIndex, tileset.tileset.palette, tileset.name);
    }
    if (!frame) {
      ctx.fillStyle = "rgba(201,168,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(size / 2, size * 0.25);
      ctx.lineTo(size * 0.75, size / 2);
      ctx.lineTo(size / 2, size * 0.75);
      ctx.lineTo(size * 0.25, size / 2);
      ctx.closePath();
      ctx.fill();
      return;
    }
    // Crop to the frame's opaque rectangle: a GRP box can be far larger than what it shows
    // (a critter sits in a 128×128 box), and the preview should fill its square.
    let sx = 0, sy = 0, sw = frame.width, sh = frame.height;
    const grp = spriteGrp(assets, kind, id);
    if (assets && grp && grp.frames.length > 0) {
      const { frame: index, flip } = spriteFrame(assets, kind, id, flipped);
      const f = grp.frames[Math.min(index, grp.frames.length - 1)];
      if (f.width > 0 && f.height > 0) { sx = flip ? grp.width - f.x - f.width : f.x; sy = f.y; sw = f.width; sh = f.height; }
    }
    const scale = Math.min(1, size / Math.max(sw, sh));
    const w = sw * scale, h = sh * scale;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
    ctx.drawImage(frame.image, sx, sy, sw, sh, (size - w) / 2, (size - h) / 2, w, h);
    ctx.globalCompositeOperation = "source-over";
  }, [assets, tileset, grpRevision, kind, id, colorIndex, size, flipped]);

  return <canvas ref={ref} className="unit-preview" style={{ width: size, height: size }} />;
});
