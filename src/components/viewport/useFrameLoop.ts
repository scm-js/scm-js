import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useSetAtom, type Atom, type ExtractAtomValue, type useStore } from "jotai";
import { tileBlockAtom } from "../../atoms/tileBlockAtoms";
import {
  activeDoodadAtom, activeSpriteAtom, activeSpriteKindAtom, activeTerrainAtom, activeTileAtom, activeUnitAtom, activeUnitSpriteAtom,
  doodadPlacementAtom, fogPlayersAtom, locationSnapAtom, rectVariationAtom, spritePlaceOptionsAtom, unitOwnerAtom, viewportRepaintAtom,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import { unitsRevisionAtom, type scenarioAtom } from "../../atoms/documentAtoms";
import { mapToolRevisionAtom, pluginOverlayRevisionAtom, viewFlashesAtom } from "../../atoms/pluginAtoms";
import type { TilesetState } from "../../hooks/useTileset";
import { onGrpLoaded } from "../../formats/units/load";
import type { UnitAnimator } from "../../formats/units/animate";
import { setAtlasStep } from "../../formats/tileset/atlas";
import { cycleStepAt, GAME_FRAME_MS } from "../../formats/tileset/cycle";
import { UNIT_MARGIN } from "./paint/objects";
import { TILE } from "./paint/view";

/** The least time between two frames of Remastered's water or lava. */
const EFFECT_FRAME_MS = 1000 / 30;

/**
 * What `draw` reaches without closing over it — a revision of something mutated in place, a
 * palette choice the tools read from the store when asked for a ghost. A change to any of
 * them is a repaint and nothing else, so the viewport listens on the store instead of
 * rendering for it.
 */
const REPAINT_ATOMS: readonly Atom<unknown>[] = [
  activeTileAtom, activeTerrainAtom, rectVariationAtom, tileBlockAtom,
  unitsRevisionAtom, activeUnitAtom, unitOwnerAtom,
  activeDoodadAtom, doodadPlacementAtom,
  activeSpriteKindAtom, activeSpriteAtom, activeUnitSpriteAtom, spritePlaceOptionsAtom,
  locationSnapAtom, fogPlayersAtom,
  mapToolRevisionAtom, pluginOverlayRevisionAtom, viewportRepaintAtom,
];

/** What the last paint found in view, written by `draw` and read by the animation loop. */
export interface InView {
  /** Whether the last paint blitted any cycling (water/lava) megatile, so the animation loop knows when a repaint shows anything. */
  animatedInViewRef: RefObject<boolean>;
  /** Whether the last paint ran Remastered's water or lava over the terrain, so the loop keeps it moving. */
  movingInViewRef: RefObject<boolean>;
  /** Whether the last paint drew any unit, so the unit animation loop can skip repaints of empty views. */
  unitsInViewRef: RefObject<boolean>;
}

/** The scroller's size in CSS pixels, kept by a `ResizeObserver`. */
export function useViewportSize(scrollerRef: RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  /* ── sizing ──────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [scrollerRef]);
  return size;
}

/**
 * Every repaint request — a pointer move, a scroll, a render that changed what is drawn —
 * goes through one animation frame. A burst of events therefore costs one paint at most,
 * and that paint happens immediately before the browser's own, which is the least latency
 * a canvas can have. `drawRef` is assigned during render so the frame always runs the
 * newest closure; an effect would land after the frame that a render's own request booked.
 */
export function useFrameLoop(draw: () => void, covered: boolean, flashes: ExtractAtomValue<typeof viewFlashesAtom>) {
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const drawPending = useRef(false);
  const drawRaf = useRef(0);
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const scheduleDraw = useCallback(() => {
    drawPending.current = true;
    if (drawRaf.current) return;
    drawRaf.current = requestAnimationFrame(() => {
      drawRaf.current = 0;
      if (!drawPending.current || coveredRef.current) return;
      drawPending.current = false;
      drawRef.current();
    });
  }, []);
  useEffect(() => { if (!covered) scheduleDraw(); }, [covered, scheduleDraw]);
  // The ref has to be cleared as well as the frame cancelled: React's development
  // double-mount runs this cleanup on a component that goes on living, and a stale
  // frame id here would make every later request think one was already booked.
  useEffect(() => () => {
    if (drawRaf.current) cancelAnimationFrame(drawRaf.current);
    drawRaf.current = 0;
    drawPending.current = false;
  }, []);

  // While any flash is live, paint every frame; once the last one has faded, sweep the list (which repaints once more, clean).
  const setFlashes = useSetAtom(viewFlashesAtom);
  useEffect(() => {
    if (flashes.length === 0) return;
    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const live = flashes.filter((f) => f.start + f.ms > now);
      if (live.length !== flashes.length) { setFlashes(live); return; }
      scheduleDraw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flashes, scheduleDraw, setFlashes]);

  return { scheduleDraw, drawRef, drawPending, coveredRef };
}

export type FrameLoop = ReturnType<typeof useFrameLoop>;

interface RepaintsArgs {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  scrollerRef: RefObject<HTMLDivElement | null>;
  size: { w: number; h: number };
  draw: () => void;
  store: ReturnType<typeof useStore>;
  loop: FrameLoop;
  inView: InView;
  tilePx: number;
  flags: ViewFlags;
  tilesetAssets: TilesetState["loaded"];
  scenario: ExtractAtomValue<typeof scenarioAtom>;
  animator: UnitAnimator | null;
  waterSpeed: number;
  unitSpeed: number;
}

/**
 * What books a paint besides an event: a new `draw` (a state change) or a new size, a
 * repaint-only atom, and the water / lava / unit animation. Returns the scale as the frame
 * loops read it.
 */
export function useRepaints(args: RepaintsArgs) {
  const { canvasRef, scrollerRef, size, draw, store, tilePx, flags, tilesetAssets, scenario, animator, waterSpeed, unitSpeed } = args;
  const { scheduleDraw, drawRef, drawPending, coveredRef } = args.loop;
  const { animatedInViewRef, movingInViewRef, unitsInViewRef } = args.inView;

  // `draw` is in the deps on purpose: its identity changes with everything the picture is
  // drawn from, so this effect is how a state change reaches the canvas. Setting width or
  // height clears the bitmap, so only do it when the size really moved — in whole device
  // pixels, which is what a canvas holds: against the fractional product of a display
  // scaled to 125% the comparison never matched and every run reallocated it.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const devW = Math.round(size.w * dpr), devH = Math.round(size.h * dpr);
    if (c.width !== devW || c.height !== devH) {
      c.width = devW;
      c.height = devH;
      c.style.width = `${size.w}px`;
      c.style.height = `${size.h}px`;
    }
    scheduleDraw();
  }, [size, draw, scheduleDraw, canvasRef]);

  // What `draw` reads from the store or from something mutated in place repaints without a
  // render: the frame runs the closure it already has.
  useEffect(() => {
    const stops = REPAINT_ATOMS.map((a) => store.sub(a, scheduleDraw));
    stops.push(onGrpLoaded(scheduleDraw));
    return () => { for (const stop of stops) stop(); };
  }, [store, scheduleDraw]);

  /** The scale as the frame loops and effects below read it, without being re-created by a zoom. */
  const tilePxRef = useRef(tilePx);
  tilePxRef.current = tilePx;
  /* ── water / lava animation ──────────────────────────── */
  useEffect(() => {
    const anim = flags.animateWater ? tilesetAssets?.atlas.animation : undefined;
    const units = flags.animateUnits && (flags.units || flags.sprites) && animator?.enabled ? animator : null;
    // Remastered's water and lava have no steps to wait for: they move every frame they are in view.
    const moving = flags.animateWater && tilesetAssets?.atlas.hd?.effects ? true : false;
    if (!scenario || (!anim && !units && !moving)) return;
    let raf = 0;
    let lastMoved = 0;
    // Both speeds are multiples of the game's own rate (Preferences ▸ Display); moving a
    // slider re-runs this effect, so the frame counter starts again at the new rate.
    let lastFrame = Math.floor((performance.now() * unitSpeed) / GAME_FRAME_MS);
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (coveredRef.current) return;
      const now = performance.now();
      let repaint = false;
      // Palette rotations follow the wall clock, so the phase survives re-mounts and
      // stays in step with the tile browser. Only repaint when something on screen cycles.
      if (anim && tilesetAssets && setAtlasStep(tilesetAssets.atlas, tilesetAssets.tileset, cycleStepAt(now, anim.length, waterSpeed)) && animatedInViewRef.current) repaint = true;
      if (units) {
        // Unit scripts advance once per game frame; after a stall (a hidden tab) catch up
        // by a few frames rather than replaying the whole gap.
        const frame = Math.floor((now * unitSpeed) / GAME_FRAME_MS);
        const steps = Math.min(4, frame - lastFrame);
        lastFrame = frame;
        // Every sprite advances, but only one standing near the view asks for a paint —
        // the same margin the draw pass culls by.
        const el = scrollerRef.current;
        const zoom = tilePxRef.current / TILE;
        const view = el ? {
          left: el.scrollLeft / zoom - UNIT_MARGIN, top: el.scrollTop / zoom - UNIT_MARGIN,
          right: (el.scrollLeft + el.clientWidth) / zoom + UNIT_MARGIN, bottom: (el.scrollTop + el.clientHeight) / zoom + UNIT_MARGIN,
        } : undefined;
        for (let i = 0; i < steps; i++) if (units.tick(view)) repaint = true;
        if (!unitsInViewRef.current) repaint = repaint && animatedInViewRef.current;
      }
      // Thirty frames a second is as smooth as ripples need, and half the repaints of sixty.
      if (moving && movingInViewRef.current && now - lastMoved >= EFFECT_FRAME_MS) repaint = true;
      // A repaint booked for this frame is served here rather than painted twice over.
      if (repaint || drawPending.current) { drawPending.current = false; lastMoved = now; drawRef.current(); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flags.animateWater, flags.animateUnits, flags.units, flags.sprites, tilesetAssets, scenario, animator, waterSpeed, unitSpeed, coveredRef, animatedInViewRef, scrollerRef, unitsInViewRef, movingInViewRef, drawPending, drawRef]);

  return tilePxRef;
}
