/**
 * Terrain from Image — the first scmJS plugin, and the worked example for the plugin
 * API (docs/plugins.md).
 *
 * File ▸ Import ▸ Terrain from Image… (or the terrain palette's context menu, which
 * targets the marked area when there is one) opens a dialog: pick a picture, choose the
 * terrains it may become and how a pixel is matched to one, preview, apply. Apply is one
 * `api.document.edit` transaction — one undo step — painting every lattice diamond in
 * the target with the isometric brush so cliffs and shores are generated at the
 * boundaries, or stamping flat pairs when the map has no ISOM (or the user asks for
 * tiles).
 *
 * Plain DOM only: a plugin's dialog is an element the host hands over, so this file
 * carries a tiny `h()` builder and its own scoped stylesheet.
 */
import type { ContextMenuContext, PluginApi, Rect, TerrainType } from "../../src/plugins/api";
import { cellsByTerrain, countCells, matchTerrains, unpack, type MatchMode, type TerrainChoice } from "./convert";

/* ── DOM helpers ────────────────────────────────────────── */

type Child = Node | string | null | undefined | false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "className") el.className = String(v);
      else if (k === "style") el.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && typeof v !== "string") (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const hex = (color: number) => `#${color.toString(16).padStart(6, "0")}`;

const STYLE = `
.tfi { display: flex; flex-direction: column; gap: 10px; font-size: 12px; }
.tfi .tfi-row { display: flex; align-items: center; gap: 8px; }
.tfi .tfi-row > label { min-width: 72px; color: var(--text-dim, #99a2b3); }
.tfi .tfi-split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: start; }
.tfi .tfi-terrains { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow: auto; padding: 4px; border: 1px solid var(--border, #333); background: var(--bg-0, #111); }
.tfi .tfi-terrains label { display: flex; align-items: center; gap: 6px; height: 20px; cursor: default; }
.tfi .tfi-swatch { width: 14px; height: 14px; border: 1px solid rgba(0,0,0,.6); box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); }
.tfi .tfi-preview { display: flex; flex-direction: column; gap: 6px; align-items: center; }
.tfi .tfi-preview canvas { image-rendering: pixelated; border: 1px solid var(--border, #333); background: #000; max-width: 100%; }
.tfi .tfi-hint { color: var(--text-dim, #99a2b3); }
.tfi .tfi-num { width: 64px; }
.tfi .tfi-count { margin-left: auto; color: var(--text-faint, #6b7382); font-variant-numeric: tabular-nums; }
`;

/* ── Image sampling ─────────────────────────────────────── */

/** Decode a picked file into a bitmap the canvas can draw. */
async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("The file is not an image the browser can decode."));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

const sizeOf = (img: ImageBitmap | HTMLImageElement) => ("naturalWidth" in img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: img.width, h: img.height });

/**
 * One RGBA sample per target cell: the picture scaled to `width × height`, stepping down
 * by halves first so a large downscale averages its pixels rather than skipping them.
 */
function resampleImage(img: ImageBitmap | HTMLImageElement, width: number, height: number): Uint8ClampedArray {
  let { w, h: hh } = sizeOf(img);
  let src: CanvasImageSource = img;
  while (w / 2 >= width && hh / 2 >= height) {
    w = Math.max(1, Math.floor(w / 2));
    hh = Math.max(1, Math.floor(hh / 2));
    const step = document.createElement("canvas");
    step.width = w;
    step.height = hh;
    const ctx = step.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, hh);
    src = step;
  }
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

/* ── The dialog ─────────────────────────────────────────── */

type Method = "isom" | "tiles";

interface State {
  file: File | null;
  image: ImageBitmap | HTMLImageElement | null;
  target: "map" | "marked" | "custom";
  custom: Rect;
  method: Method;
  mode: MatchMode;
  smooth: number;
  /** Terrain ids ticked, in palette order. */
  chosen: Set<number>;
}

function openDialog(api: PluginApi, marked: Rect | null) {
  const info = api.document.info();
  if (!info) { api.ui.status("Open or create a map first."); return; }
  const mapRect: Rect = { x0: 0, y0: 0, x1: info.width, y1: info.height };
  const state: State = {
    file: null,
    image: null,
    target: marked ? "marked" : "map",
    custom: marked ?? mapRect,
    method: api.terrain.hasIsom() ? "isom" : "tiles",
    mode: "color",
    smooth: api.storage.get("smooth", 1),
    chosen: new Set(),
  };
  let types: TerrainType[] = [];
  let isomIds = new Set<number>();
  let grid: Int32Array | null = null;
  let choices: TerrainChoice[] = [];

  api.ui.dialog({
    title: "Terrain from Image",
    size: "lg",
    tall: true,
    buttons: [
      { label: "Apply", primary: true, run: () => apply() },
      { label: "Cancel" },
    ],
    mount(body) {
      const root = h("div", { className: "tfi" });
      root.append(h("style", null, STYLE));
      body.append(root);

      const fileName = h("span", { className: "tfi-hint" }, "no image chosen");
      const pickBtn = h("button", { className: "btn", type: "button", onClick: () => { void pick(); } }, "Choose Image…");
      root.append(h("div", { className: "tfi-row" }, h("label", null, "Image"), pickBtn, fileName));

      const targetSel = h("select", { className: "select", style: "width: auto", "aria-label": "Target area", onChange: () => { state.target = targetSel.value as State["target"]; syncCustom(); update(); } },
        h("option", { value: "map" }, `Whole map (${info.width} × ${info.height})`),
        marked ? h("option", { value: "marked" }, `Marked area (${marked.x1 - marked.x0} × ${marked.y1 - marked.y0} at ${marked.x0}, ${marked.y0})`) : null,
        h("option", { value: "custom" }, "Custom rectangle"),
      );
      targetSel.value = state.target;
      const num = (label: string, get: () => number, set: (v: number) => void) => {
        const input = h("input", { className: "input tfi-num", type: "number", min: 0, step: 1, "aria-label": label, onChange: () => { set(Number(input.value) || 0); update(); } });
        input.value = String(get());
        return input;
      };
      const cx = num("Left", () => state.custom.x0, (v) => { state.custom = { ...state.custom, x0: v }; });
      const cy = num("Top", () => state.custom.y0, (v) => { state.custom = { ...state.custom, y0: v }; });
      const cw = num("Width", () => state.custom.x1 - state.custom.x0, (v) => { state.custom = { ...state.custom, x1: state.custom.x0 + v }; });
      const ch = num("Height", () => state.custom.y1 - state.custom.y0, (v) => { state.custom = { ...state.custom, y1: state.custom.y0 + v }; });
      const customRow = h("div", { className: "tfi-row" }, h("label", null, "Rectangle"), h("span", { className: "tfi-hint" }, "x"), cx, h("span", { className: "tfi-hint" }, "y"), cy, h("span", { className: "tfi-hint" }, "w"), cw, h("span", { className: "tfi-hint" }, "h"), ch);
      root.append(h("div", { className: "tfi-row" }, h("label", null, "Target"), targetSel), customRow);
      const syncCustom = () => {
        customRow.style.display = state.target === "custom" ? "" : "none";
        cx.value = String(state.custom.x0); cy.value = String(state.custom.y0);
        cw.value = String(state.custom.x1 - state.custom.x0); ch.value = String(state.custom.y1 - state.custom.y0);
      };
      syncCustom();

      const isomOk = api.terrain.hasIsom();
      const methodIsom = h("input", { type: "radio", name: "tfi-method", value: "isom", disabled: !isomOk, onChange: () => { state.method = "isom"; rebuildTerrainList(); update(); } });
      const methodTiles = h("input", { type: "radio", name: "tfi-method", value: "tiles", onChange: () => { state.method = "tiles"; rebuildTerrainList(); update(); } });
      (state.method === "isom" ? methodIsom : methodTiles).checked = true;
      root.append(h("div", { className: "tfi-row" },
        h("label", null, "Paint as"),
        h("label", { className: "check", title: "Paint every lattice diamond with the isometric brush: cliffs and shorelines are generated at the boundaries" }, methodIsom, "Isometric terrain"),
        h("label", { className: "check", title: "Stamp flat tile pairs only; the ISOM is left alone (Rebuild ISOM from Tiles afterwards to use the isometric brush)" }, methodTiles, "Flat tiles"),
        !isomOk ? h("span", { className: "tfi-hint" }, "— this map has no ISOM section") : null,
      ));

      const modeSel = h("select", { className: "select", style: "width: auto", "aria-label": "Match by", onChange: () => { state.mode = modeSel.value as MatchMode; update(); } },
        h("option", { value: "color" }, "Nearest colour"),
        h("option", { value: "brightness" }, "Brightness bands (heightmap)"),
      );
      const smoothSel = h("select", { className: "select", style: "width: auto", "aria-label": "Smoothing", onChange: () => { state.smooth = Number(smoothSel.value); api.storage.set("smooth", state.smooth); update(); } },
        ...[0, 1, 2, 3].map((n) => h("option", { value: String(n) }, n === 0 ? "None" : `${n} cell${n === 1 ? "" : "s"}`)),
      );
      smoothSel.value = String(state.smooth);
      root.append(h("div", { className: "tfi-row" }, h("label", null, "Match by"), modeSel, h("label", { style: "min-width: 0" }, "Smooth"), smoothSel));

      const terrainList = h("div", { className: "tfi-terrains", role: "group", "aria-label": "Terrains to use" });
      const terrainHint = h("div", { className: "tfi-hint" });
      const preview = h("canvas", { width: 1, height: 1 });
      const summary = h("div", { className: "tfi-hint" }, "Choose an image to preview.");
      root.append(h("div", { className: "tfi-split" },
        h("div", null, terrainList, terrainHint),
        h("div", { className: "tfi-preview" }, preview, summary),
      ));

      const counts = new Map<number, HTMLElement>();
      const rebuildTerrainList = () => {
        terrainList.replaceChildren();
        counts.clear();
        const list = state.method === "isom" ? types.filter((t) => isomIds.has(t.id)) : types;
        // Everything ticked the first time round; keep the user's choice after that.
        if (state.chosen.size === 0) for (const t of list) state.chosen.add(t.id);
        for (const t of list) {
          const tick = h("input", { type: "checkbox", checked: state.chosen.has(t.id), onChange: () => { if (tick.checked) state.chosen.add(t.id); else state.chosen.delete(t.id); update(); } });
          const color = api.terrain.terrainColor(t.id);
          const count = h("span", { className: "tfi-count" });
          counts.set(t.id, count);
          terrainList.append(h("label", { className: "check" }, tick, h("span", { className: "tfi-swatch", style: `background:${color === null ? "#000" : hex(color)}` }), t.name, count));
        }
        terrainHint.textContent = state.mode === "brightness"
          ? "Brightness bands run dark → light in this order."
          : list.length === 0 ? "No terrain types — the tileset graphics are not installed." : "";
      };

      const targetRect = (): Rect => {
        const r = state.target === "marked" && marked ? marked : state.target === "custom" ? state.custom : mapRect;
        return { x0: Math.max(0, Math.min(r.x0, r.x1)), y0: Math.max(0, Math.min(r.y0, r.y1)), x1: Math.min(info.width, Math.max(r.x0, r.x1)), y1: Math.min(info.height, Math.max(r.y0, r.y1)) };
      };

      const update = () => {
        terrainHint.textContent = state.mode === "brightness" ? "Brightness bands run dark → light in this order." : "";
        const rect = targetRect();
        const gw = rect.x1 - rect.x0, gh = rect.y1 - rect.y0;
        choices = (state.method === "isom" ? types.filter((t) => isomIds.has(t.id)) : types)
          .filter((t) => state.chosen.has(t.id))
          .map((t) => ({ id: t.id, color: api.terrain.terrainColor(t.id) ?? 0 }));
        if (!state.image || gw <= 0 || gh <= 0) {
          grid = null;
          summary.textContent = !state.image ? "Choose an image to preview." : "The target rectangle is empty.";
          preview.width = preview.height = 1;
          return;
        }
        const rgba = resampleImage(state.image, gw, gh);
        grid = matchTerrains(rgba, gw, gh, { terrains: choices, mode: state.mode, smooth: state.smooth });
        // Preview: each cell in its terrain's swatch colour.
        preview.width = gw;
        preview.height = gh;
        const scale = Math.max(1, Math.min(Math.floor(320 / gw), Math.floor(320 / gh)));
        preview.style.width = `${gw * scale}px`;
        preview.style.height = `${gh * scale}px`;
        const ctx = preview.getContext("2d")!;
        const img = ctx.createImageData(gw, gh);
        const colorOf = new Map(choices.map((c) => [c.id, unpack(c.color)]));
        for (let i = 0; i < grid.length; i++) {
          const c = colorOf.get(grid[i]);
          if (!c) continue;
          img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
        const per = countCells(grid, choices);
        for (const el of counts.values()) el.textContent = "";
        choices.forEach((c, i) => { const el = counts.get(c.id); if (el) el.textContent = String(per[i]); });
        const painted = per.reduce((a, b) => a + b, 0);
        summary.textContent = `${gw} × ${gh} cells at ${rect.x0}, ${rect.y0} — ${painted} painted, ${choices.length} terrain${choices.length === 1 ? "" : "s"}`;
      };

      const pick = async () => {
        const [file] = await api.ui.pickFiles({ accept: "image/*" });
        if (!file) return;
        try {
          state.image = await decodeImage(file);
          state.file = file;
          const { w, h: hh } = sizeOf(state.image);
          fileName.textContent = `${file.name} (${w} × ${hh})`;
          fileName.className = "";
        } catch (err) {
          fileName.textContent = err instanceof Error ? err.message : String(err);
          fileName.className = "error-text";
        }
        update();
      };

      // The terrain list needs the tileset graphics; they may still be loading.
      terrainHint.textContent = "Loading tileset…";
      void api.tileset.load().then(() => {
        types = api.terrain.types();
        isomIds = new Set(api.terrain.isomTypes());
        if (state.method === "isom" && isomIds.size === 0) { state.method = "tiles"; methodTiles.checked = true; methodIsom.disabled = true; }
        rebuildTerrainList();
        update();
      });

      return () => { if (state.image && "close" in state.image) state.image.close(); };
    },
  });

  const apply = (): boolean => {
    if (!grid || !state.file) { api.ui.status("Choose an image first."); return false; }
    const g = grid;
    const r = state.target === "marked" && marked ? marked : state.target === "custom" ? state.custom : mapRect;
    const rect: Rect = { x0: Math.max(0, Math.min(r.x0, r.x1)), y0: Math.max(0, Math.min(r.y0, r.y1)), x1: Math.min(info.width, Math.max(r.x0, r.x1)), y1: Math.min(info.height, Math.max(r.y0, r.y1)) };
    const gw = rect.x1 - rect.x0, gh = rect.y1 - rect.y0;
    if (gw <= 0 || gh <= 0) return false;
    const label = `Terrain from image (${state.file.name})`;
    const result = api.document.edit(label, (tx) => {
      if (state.method === "isom") {
        let refused = 0;
        for (const d of api.terrain.diamondsIn(rect)) {
          // A diamond is centred on tile column 2x, row y; sample the cell under it (clamped at the far edges).
          const cx = Math.min(gw - 1, Math.max(0, 2 * d.x - rect.x0));
          const cy = Math.min(gh - 1, Math.max(0, d.y - rect.y0));
          const id = g[cy * gw + cx];
          if (id < 0) continue;
          if (!tx.paintIsom(d, id, 1)) refused++;
        }
        if (refused > 0) tx.note(`${refused} diamonds could not take their terrain`);
      } else {
        for (const [id, cells] of cellsByTerrain(g, gw, gh, rect.x0, rect.y0, info.width)) tx.stampTerrain(cells, id);
      }
    });
    if (!result.changed) { api.ui.status(`${label} — nothing changed`); return true; }
    api.ui.status(`${label} — ${result.tiles} tile${result.tiles === 1 ? "" : "s"}${result.isom > 0 ? ", ISOM updated" : ""}${result.notes.length > 0 ? `; ${result.notes.join(", ")}` : ""}`);
    return true;
  };
}

/* ── Activation ─────────────────────────────────────────── */

export default function activate(api: PluginApi) {
  const label = (ctx: ContextMenuContext) => (ctx.markedArea ? "Terrain from Image into Marked Area…" : "Terrain from Image…");
  api.menu.add("File/Import", { label: "Terrain from Image…", enabled: () => api.document.isOpen(), run: () => openDialog(api, null) });
  api.contextMenu.add("terrainPalette", { label, enabled: () => api.document.isOpen(), run: (ctx) => openDialog(api, ctx.markedArea) });
  api.contextMenu.add("viewport", {
    label,
    visible: (ctx) => ctx.layer === "terrain" || ctx.layer === "clipboard",
    enabled: () => api.document.isOpen(),
    run: (ctx) => openDialog(api, ctx.markedArea),
  });
}
