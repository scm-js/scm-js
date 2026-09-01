import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ContextMenu } from "radix-ui";
import { Crosshair, Loader2 } from "lucide-react";
import {
  activeDoodadAtom,
  activeLayerAtom,
  activeSpriteAtom,
  activeSpriteKindAtom,
  activeTerrainAtom,
  activeTileAtom,
  activeUnitAtom,
  activeUnitSpriteAtom,
  brushSizeAtom,
  centerViewOnAtom,
  clipboardAtom,
  clipPartsAtom,
  clipPastingAtom,
  clipSelectionAtom,
  cursorTileAtom,
  doodadPlacementAtom,
  doodadPlacingAtom,
  fogModeAtom,
  fogPlayersAtom,
  fogViewPlayerAtom,
  gridSizeAtom,
  locationSnapAtom,
  mapHeightAtom,
  mapTilesetAtom,
  mapWidthAtom,
  rectVariationAtom,
  blendAnchorAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  spritePlaceOptionsAtom,
  spritePlacingAtom,
  symmetryAtom,
  terrainModeAtom,
  unitOwnerAtom,
  unitPlacingAtom,
  viewFlagsAtom,
  viewportRectAtom,
  zoomAtom,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import { gridLookAtom } from "../../atoms/preferencesAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { doodadsRevisionAtom, locationsAtom, scenarioAtom, START_LOCATION_UNIT, startLocationsAtom, terrainRevisionAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { useTileset } from "../../hooks/useTileset";
import { paintsTiles, useTerrainTools, type MapPoint } from "../../hooks/useTerrainTools";
import { pluginContextItemsAtom } from "../../atoms/pluginAtoms";
import { pluginContextRows } from "../../plugins/contextMenu";
import { inMap as inMapBounds, neighbourOf, SIDES } from "../../editor/blend";
import { useUnitTools } from "../../hooks/useUnitTools";
import { doodadLabel, useDoodadTools, type DoodadGhost } from "../../hooks/useDoodadTools";
import { spriteName, useSpriteTools } from "../../hooks/useSpriteTools";
import { useFogTools } from "../../hooks/useFogTools";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { clipLocationBounds, clipSummary, tileRect } from "../../editor/clipboard";
import { boundsOf, HANDLE_CURSOR, HANDLES, handlePoint } from "../../editor/locations";
import { drawFogOverlay } from "./fog";
import { useGrpRevision, useUnitAssets } from "../../hooks/useUnitAssets";
import { getImageFrame, getUnitSprite, subunitOf } from "../../formats/units/sprites";
import { UnitAnimator, type SpriteState } from "../../formats/units/animate";
import type { TeamColorSpec } from "../../formats/units/teamColor";
import { NO_UNIT } from "../../formats/dat/dat";
import { ANYWHERE_INDEX, SpriteFlag, UnitState, UnitUsed } from "../../formats/chk/sections/objects";
import { tilesetIndex } from "../../formats/chk/scenario";
import { placementBox, unitBox, unitGeometry } from "../../editor/units";
import type { TileRect } from "../../editor/doodads";
import { doodadOrigin } from "../../formats/tileset/doodads";
import { unitName } from "../../data/units";
import { linePoints } from "../../editor/terrain";
import { symmetryAvailable, symmetryAxes } from "../../editor/symmetry";
import { diamondAt } from "../../editor/isom";
import { atlasSource, setAtlasStep } from "../../formats/tileset/atlas";
import { cycleStepAt, GAME_FRAME_MS } from "../../formats/tileset/cycle";
import { megatileForTile } from "../../formats/tileset/decode";
import { TILESET_BY_ID } from "../../data/tilesets";
import { displayColorHex, playerTeamColor } from "../../data/players";
import { SAMPLE_START_LOCATIONS } from "../../data/samples";
import { hashNoise } from "./noise";

const TILE = 32;

/**
 * Entering a layer switches its overlay on; leaving switches it back off if the layer
 * was what turned it on. The View toggle stays in charge in between, so unticking it
 * hides the overlay even while editing.
 */
function useAutoShow(active: boolean, key: keyof ViewFlags, setFlags: (fn: (f: ViewFlags) => ViewFlags) => void) {
  const auto = useRef(false);
  useEffect(() => {
    if (active) {
      setFlags((f) => {
        if (f[key]) return f;
        auto.current = true;
        return { ...f, [key]: true };
      });
    } else if (auto.current) {
      auto.current = false;
      setFlags((f) => (f[key] ? { ...f, [key]: false } : f));
    }
  }, [active, key, setFlags]);
}

const fmtTiles = (px: number) => (Number.isInteger(px / TILE) ? String(px / TILE) : (px / TILE).toFixed(2));

export default function MapViewport() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  /** Pointer position in map pixels; the isometric brush needs finer than tile resolution. */
  const hoverPointRef = useRef<MapPoint | null>(null);
  /** Diamond under the pointer at the last redraw, so the isometric outline follows the pointer within a tile. */
  const hoverDiamondRef = useRef("");
  /** Last tile a stroke painted, so a fast drag fills the gap with a line. */
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  /** Tile under the pointer when the context menu opened. */
  const menuTileRef = useRef<{ x: number; y: number } | null>(null);
  const menuPointRef = useRef<MapPoint | null>(null);
  /**
   * A Units-layer gesture in progress: moving the selection, a click that places (or, in
   * select mode, clears the selection) unless it grows into a marquee.
   */
  const unitGestureRef = useRef<{ mode: "move" | "click" | "select" | "marquee"; from: MapPoint; to: MapPoint; additive: boolean } | null>(null);
  /** The same for the Doodads layer; a move shows ghosts and lands on release. */
  const doodadGestureRef = useRef<{ mode: "move" | "click" | "select" | "marquee"; from: MapPoint; to: MapPoint; additive: boolean } | null>(null);
  /** And for the Sprites layer, which moves live like units do. */
  const spriteGestureRef = useRef<{ mode: "move" | "click" | "select" | "marquee"; from: MapPoint; to: MapPoint; additive: boolean } | null>(null);
  /**
   * A Locations-layer gesture: moving the selection, dragging a handle, a click on empty
   * ground (clears the selection) that becomes a create-drag once it travels.
   */
  const locationGestureRef = useRef<{ mode: "move" | "resize" | "create" | "click"; from: MapPoint; to: MapPoint; additive: boolean } | null>(null);
  /** A Cut / Copy / Paste-layer drag marking an area, in tiles. */
  const clipGestureRef = useRef<{ from: { x: number; y: number }; to: { x: number; y: number } } | null>(null);
  /** Whether the last paint blitted any cycling (water/lava) megatile, so the animation loop knows when a repaint shows anything. */
  const animatedInViewRef = useRef(false);
  /** Whether the last paint drew any unit, so the unit animation loop can skip repaints of empty views. */
  const unitsInViewRef = useRef(false);
  const lastViewportRect = useRef({ x: -1, y: -1, w: -1, h: -1 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const zoom = useAtomValue(zoomAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const flags = useAtomValue(viewFlagsAtom);
  const gridSize = useAtomValue(gridSizeAtom);
  const gridLook = useAtomValue(gridLookAtom);
  const layer = useAtomValue(activeLayerAtom);
  const brush = useAtomValue(brushSizeAtom);
  const terrainMode = useAtomValue(terrainModeAtom);
  const symmetry = useAtomValue(symmetryAtom);
  // Only read so the hover preview redraws when the brush changes.
  const activeTile = useAtomValue(activeTileAtom);
  const activeTerrain = useAtomValue(activeTerrainAtom);
  const rectVariation = useAtomValue(rectVariationAtom);
  const blendAnchor = useAtomValue(blendAnchorAtom);
  const tools = useTerrainTools();
  const unitTools = useUnitTools();
  const { loaded: unitAssets, error: unitError } = useUnitAssets();
  const grpRevision = useGrpRevision();
  const unitsRevision = useAtomValue(unitsRevisionAtom);
  const selectedUnits = useAtomValue(selectedUnitsAtom);
  // Only read so the placement ghost redraws when the palette choice changes.
  const activeUnit = useAtomValue(activeUnitAtom);
  const unitOwner = useAtomValue(unitOwnerAtom);
  const placing = useAtomValue(unitPlacingAtom);
  const doodadTools = useDoodadTools();
  const doodadsRevision = useAtomValue(doodadsRevisionAtom);
  const selectedDoodads = useAtomValue(selectedDoodadsAtom);
  const placingDoodad = useAtomValue(doodadPlacingAtom);
  // Only read so the placement ghost redraws when the palette choice or its options change.
  const activeDoodad = useAtomValue(activeDoodadAtom);
  const doodadPlacement = useAtomValue(doodadPlacementAtom);
  const spriteTools = useSpriteTools();
  const selectedSprites = useAtomValue(selectedSpritesAtom);
  const placingSprite = useAtomValue(spritePlacingAtom);
  // Only read so the placement ghost redraws when the palette choice or its options change.
  const activeSpriteKind = useAtomValue(activeSpriteKindAtom);
  const activeSprite = useAtomValue(activeSpriteAtom);
  const activeUnitSprite = useAtomValue(activeUnitSpriteAtom);
  const spritePlaceOptions = useAtomValue(spritePlaceOptionsAtom);
  const locationTools = useLocationTools();
  const selectedLocations = useAtomValue(selectedLocationsAtom);
  // Only read so the HUD and the create ghost redraw when the snap changes.
  const locationSnap = useAtomValue(locationSnapAtom);
  const clipTools = useClipboardTools();
  const clip = useAtomValue(clipboardAtom);
  const clipParts = useAtomValue(clipPartsAtom);
  const clipSelection = useAtomValue(clipSelectionAtom);
  const setClipSelection = useSetAtom(clipSelectionAtom);
  const pluginContextItems = useAtomValue(pluginContextItemsAtom);
  const pastingClip = useAtomValue(clipPastingAtom);
  const fogTools = useFogTools();
  const fogMode = useAtomValue(fogModeAtom);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
  const setFlags = useSetAtom(viewFlagsAtom);
  // Only read so the brush hint redraws when the selected players change.
  const fogPlayers = useAtomValue(fogPlayersAtom);
  /** The iscript sprites for the placed units; lives as long as the unit tables do. */
  const animator = useMemo(() => (unitAssets ? new UnitAnimator(unitAssets) : null), [unitAssets]);
  const setCursor = useSetAtom(cursorTileAtom);
  const setViewportRect = useSetAtom(viewportRectAtom);
  const centerOn = useAtomValue(centerViewOnAtom);
  const clearCenterOn = useSetAtom(centerViewOnAtom);
  const open = useSetAtom(openDialogAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  /** Blend mode: a click picks the anchor cell; tiles are placed from the palette, never by stroke. */
  const blending = layer === "terrain" && scenario !== null && terrainMode === "blend";
  const painting = layer === "terrain" && scenario !== null && !blending && (paintsTiles(terrainMode) || tools.isomReady);
  const unitsEditing = layer === "units" && scenario !== null;
  const unitPlacing = unitsEditing && placing;
  const doodadsEditing = layer === "doodads" && scenario !== null;
  const doodadPlacing = doodadsEditing && placingDoodad;
  const spritesEditing = layer === "sprites" && scenario !== null;
  const spritePlacing = spritesEditing && placingSprite;
  const fogPainting = layer === "fog" && scenario !== null;
  const locationsEditing = layer === "locations" && scenario !== null;
  const clipEditing = layer === "clipboard" && scenario !== null;
  /** The clip follows the pointer, a click stamps it. */
  const clipPasting = clipEditing && pastingClip && clip !== null;
  const showFog = scenario !== null && flags.fog;
  const locations = useAtomValue(locationsAtom);
  const mapStarts = useAtomValue(startLocationsAtom);
  const startLocations = scenario ? mapStarts : SAMPLE_START_LOCATIONS;
  const { loaded: tilesetAssets, loading: tilesetLoading, error: tilesetError } = useTileset();

  const tilePx = TILE * zoom;
  const worldW = mapW * tilePx;
  const worldH = mapH * tilePx;

  /* ── drawing ─────────────────────────────────────────── */
  const draw = useCallback(() => {
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!scroller || !canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, size.w, size.h);

    const x0 = Math.max(0, Math.floor(sx / tilePx));
    const y0 = Math.max(0, Math.floor(sy / tilePx));
    const x1 = Math.min(mapW, Math.ceil((sx + size.w) / tilePx));
    const y1 = Math.min(mapH, Math.ceil((sy + size.h) / tilePx));

    // terrain
    const tiles = scenario?.tiles;
    let animatedInView = false;
    if (tiles && tilesetAssets) {
      const { atlas, tileset: ts } = tilesetAssets;
      // Below ~4px a tile the atlas blit costs more than it shows, so fill with the
      // precomputed mean colour instead.
      const flat = tilePx < 4;
      ctx.imageSmoothingEnabled = tilePx < TILE;
      for (let ty = y0; ty < y1; ty++) {
        const row = ty * mapW;
        for (let tx = x0; tx < x1; tx++) {
          const megatile = megatileForTile(ts, tiles[row + tx]);
          const px = tx * tilePx - sx;
          const py = ty * tilePx - sy;
          if (megatile < 0) {
            ctx.fillStyle = "#000";
            ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);
            continue;
          }
          if (flat) {
            const rgb = atlas.averages[megatile];
            ctx.fillStyle = `rgb(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255})`;
            ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);
            continue;
          }
          const src = atlasSource(atlas, megatile);
          if (src.animated) animatedInView = true;
          ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
        }
      }
      ctx.imageSmoothingEnabled = true;
    } else if (tiles && tilesetLoading) {
      // Map open, graphics still coming: a calm plate under the loading overlay. Anything
      // tile-shaped here would just be wrong terrain for a moment.
      ctx.fillStyle = "#12161d";
      ctx.fillRect(-sx, -sy, worldW, worldH);
    } else {
      // No map or no tileset graphics installed: flat tileset colour with light noise.
      const base = parseInt(tileset.color.slice(1), 16);
      const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
      ctx.fillStyle = tileset.color;
      ctx.fillRect(-sx, -sy, worldW, worldH);
      if (tilePx >= 4) {
        for (let ty = y0; ty < y1; ty++) {
          for (let tx = x0; tx < x1; tx++) {
            const n = (hashNoise(tx, ty) - 0.5) * 0.12 + (hashNoise(tx >> 2, ty >> 2) - 0.5) * 0.16;
            const k = 1 + n;
            ctx.fillStyle = `rgb(${br * k | 0},${bg * k | 0},${bb * k | 0})`;
            ctx.fillRect(tx * tilePx - sx, ty * tilePx - sy, tilePx + 0.5, tilePx + 0.5);
          }
        }
      }
    }

    // grid: View ▸ Grid Settings picks the spacing, colour, opacity and style (lines / dots / crosses)
    if (flags.grid) {
      const step = (gridSize / TILE) * tilePx;
      if (step >= 6) {
        const alpha = (gridLook.opacity / 100) * (step >= 16 ? 1 : 0.65);
        ctx.strokeStyle = gridLook.color;
        ctx.fillStyle = gridLook.color;
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 1;
        const gx0 = Math.floor(sx / step) * step, gx1 = Math.min(worldW, sx + size.w);
        const gy0 = Math.floor(sy / step) * step, gy1 = Math.min(worldH, sy + size.h);
        ctx.beginPath();
        if (gridLook.style === "lines") {
          for (let gx = gx0; gx <= gx1; gx += step) {
            const px = Math.round(gx - sx) + 0.5;
            ctx.moveTo(px, Math.max(0, -sy));
            ctx.lineTo(px, Math.min(size.h, worldH - sy));
          }
          for (let gy = gy0; gy <= gy1; gy += step) {
            const py = Math.round(gy - sy) + 0.5;
            ctx.moveTo(Math.max(0, -sx), py);
            ctx.lineTo(Math.min(size.w, worldW - sx), py);
          }
          ctx.stroke();
        } else {
          const arm = gridLook.style === "crosses" ? Math.max(2, Math.min(6, step / 6)) : 0;
          for (let gx = gx0; gx <= gx1; gx += step) {
            for (let gy = gy0; gy <= gy1; gy += step) {
              const px = Math.round(gx - sx), py = Math.round(gy - sy);
              if (arm > 0) {
                ctx.moveTo(px - arm, py + 0.5); ctx.lineTo(px + arm + 1, py + 0.5);
                ctx.moveTo(px + 0.5, py - arm); ctx.lineTo(px + 0.5, py + arm + 1);
              } else {
                ctx.rect(px - 0.5, py - 0.5, 2, 2);
              }
            }
          }
          if (arm > 0) ctx.stroke(); else ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }


    // placed units: GRP sprites in the game's painter's order (ground by y, then flyers),
    // team-coloured through tunit.pcx and the tileset palette. Types whose graphic is
    // still loading — or everything, when the unit data is not installed — get a
    // player-coloured marker instead.
    const unitTables = unitAssets?.units ?? null;
    const palette = tilesetAssets?.tileset.palette ?? null;
    const paletteKey = tilesetAssets?.name ?? "";
    const colors = scenario?.playerColors;
    const playerRgb = scenario?.playerRgb;
    const teamOf = (owner: number) => playerTeamColor(colors, playerRgb, owner);
    const colorOf = (owner: number) => displayColorHex(colors, playerRgb, owner);
    const drawUnitSprite = (unitId: number, owner: number, ux: number, uy: number, alpha = 1): boolean => {
      if (!unitAssets || !palette || tilePx < 8) return false;
      const team = teamOf(owner);
      const sprite = getUnitSprite(unitAssets, unitId, team, palette, paletteKey);
      if (!sprite) return false;
      const w = sprite.width * zoom, h = sprite.height * zoom;
      ctx.globalAlpha = alpha;
      ctx.drawImage(sprite.image, ux - w / 2, uy - h / 2, w, h);
      const sub = subunitOf(unitAssets, unitId);
      if (sub !== NO_UNIT) {
        const turret = getUnitSprite(unitAssets, sub, team, palette, paletteKey);
        if (turret) ctx.drawImage(turret.image, ux - (turret.width * zoom) / 2, uy - (turret.height * zoom) / 2, turret.width * zoom, turret.height * zoom);
      }
      ctx.globalAlpha = 1;
      return true;
    };
    /**
     * A unit as its iscript sprite: shadow, main graphic, overlays, turret, fires and
     * smoke, each image at its own offset. False when the main graphic is not ready yet.
     */
    const drawSpriteImages = (sprite: SpriteState, team: TeamColorSpec, ux: number, uy: number): boolean => {
      if (!unitAssets || !palette) return false;
      for (const img of sprite.images) {
        if (img.hidden) continue;
        const frame = getImageFrame(unitAssets, img.imageId, img.frame, img.flip, team, palette, paletteKey);
        if (!frame) {
          if (img === sprite.main) return false;
          continue;
        }
        const w = frame.width * zoom, h = frame.height * zoom;
        ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
        ctx.drawImage(frame.image, ux + img.x * zoom - w / 2, uy + img.y * zoom - h / 2, w, h);
      }
      ctx.globalCompositeOperation = "source-over";
      return true;
    };
    const drawAnimatedUnit = (sprite: SpriteState, owner: number, ux: number, uy: number, alpha: number): boolean => {
      ctx.globalAlpha = alpha;
      const team = teamOf(owner);
      const drawn = drawSpriteImages(sprite, team, ux, uy);
      if (drawn && sprite.turret) drawSpriteImages(sprite.turret, team, ux, uy);
      ctx.globalAlpha = 1;
      return drawn;
    };
    const drawUnitMarker = (owner: number, ux: number, uy: number) => {
      const r = Math.max(2, tilePx * 0.34);
      ctx.fillStyle = colorOf(owner) + "cc";
      ctx.fillRect(ux - r, uy - r, r * 2, r * 2);
      if (tilePx >= 12) {
        ctx.strokeStyle = "rgba(0,0,0,0.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(ux - r) + 0.5, Math.round(uy - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
      }
    };
    /** A THG2 sprite in its editor pose: the sprites.dat image (pure) or the unit's picture. */
    const drawThg2Sprite = (spriteId: number, flags: number, owner: number, px: number, py: number, alpha = 1): boolean => {
      if (!unitAssets || !palette || tilePx < 8) return false;
      if (!(flags & SpriteFlag.PureSprite)) return drawUnitSprite(spriteId, owner, px, py, alpha);
      const imageId = unitAssets.sprites.image[spriteId];
      if (imageId === undefined) return false;
      const frame = getImageFrame(unitAssets, imageId, 0, (flags & SpriteFlag.Flipped) !== 0, teamOf(owner), palette, paletteKey);
      if (!frame) return false;
      const w = frame.width * zoom, h = frame.height * zoom;
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
      ctx.drawImage(frame.image, px - w / 2, py - h / 2, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      return true;
    };
    const drawSpriteMarker = (px: number, py: number) => {
      const r = Math.max(2, tilePx * 0.25);
      ctx.fillStyle = "rgba(201,168,255,0.85)";
      ctx.beginPath();
      ctx.moveTo(px, py - r);
      ctx.lineTo(px + r, py);
      ctx.lineTo(px, py + r);
      ctx.lineTo(px - r, py);
      ctx.closePath();
      ctx.fill();
    };
    let unitsInView = false;
    if ((flags.units || flags.sprites) && scenario && tilePx >= 3) {
      const margin = 512 * zoom; // the largest GRP box is a few hundred pixels
      const animated = animator?.enabled ? animator : null;
      if (animated && flags.units) animated.sync(scenario.units, tilesetIndex(scenario));
      if (animated && flags.sprites) animated.syncSprites(scenario.sprites, tilesetIndex(scenario));
      // Units and THG2 sprites share the game's painter's order: everything on the
      // ground by y (so a tree canopy over a unit works out by position), flyers last.
      type Drawable = { kind: "unit" | "sprite"; i: number; y: number; flyer: number };
      const order: Drawable[] = [];
      if (flags.units) scenario.units.forEach((u, i) => order.push({ kind: "unit", i, y: u.y, flyer: unitGeometry(unitTables, u.unitId).flyer ? 1 : 0 }));
      if (flags.sprites) scenario.sprites.forEach((r, i) => order.push({ kind: "sprite", i, y: r.y, flyer: 0 }));
      order.sort((a, b) => a.flyer - b.flyer || a.y - b.y || (a.kind === b.kind ? a.i - b.i : a.kind === "unit" ? -1 : 1));
      ctx.imageSmoothingEnabled = zoom < 1;
      for (const d of order) {
        if (d.kind === "sprite") {
          const r = scenario.sprites[d.i];
          const px = r.x * zoom - sx, py = r.y * zoom - sy;
          if (px < -margin || py < -margin || px > size.w + margin || py > size.h + margin) continue;
          unitsInView = true;
          const alpha = r.flags & SpriteFlag.Disabled ? 0.5 : 1;
          const sprite = animated?.spriteForRecord(r);
          if (sprite && tilePx >= 8 && drawAnimatedUnit(sprite, r.owner, px, py, alpha)) continue;
          if (drawThg2Sprite(r.spriteId, r.flags, r.owner, px, py, alpha)) continue;
          drawSpriteMarker(px, py);
          continue;
        }
        const u = scenario.units[d.i];
        const ux = u.x * zoom - sx;
        const uy = u.y * zoom - sy;
        if (ux < -margin || uy < -margin || ux > size.w + margin || uy > size.h + margin) continue;
        unitsInView = true;
        // A cloaked unit is drawn faint, the way the game shows your own cloaked units.
        const cloaked = (u.validStates & UnitUsed.State) !== 0 && (u.stateFlags & UnitState.Cloaked) !== 0;
        const sprite = animated?.spriteFor(u);
        if (sprite && tilePx >= 8 && drawAnimatedUnit(sprite, u.owner, ux, uy, cloaked ? 0.5 : 1)) continue;
        if (drawUnitSprite(u.unitId, u.owner, ux, uy, cloaked ? 0.5 : 1)) continue;
        // The numbered start-location marker below stands in for its sprite.
        if (u.unitId !== START_LOCATION_UNIT) drawUnitMarker(u.owner, ux, uy);
      }
      ctx.imageSmoothingEnabled = true;

      if (layer === "units" && flags.units && selectedUnits.length > 0) {
        ctx.strokeStyle = "#8ef0a4";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        for (const i of selectedUnits) {
          const u = scenario.units[i];
          if (!u) continue;
          const b = unitBox(unitGeometry(unitTables, u.unitId), u.x, u.y);
          ctx.strokeRect(Math.round(b.left * zoom - sx) + 0.5, Math.round(b.top * zoom - sy) + 0.5, Math.round((b.right - b.left) * zoom), Math.round((b.bottom - b.top) * zoom));
        }
        ctx.setLineDash([]);
      }
      // sprite layer: the selection's graphic boxes, and the sprite under the pointer in select mode
      if (spritesEditing && flags.sprites) {
        ctx.lineWidth = 1;
        const strokeSpriteBox = (b: { left: number; top: number; right: number; bottom: number }, color: string, dash: number[]) => {
          ctx.strokeStyle = color;
          ctx.setLineDash(dash);
          ctx.strokeRect(Math.round(b.left * zoom - sx) + 0.5, Math.round(b.top * zoom - sy) + 0.5, Math.round((b.right - b.left) * zoom), Math.round((b.bottom - b.top) * zoom));
          ctx.setLineDash([]);
        };
        for (const i of selectedSprites) {
          const r = scenario.sprites[i];
          if (r) strokeSpriteBox(spriteTools.boxOf(r), "#8ef0a4", [4, 3]);
        }
        const hps = hoverPointRef.current;
        if (hps && !spritePlacing && !spriteGestureRef.current) {
          const hit = spriteTools.pickAt(hps);
          const r = hit >= 0 ? scenario.sprites[hit] : null;
          if (r && !selectedSprites.includes(hit)) strokeSpriteBox(spriteTools.boxOf(r), "rgba(230,185,92,0.7)", [2, 2]);
        }
      }
    }

    // doodad layer: selected footprints, and the doodad under the pointer in select mode
    const strokeTileRect = (r: TileRect, color: string, dash: number[] | null) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.setLineDash(dash ?? []);
      ctx.strokeRect(Math.round(r.x0 * tilePx - sx) + 0.5, Math.round(r.y0 * tilePx - sy) + 0.5, Math.round((r.x1 - r.x0) * tilePx) - 1, Math.round((r.y1 - r.y0) * tilePx) - 1);
      ctx.setLineDash([]);
    };
    /** A doodad as it would be placed: its tiles translucent, refused cells red, the overlay sprite ghosted. */
    const drawDoodadGhost = (g: DoodadGhost, alpha: number) => {
      const ok = g.verdict.ok;
      const bad = new Set(g.verdict.bad);
      ctx.imageSmoothingEnabled = tilePx < TILE;
      for (let row = 0; row < g.def.height; row++) {
        for (let col = 0; col < g.def.width; col++) {
          const cell = row * g.def.width + col;
          const id = g.def.tiles[cell];
          const px = (g.x + col) * tilePx - sx, py = (g.y + row) * tilePx - sy;
          if (id !== 0 && tilesetAssets && tilePx >= 4) {
            const megatile = megatileForTile(tilesetAssets.tileset, id);
            if (megatile > 0) {
              const src = atlasSource(tilesetAssets.atlas, megatile);
              ctx.globalAlpha = alpha;
              ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
              ctx.globalAlpha = 1;
            }
          }
          if (bad.has(cell)) {
            ctx.fillStyle = "rgba(240,90,90,0.45)";
            ctx.fillRect(px, py, tilePx, tilePx);
          } else if (id === 0 && g.def.required[cell] !== 0) {
            // A cell the doodad needs but does not cover (a ramp's approach): hatch it lightly.
            ctx.fillStyle = ok ? "rgba(230,185,92,0.10)" : "rgba(240,90,90,0.10)";
            ctx.fillRect(px, py, tilePx, tilePx);
          }
        }
      }
      ctx.imageSmoothingEnabled = true;
      if (g.def.overlay) {
        const cx = (g.x * TILE + g.def.width * 16) * zoom - sx, cy = (g.y * TILE + g.def.height * 16) * zoom - sy;
        ctx.imageSmoothingEnabled = zoom < 1;
        drawThg2Sprite(g.def.overlay.id, g.def.flags, g.owner, cx, cy, alpha);
        ctx.imageSmoothingEnabled = true;
      }
      strokeTileRect({ x0: g.x, y0: g.y, x1: g.x + g.def.width, y1: g.y + g.def.height }, ok ? "#e6b95c" : "#f05a5a", null);
    };
    if (doodadsEditing && scenario) {
      for (const i of selectedDoodads) {
        const rec = scenario.doodads[i];
        const f = rec && doodadTools.footprintOf(rec);
        if (f) strokeTileRect(f, "#8ef0a4", [4, 3]);
      }
      const hvd = hoverRef.current;
      if (hvd && !doodadPlacing && !doodadGestureRef.current) {
        const hit = doodadTools.pickAt(hvd.x, hvd.y);
        const rec = hit >= 0 ? scenario.doodads[hit] : null;
        const f = rec && doodadTools.footprintOf(rec);
        if (f && !selectedDoodads.includes(hit)) strokeTileRect(f, "rgba(230,185,92,0.7)", [2, 2]);
      }
    }

    // locations: StarEdit's translucent plates with the name in the corner; overlaps
    // stack darker, the selection goes gold and grows handles, the one under the pointer
    // lights up. Anywhere (slot 63) is never drawn — it is the whole map.
    if (flags.locations && scenario) {
      const selectedSet = new Set(locationsEditing ? selectedLocations : []);
      const hvl = hoverPointRef.current;
      const hoverLoc = locationsEditing && hvl && !locationGestureRef.current && !locationTools.handleAtPoint(hvl, zoom) ? locationTools.pickAt(hvl) : -1;
      const uiFont = getComputedStyle(document.body).getPropertyValue("--font-ui");
      const fontPx = Math.max(10, Math.min(13, tilePx * 0.4));
      ctx.font = `${fontPx}px ${uiFont}`;
      ctx.lineWidth = 1;
      for (const l of locations) {
        const lx = l.left * zoom - sx, ly = l.top * zoom - sy, lw = (l.right - l.left) * zoom, lh = (l.bottom - l.top) * zoom;
        if (lx > size.w || ly > size.h || lx + lw < 0 || ly + lh < 0) continue;
        const sel = selectedSet.has(l.index), hot = l.index === hoverLoc;
        ctx.fillStyle = sel ? "rgba(230,185,92,0.22)" : hot ? "rgba(79,209,197,0.20)" : "rgba(79,209,197,0.13)";
        ctx.fillRect(lx, ly, lw, lh);
        const bx = Math.round(lx) + 0.5, by = Math.round(ly) + 0.5, bw = Math.round(lw), bh = Math.round(lh);
        // A dark hairline inside the coloured edge keeps the box legible over bright ground.
        if (bw > 2 && bh > 2) {
          ctx.strokeStyle = "rgba(0,0,0,0.4)";
          ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
        }
        ctx.strokeStyle = sel ? "#f4d08a" : hot ? "#bff5ef" : "rgba(79,209,197,0.9)";
        ctx.strokeRect(bx, by, Math.max(1, bw), Math.max(1, bh));
        if (flags.locationNames && tilePx >= 8) {
          const tw = ctx.measureText(l.name).width;
          const plateH = fontPx + 5;
          ctx.fillStyle = sel ? "rgba(58,44,10,0.85)" : "rgba(10,12,16,0.78)";
          ctx.fillRect(lx + 1, ly + 1, tw + 8, plateH);
          // An elevation-restricted location gets an amber tab on its plate.
          if (l.elevationFlags !== 0) {
            ctx.fillStyle = "#e0a545";
            ctx.fillRect(lx + 1, ly + 1, 2, plateH);
          }
          ctx.fillStyle = sel ? "#f4d08a" : "#bff5ef";
          ctx.fillText(l.name, lx + 5, ly + 1 + fontPx);
        }
      }
      if (locationsEditing) {
        // Resize handles on a single selection; Anywhere has none, it cannot be resized.
        const only = selectedLocations.length === 1 && selectedLocations[0] !== ANYWHERE_INDEX ? scenario.locations[selectedLocations[0]] : null;
        if (only) {
          const b = boundsOf(only);
          for (const h of HANDLES) {
            const p = handlePoint(b, h);
            const hx = Math.round(p.x * zoom - sx), hy = Math.round(p.y * zoom - sy);
            ctx.fillStyle = "#f4d08a";
            ctx.fillRect(hx - 3, hy - 3, 7, 7);
            ctx.strokeStyle = "rgba(0,0,0,0.75)";
            ctx.strokeRect(hx - 3.5, hy - 3.5, 8, 8);
          }
        }
        // The box a create-drag is about to make, with its size in tiles.
        const g = locationGestureRef.current;
        const ghost = g?.mode === "create" ? locationTools.dragRect(g.from, g.to) : null;
        if (ghost) {
          const gx = ghost.left * zoom - sx, gy = ghost.top * zoom - sy, gw = (ghost.right - ghost.left) * zoom, gh = (ghost.bottom - ghost.top) * zoom;
          ctx.fillStyle = "rgba(230,185,92,0.14)";
          ctx.fillRect(gx, gy, gw, gh);
          ctx.strokeStyle = "#e6b95c";
          ctx.setLineDash([4, 3]);
          ctx.strokeRect(Math.round(gx) + 0.5, Math.round(gy) + 0.5, Math.round(gw), Math.round(gh));
          ctx.setLineDash([]);
          const label = `${fmtTiles(ghost.right - ghost.left)} × ${fmtTiles(ghost.bottom - ghost.top)}`;
          ctx.font = `10px ${getComputedStyle(document.body).getPropertyValue("--font-mono")}`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = "rgba(10,12,16,0.8)";
          ctx.fillRect(gx + gw + 4, gy + gh + 4, tw + 8, 15);
          ctx.fillStyle = "#f4d08a";
          ctx.fillText(label, gx + gw + 8, gy + gh + 15);
        }
      }
    }

    // start locations
    if (flags.startLocations) {
      for (const s of startLocations) {
        const cx = s.x * tilePx - sx, cy = s.y * tilePx - sy, r = tilePx * 1.5;
        if (cx + r < 0 || cy + r < 0 || cx - r > size.w || cy - r > size.h) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = colorOf(s.player) + "55";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = colorOf(s.player);
        ctx.stroke();
        if (tilePx >= 12) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(10, tilePx * 0.5)}px ${getComputedStyle(document.body).getPropertyValue("--font-ui")}`;
          ctx.textAlign = "center";
          ctx.fillText(String(s.player + 1), cx, cy + tilePx * 0.18);
          ctx.textAlign = "left";
        }
      }
    }

    // fog of war: over units, locations and markers alike, since in game it hides all of them
    if (showFog && scenario) drawFogOverlay(ctx, scenario, tilesetIndex(scenario), fogViewPlayer, { x0, y0, x1, y1, tilePx, sx, sy });

    // map boundary
    ctx.strokeStyle = "rgba(230,185,92,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-sx + 0.5, -sy + 0.5, worldW - 1, worldH - 1);

    // symmetry axes (Tools ▸ Symmetry…): the mirror lines the Rect, Tile and Fog brushes paint across
    if (symmetry !== "none" && (layer === "terrain" || layer === "fog") && symmetryAvailable(symmetry, mapW, mapH)) {
      const axes = symmetryAxes(symmetry, mapW, mapH);
      ctx.strokeStyle = "rgba(142,240,164,0.85)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (const l of axes.lines) {
        ctx.moveTo(Math.round(l.x0 * tilePx - sx) + 0.5, Math.round(l.y0 * tilePx - sy) + 0.5);
        ctx.lineTo(Math.round(l.x1 * tilePx - sx) + 0.5, Math.round(l.y1 * tilePx - sy) + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      if (axes.centre) {
        const cx = (mapW / 2) * tilePx - sx, cy = (mapH / 2) * tilePx - sy;
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.moveTo(cx - 10, cy); ctx.lineTo(cx + 10, cy);
        ctx.moveTo(cx, cy - 10); ctx.lineTo(cx, cy + 10);
        ctx.stroke();
      }
    }

    // Cut / Copy / Paste layer: the marked area with its size, and the clip under the pointer while pasting
    if (clipEditing && scenario) {
      const g = clipGestureRef.current;
      const marked = g ? tileRect(g.from, g.to) : clipSelection;
      if (marked) {
        const mx = marked.x0 * tilePx - sx, my = marked.y0 * tilePx - sy, mw = (marked.x1 - marked.x0) * tilePx, mh = (marked.y1 - marked.y0) * tilePx;
        ctx.fillStyle = "rgba(230,185,92,0.10)";
        ctx.fillRect(mx, my, mw, mh);
        ctx.strokeStyle = "#e6b95c";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(Math.round(mx) + 0.5, Math.round(my) + 0.5, Math.round(mw) - 1, Math.round(mh) - 1);
        ctx.setLineDash([]);
        const label = `${marked.x1 - marked.x0} × ${marked.y1 - marked.y0}`;
        ctx.font = `10px ${getComputedStyle(document.body).getPropertyValue("--font-mono")}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(10,12,16,0.8)";
        ctx.fillRect(mx + mw + 4, my + mh + 4, tw + 8, 15);
        ctx.fillStyle = "#f4d08a";
        ctx.fillText(label, mx + mw + 8, my + mh + 15);
      }
      const hvc = hoverRef.current;
      if (clipPasting && clip && hvc && !g) {
        // The clip with its top-left tile under the pointer: the picture at three-quarter
        // strength (its own tiles, or the catalogue's for a doodad-only clip), the objects
        // as ghosts, and the outline — red when part of it would fall off the map.
        const ax = hvc.x, ay = hvc.y;
        const ox = ax * TILE, oy = ay * TILE;
        const sameTileset = clip.era === tilesetIndex(scenario);
        const blit = (tx: number, ty: number, id: number) => {
          if (!tilesetAssets || tilePx < 4 || tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return;
          const megatile = megatileForTile(tilesetAssets.tileset, id);
          if (megatile <= 0) return;
          const src = atlasSource(tilesetAssets.atlas, megatile);
          ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, tx * tilePx - sx, ty * tilePx - sy, tilePx, tilePx);
        };
        ctx.globalAlpha = 0.75;
        ctx.imageSmoothingEnabled = tilePx < TILE;
        if (sameTileset && clipParts.terrain && clip.tiles && clip.ground) {
          const picture = clipParts.doodads ? clip.tiles : clip.ground;
          for (let y = 0; y < clip.height; y++) for (let x = 0; x < clip.width; x++) blit(ax + x, ay + y, picture[y * clip.width + x]);
        } else if (sameTileset && clipParts.doodads) {
          for (const d of clip.doodads) {
            const def = doodadTools.catalogue.byId.get(d.doodadId);
            if (!def) continue;
            const o = doodadOrigin(def, d.x + ox, d.y + oy);
            for (let row = 0; row < def.height; row++) for (let col = 0; col < def.width; col++) {
              const id = def.tiles[row * def.width + col];
              if (id !== 0) blit(o.x + col, o.y + row, id);
            }
          }
        }
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = zoom < 1;
        if (clipParts.units) {
          for (const u of clip.units) {
            const ux = (u.x + ox) * zoom - sx, uy = (u.y + oy) * zoom - sy;
            if (!drawUnitSprite(u.unitId, u.owner, ux, uy, 0.6) && u.unitId !== START_LOCATION_UNIT) drawUnitMarker(u.owner, ux, uy);
          }
        }
        if (clipParts.sprites) {
          for (const s of clip.sprites) {
            const px = (s.x + ox) * zoom - sx, py = (s.y + oy) * zoom - sy;
            if (!drawThg2Sprite(s.spriteId, s.flags, s.owner, px, py, 0.6)) drawSpriteMarker(px, py);
          }
        }
        ctx.imageSmoothingEnabled = true;
        if (clipParts.locations) {
          ctx.lineWidth = 1;
          for (const l of clip.locations) {
            const b = boundsOf(clipLocationBounds(l, ax, ay));
            ctx.fillStyle = "rgba(79,209,197,0.13)";
            ctx.fillRect(b.left * zoom - sx, b.top * zoom - sy, (b.right - b.left) * zoom, (b.bottom - b.top) * zoom);
            ctx.strokeStyle = "rgba(79,209,197,0.9)";
            ctx.setLineDash([3, 2]);
            ctx.strokeRect(Math.round(b.left * zoom - sx) + 0.5, Math.round(b.top * zoom - sy) + 0.5, Math.round((b.right - b.left) * zoom), Math.round((b.bottom - b.top) * zoom));
            ctx.setLineDash([]);
          }
        }
        const fits = ax + clip.width <= mapW && ay + clip.height <= mapH;
        strokeTileRect({ x0: ax, y0: ay, x1: ax + clip.width, y1: ay + clip.height }, fits ? "#e6b95c" : "#f05a5a", null);
      }
    }

    /** The box-select rectangle of an object-layer drag. */
    const drawMarquee = (g: { from: MapPoint; to: MapPoint }) => {
      const left = Math.min(g.from.px, g.to.px) * zoom - sx, top = Math.min(g.from.py, g.to.py) * zoom - sy;
      ctx.fillStyle = "rgba(142,240,164,0.10)";
      ctx.fillRect(left, top, Math.abs(g.to.px - g.from.px) * zoom, Math.abs(g.to.py - g.from.py) * zoom);
      ctx.strokeStyle = "#8ef0a4";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.round(left) + 0.5, Math.round(top) + 0.5, Math.round(Math.abs(g.to.px - g.from.px) * zoom), Math.round(Math.abs(g.to.py - g.from.py) * zoom));
      ctx.setLineDash([]);
    };

    // blend brush: the anchor cell and the four neighbours the palette can fill
    if (blending && blendAnchor && scenario && inMapBounds(scenario, blendAnchor)) {
      for (const side of SIDES) {
        const n = neighbourOf(blendAnchor, side);
        if (inMapBounds(scenario, n)) strokeTileRect({ x0: n.x, y0: n.y, x1: n.x + 1, y1: n.y + 1 }, "rgba(230,185,92,0.6)", [3, 2]);
      }
      ctx.strokeStyle = "#e6b95c";
      ctx.lineWidth = 2;
      ctx.strokeRect(Math.round(blendAnchor.x * tilePx - sx) + 1, Math.round(blendAnchor.y * tilePx - sy) + 1, Math.round(tilePx) - 2, Math.round(tilePx) - 2);
    }

    // hover brush, with a preview of what the terrain brush would leave behind
    const hv = hoverRef.current;
    const hp = hoverPointRef.current;
    if (hv && hp && painting && terrainMode === "isom") {
      // The isometric brush works in diamonds — 4 tiles wide, 2 tall, centred on the
      // lattice — so outline the ones this stroke would set rather than a tile square.
      ctx.strokeStyle = "#e6b95c";
      ctx.fillStyle = "rgba(230,185,92,0.12)";
      ctx.lineWidth = 1.5;
      for (const d of tools.ghostDiamondsAt(hp)) {
        const cx = d.x * 2 * tilePx - sx, cy = d.y * tilePx - sy;
        ctx.beginPath();
        ctx.moveTo(cx - 2 * tilePx, cy);
        ctx.lineTo(cx, cy - tilePx);
        ctx.lineTo(cx + 2 * tilePx, cy);
        ctx.lineTo(cx, cy + tilePx);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (doodadsEditing && doodadGestureRef.current?.mode === "move") {
      for (const g of doodadTools.dragGhosts()) drawDoodadGhost(g, 0.6);
    } else if (hp && doodadsEditing && doodadGestureRef.current?.mode === "marquee") {
      drawMarquee(doodadGestureRef.current);
    } else if (hp && spritesEditing && spriteGestureRef.current?.mode === "marquee") {
      drawMarquee(spriteGestureRef.current);
    } else if (hv && hp && spritePlacing && !spriteGestureRef.current) {
      // Where the active sprite would land: its graphic at half strength (a marker while
      // the GRP loads) inside its frame box. Sprites have no placement rules to fail.
      const ghost = spriteTools.ghostAt(hp);
      if (ghost) {
        const gx = ghost.x * zoom - sx, gy = ghost.y * zoom - sy;
        ctx.imageSmoothingEnabled = zoom < 1;
        if (!drawThg2Sprite(ghost.id, ghost.flags, ghost.owner, gx, gy, 0.6)) drawSpriteMarker(gx, gy);
        ctx.imageSmoothingEnabled = true;
        const b = ghost.box;
        ctx.strokeStyle = "#e6b95c";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(b.left * zoom - sx) + 0.5, Math.round(b.top * zoom - sy) + 0.5, Math.round((b.right - b.left) * zoom) - 1, Math.round((b.bottom - b.top) * zoom) - 1);
      }
    } else if (hv && hp && doodadPlacing && !doodadGestureRef.current) {
      const ghost = doodadTools.ghostAt(hp);
      if (ghost) drawDoodadGhost(ghost, ghost.verdict.ok ? 0.75 : 0.45);
    } else if (hp && unitsEditing && unitGestureRef.current?.mode === "marquee") {
      drawMarquee(unitGestureRef.current);
    } else if (hv && hp && unitPlacing && !unitGestureRef.current) {
      // Where the active unit would land: its sprite at half strength, and the box that
      // snaps to the grid for buildings (the collision box for everything else). Red when
      // the placement checks would refuse the spot, with the unit in the way outlined.
      const ghost = unitTools.ghostAt(hp);
      if (ghost) {
        const gx = ghost.x * zoom - sx, gy = ghost.y * zoom - sy;
        ctx.imageSmoothingEnabled = zoom < 1;
        const drawn = drawUnitSprite(ghost.unitId, ghost.owner, gx, gy, ghost.problem ? 0.35 : 0.6);
        ctx.imageSmoothingEnabled = true;
        const b = ghost.geometry.building ? placementBox(ghost.geometry, ghost.x, ghost.y) : unitBox(ghost.geometry, ghost.x, ghost.y);
        const bx = b.left * zoom - sx, by = b.top * zoom - sy, bw = (b.right - b.left) * zoom, bh = (b.bottom - b.top) * zoom;
        if (!drawn || ghost.problem) {
          ctx.fillStyle = ghost.problem ? "rgba(240,90,90,0.28)" : colorOf(ghost.owner) + "66";
          ctx.fillRect(bx, by, bw, bh);
        }
        ctx.strokeStyle = ghost.problem ? "#f05a5a" : "#e6b95c";
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(bx) + 0.5, Math.round(by) + 0.5, Math.round(bw) - 1, Math.round(bh) - 1);
        const blocker = ghost.blocker >= 0 ? scenario?.units[ghost.blocker] : null;
        if (blocker) {
          const ob = unitBox(unitGeometry(unitTables, blocker.unitId), blocker.x, blocker.y);
          ctx.setLineDash([3, 3]);
          ctx.strokeRect(Math.round(ob.left * zoom - sx) + 0.5, Math.round(ob.top * zoom - sy) + 0.5, Math.round((ob.right - ob.left) * zoom), Math.round((ob.bottom - ob.top) * zoom));
          ctx.setLineDash([]);
        }
      }
    } else if (hv && !doodadsEditing && !spritesEditing && !locationsEditing && !clipEditing) {
      const b = (layer === "terrain" && !blending) || layer === "fog" ? brush : 1;
      const off = Math.floor((b - 1) / 2);
      const hx = (hv.x - off) * tilePx - sx, hy = (hv.y - off) * tilePx - sy;
      if (painting && tilesetAssets && tilePx >= 4 && !strokeRef.current) {
        const { atlas, tileset: ts } = tilesetAssets;
        ctx.globalAlpha = 0.75;
        ctx.imageSmoothingEnabled = tilePx < TILE;
        for (const g of tools.ghostAt(hv.x, hv.y)) {
          const megatile = megatileForTile(ts, g.id);
          const px = g.x * tilePx - sx, py = g.y * tilePx - sy;
          if (megatile <= 0) {
            ctx.fillStyle = "#000";
            ctx.fillRect(px, py, tilePx, tilePx);
            continue;
          }
          const src = atlasSource(atlas, megatile);
          if (src.animated) animatedInView = true;
          ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
        }
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
      } else {
        // On the fog layer the brush previews its effect: black lays fog, light lifts it.
        ctx.fillStyle = fogPainting ? (fogMode === "fog" ? "rgba(0,0,0,0.6)" : "rgba(255,255,255,0.22)") : "rgba(230,185,92,0.12)";
        ctx.fillRect(hx, hy, tilePx * b, tilePx * b);
      }
      ctx.strokeStyle = "#e6b95c";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(tilePx * b) - 1, Math.round(tilePx * b) - 1);
    }

    // rulers
    const labelEvery = [1, 2, 4, 8, 16, 32].find((n) => n * tilePx >= 40) ?? 32;
    const tick = tilePx >= 8 ? 1 : labelEvery / 2;
    const drawRuler = (c: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!c) return;
      const len = horizontal ? size.w : size.h;
      c.width = (horizontal ? len : 20) * dpr;
      c.height = (horizontal ? 20 : len) * dpr;
      const rc = c.getContext("2d")!;
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.fillStyle = "#191d25";
      rc.fillRect(0, 0, horizontal ? len : 20, horizontal ? 20 : len);
      rc.font = `9.5px ${getComputedStyle(document.body).getPropertyValue("--font-mono")}`;
      rc.fillStyle = "#99a2b3";
      rc.strokeStyle = "#3b4453";
      rc.beginPath();
      const scroll = horizontal ? sx : sy;
      const tiles = horizontal ? mapW : mapH;
      for (let t = Math.floor(scroll / tilePx / tick) * tick; t <= tiles; t += tick) {
        const p = Math.round(t * tilePx - scroll) + 0.5;
        if (p < 0 || p > len) continue;
        const major = t % labelEvery === 0;
        const l = major ? 8 : 4;
        if (horizontal) { rc.moveTo(p, 20); rc.lineTo(p, 20 - l); } else { rc.moveTo(20, p); rc.lineTo(20 - l, p); }
        if (major && t < tiles) {
          if (horizontal) rc.fillText(String(t), p + 3, 9);
          else {
            rc.save();
            rc.translate(9, p + 3);
            rc.rotate(-Math.PI / 2);
            rc.textAlign = "right";
            rc.fillText(String(t), 0, 0);
            rc.restore();
          }
        }
      }
      rc.stroke();
      // hover marker
      if (hv) {
        rc.fillStyle = "rgba(230,185,92,0.35)";
        const p = (horizontal ? hv.x : hv.y) * tilePx - scroll;
        if (horizontal) rc.fillRect(p, 0, tilePx, 20); else rc.fillRect(0, p, 20, tilePx);
      }
    };
    drawRuler(topRef.current, true);
    drawRuler(leftRef.current, false);

    animatedInViewRef.current = animatedInView;
    unitsInViewRef.current = unitsInView;
    const rect = { x: sx / tilePx, y: sy / tilePx, w: size.w / tilePx, h: size.h / tilePx };
    const prev = lastViewportRect.current;
    if (rect.x !== prev.x || rect.y !== prev.y || rect.w !== prev.w || rect.h !== prev.h) {
      lastViewportRect.current = rect;
      setViewportRect(rect);
    }
  }, [size, tilePx, zoom, mapW, mapH, worldW, worldH, tileset, flags, gridSize, gridLook, layer, brush, setViewportRect, scenario, tilesetAssets, terrainRevision, locations, startLocations, painting, blending, blendAnchor, tools, activeTile, activeTerrain, rectVariation, tilesetLoading, unitsEditing, unitPlacing, unitTools, unitAssets, animator, grpRevision, unitsRevision, selectedUnits, activeUnit, unitOwner, showFog, fogViewPlayer, fogPainting, fogMode, fogPlayers, doodadsEditing, doodadPlacing, doodadTools, doodadsRevision, selectedDoodads, activeDoodad, doodadPlacement, clipEditing, clipPasting, clip, clipParts, clipSelection, spritesEditing, spritePlacing, spriteTools, selectedSprites, activeSpriteKind, activeSprite, activeUnitSprite, spritePlaceOptions, locationsEditing, locationTools, selectedLocations, locationSnap, symmetry]);

  /* ── the fog and locations layers show their overlays ── */
  useAutoShow(layer === "fog", "fog", setFlags);
  useAutoShow(layer === "locations", "locations", setFlags);
  // The Locations layer sets its own pointer cursor (move / resize); drop it on leaving.
  useEffect(() => {
    if (layer !== "locations" && surfaceRef.current) surfaceRef.current.style.cursor = "";
  }, [layer]);

  /* ── sizing ──────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    draw();
  }, [size, draw]);

  /* ── water / lava animation ──────────────────────────── */
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const anim = flags.animateWater ? tilesetAssets?.atlas.animation : undefined;
    const units = flags.animateUnits && (flags.units || flags.sprites) && animator?.enabled ? animator : null;
    if (!scenario || (!anim && !units)) return;
    let raf = 0;
    let lastFrame = Math.floor(performance.now() / GAME_FRAME_MS);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      let repaint = false;
      // Palette rotations follow the wall clock, so the phase survives re-mounts and
      // stays in step with the tile browser. Only repaint when something on screen cycles.
      if (anim && tilesetAssets && setAtlasStep(tilesetAssets.atlas, tilesetAssets.tileset, cycleStepAt(now, anim.length)) && animatedInViewRef.current) repaint = true;
      if (units) {
        // Unit scripts advance once per game frame; after a stall (a hidden tab) catch up
        // by a few frames rather than replaying the whole gap.
        const frame = Math.floor(now / GAME_FRAME_MS);
        const steps = Math.min(4, frame - lastFrame);
        lastFrame = frame;
        for (let i = 0; i < steps; i++) if (units.tick()) repaint = true;
        if (!unitsInViewRef.current) repaint = repaint && animatedInViewRef.current;
      }
      if (repaint) drawRef.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flags.animateWater, flags.animateUnits, flags.units, flags.sprites, tilesetAssets, scenario, animator]);

  /* minimap-driven recentring */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !centerOn) return;
    el.scrollLeft = centerOn.x * tilePx - el.clientWidth / 2;
    el.scrollTop = centerOn.y * tilePx - el.clientHeight / 2;
    clearCenterOn(null);
    draw();
  }, [centerOn, tilePx, clearCenterOn, draw]);

  /* keep the view centred when zooming */
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || prevZoom.current === zoom) return;
    const ratio = zoom / prevZoom.current;
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    el.scrollLeft = cx * ratio - el.clientWidth / 2;
    el.scrollTop = cy * ratio - el.clientHeight / 2;
    prevZoom.current = zoom;
    draw();
  }, [zoom, draw]);

  /* ── pointer ─────────────────────────────────────────── */
  const tileAt = (e: { clientX: number; clientY: number }) => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left + el.scrollLeft) / tilePx),
      y: Math.floor((e.clientY - r.top + el.scrollTop) / tilePx),
    };
  };
  const pointAt = (e: { clientX: number; clientY: number }): MapPoint => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return { px: (e.clientX - r.left + el.scrollLeft) / zoom, py: (e.clientY - r.top + el.scrollTop) / zoom };
  };
  const clampPoint = (p: MapPoint): MapPoint => ({
    px: Math.min(mapW * TILE - 1, Math.max(0, p.px)),
    py: Math.min(mapH * TILE - 1, Math.max(0, p.py)),
  });
  const inMap = (t: { x: number; y: number }) => t.x >= 0 && t.y >= 0 && t.x < mapW && t.y < mapH;
  const clampToMap = (t: { x: number; y: number }) => ({ x: Math.min(mapW - 1, Math.max(0, t.x)), y: Math.min(mapH - 1, Math.max(0, t.y)) });

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = tileAt(e);
    if (!inMap(t)) return;
    if (doodadsEditing) {
      const p = pointAt(e);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const hit = doodadTools.pickAt(t.x, t.y);
      if (hit >= 0) {
        // Clicking a doodad selects it (shift toggles) and starts dragging the selection.
        if (e.shiftKey) doodadTools.select([hit], true);
        else if (!selectedDoodads.includes(hit)) doodadTools.select([hit]);
        doodadGestureRef.current = { mode: "move", from: p, to: p, additive: false };
        doodadTools.beginDrag(p);
      } else {
        doodadGestureRef.current = { mode: placingDoodad ? "click" : "select", from: p, to: p, additive: e.shiftKey };
      }
      draw();
      return;
    }
    if (spritesEditing) {
      const p = pointAt(e);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const hit = spriteTools.pickAt(p);
      if (hit >= 0) {
        if (e.shiftKey) spriteTools.select([hit], true);
        else if (!selectedSprites.includes(hit)) spriteTools.select([hit]);
        spriteGestureRef.current = { mode: "move", from: p, to: p, additive: false };
        spriteTools.beginDrag(p);
      } else {
        spriteGestureRef.current = { mode: placingSprite ? "click" : "select", from: p, to: p, additive: e.shiftKey };
      }
      draw();
      return;
    }
    if (unitsEditing) {
      const p = pointAt(e);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const hit = unitTools.pickAt(p);
      if (hit >= 0) {
        // Clicking a unit selects it (shift toggles) and starts dragging the selection.
        if (e.shiftKey) unitTools.select([hit], true);
        else if (!selectedUnits.includes(hit)) unitTools.select([hit]);
        unitGestureRef.current = { mode: "move", from: p, to: p, additive: false };
        unitTools.beginDrag(p);
      } else {
        // Empty ground: a click places the active unit (or, in select mode, clears the
        // selection), a drag box-selects.
        unitGestureRef.current = { mode: placing ? "click" : "select", from: p, to: p, additive: e.shiftKey };
      }
      draw();
      return;
    }
    if (locationsEditing) {
      const p = pointAt(e);
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      const handle = locationTools.handleAtPoint(p, zoom);
      if (handle) {
        locationGestureRef.current = { mode: "resize", from: p, to: p, additive: false };
        locationTools.beginResize(selectedLocations[0], handle);
      } else {
        const hit = locationTools.pickAt(p);
        if (hit >= 0) {
          // Clicking a location selects it (shift toggles) and starts dragging the selection.
          if (e.shiftKey) locationTools.select([hit], true);
          else if (!selectedLocations.includes(hit)) locationTools.select([hit]);
          locationGestureRef.current = { mode: "move", from: p, to: p, additive: false };
          locationTools.beginMove(p);
        } else {
          // Empty ground: a drag creates a location, a click clears the selection.
          locationGestureRef.current = { mode: "click", from: p, to: p, additive: e.shiftKey };
        }
      }
      draw();
      return;
    }
    if (clipEditing) {
      e.preventDefault();
      if (clipPasting) { clipTools.pasteAt(t.x, t.y); draw(); return; }
      // Otherwise a drag marks the area Cut / Copy take; a click marks one tile.
      e.currentTarget.setPointerCapture(e.pointerId);
      clipGestureRef.current = { from: t, to: t };
      setClipSelection(tileRect(t, t));
      draw();
      return;
    }
    if (fogPainting) {
      // Alt-click reads the tile's fog into the player ticks; Shift paints the opposite of the palette's mode.
      if (e.altKey) { fogTools.pickAt(t.x, t.y); return; }
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      strokeRef.current = t;
      fogTools.beginStroke(t.x, t.y, e.shiftKey);
      draw();
      return;
    }
    if (blending) { tools.pickAt(t.x, t.y); return; }
    if (!painting) return;
    if (e.altKey) { tools.pickAt(t.x, t.y, pointAt(e)); return; }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = t;
    tools.beginStroke(t.x, t.y, pointAt(e));
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = tileAt(e);
    const point = pointAt(e);
    const cGesture = clipGestureRef.current;
    if (cGesture) {
      const c = clampToMap(t);
      if (c.x !== cGesture.to.x || c.y !== cGesture.to.y) { cGesture.to = c; setClipSelection(tileRect(cGesture.from, c)); }
      hoverRef.current = c;
      hoverPointRef.current = clampPoint(point);
      setCursor(c);
      draw();
      return;
    }
    const dGesture = doodadGestureRef.current;
    if (dGesture) {
      const p = clampPoint(point);
      dGesture.to = p;
      if (dGesture.mode === "move") doodadTools.dragTo(p);
      else if ((dGesture.mode === "click" || dGesture.mode === "select") && Math.hypot(p.px - dGesture.from.px, p.py - dGesture.from.py) * zoom > 4) dGesture.mode = "marquee";
      hoverRef.current = clampToMap(t);
      hoverPointRef.current = p;
      setCursor(hoverRef.current);
      draw();
      return;
    }
    const sGesture = spriteGestureRef.current;
    if (sGesture) {
      const p = clampPoint(point);
      sGesture.to = p;
      if (sGesture.mode === "move") spriteTools.dragTo(p);
      else if ((sGesture.mode === "click" || sGesture.mode === "select") && Math.hypot(p.px - sGesture.from.px, p.py - sGesture.from.py) * zoom > 4) sGesture.mode = "marquee";
      hoverRef.current = clampToMap(t);
      hoverPointRef.current = p;
      setCursor(hoverRef.current);
      draw();
      return;
    }
    const gesture = unitGestureRef.current;
    if (gesture) {
      const p = clampPoint(point);
      gesture.to = p;
      if (gesture.mode === "move") unitTools.dragTo(p);
      else if ((gesture.mode === "click" || gesture.mode === "select") && Math.hypot(p.px - gesture.from.px, p.py - gesture.from.py) * zoom > 4) gesture.mode = "marquee";
      hoverRef.current = clampToMap(t);
      hoverPointRef.current = p;
      setCursor(hoverRef.current);
      draw();
      return;
    }
    const lGesture = locationGestureRef.current;
    if (lGesture) {
      const p = clampPoint(point);
      lGesture.to = p;
      if (lGesture.mode === "move" || lGesture.mode === "resize") locationTools.dragTo(p);
      else if (lGesture.mode === "click" && Math.hypot(p.px - lGesture.from.px, p.py - lGesture.from.py) * zoom > 4) lGesture.mode = "create";
      hoverRef.current = clampToMap(t);
      hoverPointRef.current = p;
      setCursor(hoverRef.current);
      draw();
      return;
    }
    const stroking = strokeRef.current;
    if (stroking) {
      // Dragging outside the map keeps painting along the edge, like StarEdit.
      const c = clampToMap(t);
      if (fogPainting) {
        if (c.x !== stroking.x || c.y !== stroking.y) {
          for (const p of linePoints(stroking.x, stroking.y, c.x, c.y).slice(1)) fogTools.paintAt(p.x, p.y);
          strokeRef.current = c;
        }
      } else if (terrainMode === "isom") {
        // The brush itself fires once per diamond, so every move can be forwarded.
        tools.paintAt(c.x, c.y, clampPoint(point));
        strokeRef.current = c;
      } else if (c.x !== stroking.x || c.y !== stroking.y) {
        for (const p of linePoints(stroking.x, stroking.y, c.x, c.y).slice(1)) tools.paintAt(p.x, p.y);
        strokeRef.current = c;
      }
    }
    if (!inMap(t)) {
      if (hoverRef.current) { hoverRef.current = null; hoverPointRef.current = null; draw(); }
      return;
    }
    hoverPointRef.current = point;
    if (locationsEditing) {
      // A handle or a location under the pointer shows what a press would do.
      const h = locationTools.handleAtPoint(point, zoom);
      e.currentTarget.style.cursor = h ? HANDLE_CURSOR[h] : locationTools.pickAt(point) >= 0 ? "move" : "";
    }
    const diamondKey = terrainMode === "isom" ? `${diamondAt(point.px, point.py).x},${diamondAt(point.px, point.py).y}` : "";
    if (spritesEditing || locationsEditing || !hoverRef.current || hoverRef.current.x !== t.x || hoverRef.current.y !== t.y || diamondKey !== hoverDiamondRef.current) {
      hoverRef.current = t;
      hoverDiamondRef.current = diamondKey;
      setCursor(t);
      draw();
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const cGesture = clipGestureRef.current;
    if (cGesture) {
      clipGestureRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      setClipSelection(tileRect(cGesture.from, cGesture.to));
      draw();
      return;
    }
    const dGesture = doodadGestureRef.current;
    if (dGesture) {
      doodadGestureRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (dGesture.mode === "move") doodadTools.endDrag();
      else if (dGesture.mode === "marquee") {
        const tileOf = (v: number) => Math.floor(v / TILE);
        doodadTools.selectInBox({ x0: tileOf(dGesture.from.px), y0: tileOf(dGesture.from.py), x1: tileOf(dGesture.to.px), y1: tileOf(dGesture.to.py) }, dGesture.additive);
      } else if (dGesture.mode === "click") {
        if (!dGesture.additive) doodadTools.select([]);
        doodadTools.placeAt(dGesture.from);
      } else if (!dGesture.additive) {
        doodadTools.select([]);
      }
      draw();
      return;
    }
    const sGesture = spriteGestureRef.current;
    if (sGesture) {
      spriteGestureRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (sGesture.mode === "move") spriteTools.endDrag();
      else if (sGesture.mode === "marquee") spriteTools.selectInBox({ left: sGesture.from.px, top: sGesture.from.py, right: sGesture.to.px, bottom: sGesture.to.py }, sGesture.additive);
      else if (sGesture.mode === "click") {
        if (!sGesture.additive) spriteTools.select([]);
        spriteTools.placeAt(sGesture.from);
      } else if (!sGesture.additive) {
        spriteTools.select([]);
      }
      draw();
      return;
    }
    const gesture = unitGestureRef.current;
    if (gesture) {
      unitGestureRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (gesture.mode === "move") unitTools.endDrag();
      else if (gesture.mode === "marquee") unitTools.selectInBox({ left: gesture.from.px, top: gesture.from.py, right: gesture.to.px, bottom: gesture.to.py }, gesture.additive);
      else if (gesture.mode === "click") {
        if (!gesture.additive) unitTools.select([]);
        unitTools.placeAt(gesture.from);
      } else if (!gesture.additive) {
        unitTools.select([]);
      }
      draw();
      return;
    }
    const lGesture = locationGestureRef.current;
    if (lGesture) {
      locationGestureRef.current = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (lGesture.mode === "move" || lGesture.mode === "resize") locationTools.endDrag();
      else if (lGesture.mode === "create") {
        const box = locationTools.dragRect(lGesture.from, lGesture.to);
        if (box) locationTools.create(box);
      } else if (!lGesture.additive) {
        locationTools.select([]);
      }
      draw();
      return;
    }
    if (!strokeRef.current) return;
    strokeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (fogPainting) fogTools.endStroke(); else tools.endStroke();
    draw();
  };

  const onLeave = (e: React.PointerEvent<HTMLDivElement>) => { hoverRef.current = null; hoverPointRef.current = null; e.currentTarget.style.cursor = ""; draw(); };
  const onContextMenu = (e: React.MouseEvent) => {
    // While placing, a right-click leaves placement mode instead of opening the menu.
    if (unitPlacing) { e.preventDefault(); unitTools.stopPlacing(); draw(); return; }
    if (doodadPlacing) { e.preventDefault(); doodadTools.stopPlacing(); draw(); return; }
    if (spritePlacing) { e.preventDefault(); spriteTools.stopPlacing(); draw(); return; }
    if (clipPasting) { e.preventDefault(); clipTools.stopPasting(); draw(); return; }
    if (locationsEditing && hoverPointRef.current) {
      // Right-clicking a location selects it so the menu's items act on it.
      const hit = locationTools.pickAt(hoverPointRef.current);
      if (hit >= 0 && !selectedLocations.includes(hit)) locationTools.select([hit]);
    }
    menuTileRef.current = hoverRef.current;
    menuPointRef.current = hoverPointRef.current;
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    if (locationsEditing) {
      const hit = locationTools.pickAt(pointAt(e));
      if (hit < 0) return;
      if (!selectedLocations.includes(hit)) locationTools.select([hit]);
      open("locationProperties", { index: hit });
      return;
    }
    if (spritesEditing) {
      const hit = spriteTools.pickAt(pointAt(e));
      if (hit < 0) return;
      const indices = selectedSprites.includes(hit) ? selectedSprites : [hit];
      if (indices !== selectedSprites) spriteTools.select(indices);
      open("spriteProperties", { indices });
      return;
    }
    if (!unitsEditing) return;
    const hit = unitTools.pickAt(pointAt(e));
    if (hit < 0) return;
    const indices = selectedUnits.includes(hit) ? selectedUnits : [hit];
    if (indices !== selectedUnits) unitTools.select(indices);
    open("unitProperties", { indices });
  };

  const withMenuTile = (fn: (x: number, y: number) => void) => () => {
    const t = menuTileRef.current;
    if (t) fn(t.x, t.y);
  };

  const ctxItems: { label: string; onSelect?: () => void; disabled?: boolean; sep?: boolean }[] = [
    ...(layer === "units"
      ? [
          {
            label: "Unit Properties…",
            disabled: selectedUnits.length === 0,
            onSelect: () => open("unitProperties", { indices: selectedUnits }),
          },
          { label: `Delete ${selectedUnits.length > 1 ? `${selectedUnits.length} Units` : "Unit"}`, disabled: selectedUnits.length === 0, onSelect: () => unitTools.deleteSelected() },
        ]
      : []),
    ...(layer === "doodads"
      ? [
          { label: `Delete ${selectedDoodads.length > 1 ? `${selectedDoodads.length} Doodads` : "Doodad"}`, disabled: selectedDoodads.length === 0, onSelect: () => doodadTools.deleteSelected() },
          {
            label: "Pick Doodad Here",
            disabled: !scenario || !menuTileRef.current || doodadTools.pickAt(menuTileRef.current.x, menuTileRef.current.y) < 0,
            onSelect: withMenuTile((x, y) => {
              const hit = doodadTools.pickAt(x, y);
              const rec = hit >= 0 ? scenario?.doodads[hit] : null;
              if (rec) doodadTools.startPlacing(rec.doodadId);
            }),
          },
        ]
      : []),
    ...(layer === "fog"
      ? [
          { label: fogMode === "fog" ? "Fill Area with Fog" : "Clear Fog in Area", onSelect: withMenuTile(fogTools.fillAt), disabled: !fogPainting },
          { label: "Pick Fogged Players Here", onSelect: withMenuTile(fogTools.pickAt), disabled: !fogPainting },
        ]
      : []),
    ...(layer === "locations"
      ? [
          { label: "Location Properties…", disabled: selectedLocations.length === 0, onSelect: () => open("locationProperties", { index: selectedLocations[0] }) },
          { label: `Delete ${selectedLocations.length > 1 ? `${selectedLocations.length} Locations` : "Location"}`, disabled: !selectedLocations.some((i) => i !== ANYWHERE_INDEX), onSelect: () => locationTools.deleteSelected() },
          { label: "New Location Here", disabled: !locationsEditing, onSelect: withMenuTile((x, y) => locationTools.create({ left: x * TILE, top: y * TILE, right: (x + 4) * TILE, bottom: (y + 4) * TILE })) },
        ]
      : []),
    ...(layer === "sprites"
      ? [
          { label: "Sprite Properties…", disabled: selectedSprites.length === 0, onSelect: () => open("spriteProperties", { indices: selectedSprites }) },
          { label: `Delete ${selectedSprites.length > 1 ? `${selectedSprites.length} Sprites` : "Sprite"}`, disabled: selectedSprites.length === 0, onSelect: () => spriteTools.deleteSelected() },
        ]
      : []),
    ...(layer === "terrain"
      ? [
          { label: terrainMode === "rect" || terrainMode === "isom" ? "Pick Terrain" : terrainMode === "blend" ? "Blend From Here" : "Pick Tile", onSelect: withMenuTile((x, y) => tools.pickAt(x, y, menuPointRef.current ?? undefined)), disabled: !scenario },
          { label: "Fill Area", onSelect: withMenuTile(tools.fillAt), disabled: !painting || terrainMode === "isom" },
        ]
      : []),
    { label: "", sep: true },
    { label: "Cut", disabled: !clipTools.source(), onSelect: () => { clipTools.cut(); } },
    { label: "Copy", disabled: !clipTools.source(), onSelect: () => { clipTools.copy(); } },
    // Paste Here stamps at the clicked tile straight away; Paste arms the layer so the clip follows the pointer.
    { label: "Paste Here", disabled: !scenario || !clip, onSelect: withMenuTile((x, y) => { clipTools.pasteAt(x, y); }) },
    { label: "Paste", disabled: !scenario || !clip, onSelect: () => { clipTools.paste(); } },
    { label: "", sep: true },
    { label: "Center Minimap Here", onSelect: () => open("notImplemented", { feature: "Center Minimap" }) },
    { label: "Map Properties…", onSelect: () => open("mapProperties") },
  ];
  // What plugins registered for the map, after their own separator.
  const pluginRows = pluginContextRows(pluginContextItems, "viewport", {
    surface: "viewport",
    tile: menuTileRef.current,
    point: menuPointRef.current,
    layer,
    terrainMode,
    terrain: activeTerrain,
    markedArea: clipSelection,
  });
  if (pluginRows.length > 0) ctxItems.push({ label: "", sep: true }, ...pluginRows.map((r) => ({ label: r.label, disabled: r.disabled, onSelect: r.onSelect })));

  return (
    <div className="viewport">
      <div className="ruler-corner"><Crosshair size={11} /></div>
      <div className="ruler top"><canvas ref={topRef} /></div>
      <div className="ruler left"><canvas ref={leftRef} /></div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div ref={scrollerRef} className="scroller" onScroll={draw} tabIndex={0}>
            <div
              ref={surfaceRef}
              className={`map-surface ${painting || fogPainting ? "painting" : ""} ${unitPlacing || doodadPlacing || spritePlacing || clipPasting ? "placing" : ""}`}
              style={{ width: worldW, height: worldH }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={onLeave}
              onContextMenu={onContextMenu}
              onDoubleClick={onDoubleClick}
            >
              <canvas ref={canvasRef} style={{ position: "sticky", top: 0, left: 0 }} />
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="menu-content">
            {ctxItems.map((it, i) =>
              it.sep ? (
                <ContextMenu.Separator key={i} className="menu-separator" />
              ) : (
                <ContextMenu.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect}>
                  {it.label}
                </ContextMenu.Item>
              ),
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {scenario && tilesetLoading && (
        <div className="viewport-loading" role="status" aria-live="polite">
          <Loader2 size={16} className="spin" aria-hidden />
          <span>Loading {tileset.name} terrain…</span>
        </div>
      )}
      {unitError && (layer === "units" || layer === "sprites") && scenario && (
        <div className="viewport-notice" role="status">
          <strong>No unit graphics.</strong> Run <code>node scripts/extract-units.mjs</code> against a StarCraft
          install to fill <code>public/arr</code> and <code>public/unit</code>; units are drawn as player-coloured markers until then.
        </div>
      )}
      {tilesetError && (
        <div className="viewport-notice" role="status">
          <strong>No tileset graphics.</strong> Run <code>node scripts/extract-tilesets.mjs</code> against a
          StarCraft install to fill <code>public/tileset/</code>; terrain is drawn as flat colour until then.
        </div>
      )}
      <div className="map-hud">
        <span className="hud-chip"><b>{tileset.name}</b></span>
        <span className="hud-chip">{mapW}×{mapH}</span>
        <span className="hud-chip">{Math.round(zoom * 100)}%</span>
        {tilesetLoading && <span className="hud-chip">loading tileset…</span>}
        {unitPlacing && <span className="hud-chip">placing <b>{unitName(activeUnit)}</b> · Esc / right-click to stop</span>}
        {spritePlacing && <span className="hud-chip">placing sprite <b>{spriteName(unitAssets, activeSpriteKind, activeSpriteKind === "pure" ? activeSprite : activeUnitSprite)}</b>{spritePlaceOptions.flipped ? " · flipped" : ""} · Esc / right-click to stop</span>}
        {doodadPlacing && doodadTools.activeDef() && <span className="hud-chip">placing <b>{doodadLabel(doodadTools.activeDef()!)}</b>{doodadPlacement.placeAnywhere ? " · anywhere" : ""} · Esc / right-click to stop</span>}
        {locationsEditing && <span className="hud-chip">locations · drag empty ground to create · snap <b>{locationSnap ? `${locationSnap} px` : "off"}</b></span>}
        {clipEditing && !clipPasting && (
          <span className="hud-chip">
            cut / copy / paste · drag to mark an area{clipSelection && <> · <b>{clipSelection.x1 - clipSelection.x0}×{clipSelection.y1 - clipSelection.y0}</b> at {clipSelection.x0}, {clipSelection.y0}</>} · Ctrl+C copies{clip && " · Ctrl+V pastes"}
          </span>
        )}
        {clipPasting && clip && <span className="hud-chip">pasting <b>{clipSummary(clip)}</b> · click to stamp · Esc / right-click to stop</span>}
        {showFog && <span className="hud-chip">fog of war <b>P{fogViewPlayer + 1}</b>{fogPainting && <> · {fogMode === "fog" ? "painting" : "clearing"} · Shift inverts</>}</span>}
      </div>
    </div>
  );
}
