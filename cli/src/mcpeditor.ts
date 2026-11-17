/** The MCP tools for a map linked to the editor in the person's browser (`scmjs map open --live`). */
import { z } from "zod";
import { expectKind, readInput, openMap } from "./files";
import { locationIndex } from "./objects";
import { allLinks, linkFor, openLink, type Link } from "./link";
import { CliError, visible, nearPath, printErr } from "./ui";
import { path, ok, tool, type Reg } from "./mcpkit";

export function addEditorTools(reg: Reg): void {
  /** The link a tool means: the one for `file`, or the only one there is. */
  const linkOf = async (file: string | undefined): Promise<Link> => {
    if (file !== undefined) {
      const link = await linkFor(file);
      if (!link) throw new CliError(`${nearPath(file)} is not linked to the editor`, "editor_open links it.", 2);
      return link;
    }
    const links = await allLinks();
    if (links.length === 1) return links[0];
    if (!links.length) throw new CliError("No map is linked to the editor", "editor_open links one.", 2);
    throw new CliError(`${links.length} maps are linked to the editor: ${links.map((l) => nearPath(l.path)).join(", ")}`, "Name one with `path`.", 2);
  };
  const linked = z.string().optional().describe("the linked map's file; may be left out when one map is linked");
  const tilesRect = z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }).describe("a rectangle in tiles (a tile is 32 pixels), x1 and y1 exclusive");

  reg("editor_open", {
    title: "Link a map to the editor",
    description: "Open a map in the scmJS editor in the person's browser and keep it linked (scmjs map open --live), so they watch the work. While a map is linked, every tool here that takes its path reads the map as the editor has it, unsaved changes included, and a tool that changes it changes it in the editor as one undo step: nothing is written to the file until editor_save or the person's own Save. The link lasts until the map or the page beside it is closed, editor_close, or this server stops. Opens a browser tab, and waits up to two minutes for the editor to take the map.",
    inputSchema: { path },
    annotations: { openWorldHint: true },
  }, tool(async ({ path: file }) => {
    const input = await readInput(file);
    expectKind(input, "map");
    const owner = await openLink(file, input.bytes, { say: (...l) => { for (const line of l) printErr(visible(line)); } });
    return ok(`${owner.name} is open in the editor and linked. Tools that change ${nearPath(file)} now change it there, one undo step each; editor_save writes the file.`, { name: owner.name, path: owner.path, linked: true });
  }));

  reg("editor_state", {
    title: "What the person is looking at",
    description: "The linked map in the editor right now: whether it has unsaved changes, the layer in use, the zoom, the part of the map in view (tiles), and the selection: units (index as map_units and map_edit count it, type, player 1-12, position in pixels), locations (number as map_locations and map_edit count it, name, bounds in pixels), doodads and sprites (indices), and the marked area (tiles). Use it for requests about \"these units\", \"this location\" or \"here\".",
    inputSchema: { path: linked },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file }) => {
    const link = await linkOf(file);
    const s = (await link.call("state")).result as { name: string; modified: boolean; layer: string; zoom: number; size: { width: number; height: number }; view: { x0: number; y0: number; x1: number; y1: number }; selection: { units: { index: number; type: string; player: number; x: number; y: number }[]; locations: { number: number; name: string }[]; doodads: number[]; sprites: number[]; area: { x0: number; y0: number; x1: number; y1: number } | null } };
    const sel = s.selection;
    const lines = [
      `${s.name}: ${s.size.width} × ${s.size.height}${s.modified ? ", unsaved changes" : ", saved"}; ${s.layer} layer at ${Math.round(s.zoom * 100)}%`,
      `In view: tiles ${s.view.x0},${s.view.y0} to ${s.view.x1},${s.view.y1}`,
      sel.units.length ? `Selected units (${sel.units.length}): ${sel.units.slice(0, 40).map((u) => `#${u.index} ${u.type} P${u.player} at ${u.x},${u.y}`).join("; ")}${sel.units.length > 40 ? "; …" : ""}` : null,
      sel.locations.length ? `Selected locations: ${sel.locations.map((l) => `${l.number} "${l.name}"`).join("; ")}` : null,
      sel.doodads.length ? `Selected doodads: ${sel.doodads.join(", ")}` : null,
      sel.sprites.length ? `Selected sprites: ${sel.sprites.join(", ")}` : null,
      sel.area ? `Marked area: tiles ${sel.area.x0},${sel.area.y0} to ${sel.area.x1},${sel.area.y1}` : null,
    ].filter((l): l is string => l !== null);
    if (lines.length === 2) lines.push("Nothing is selected.");
    return ok(lines, s);
  }));

  reg("editor_show", {
    title: "Show the person a place",
    description: "Bring a part of the linked map into the editor's view and flash it: a rectangle in tiles, units by index (they are selected too) or locations by name or number. Use it to point at what you changed or what you are asking about. It moves the person's view, so call it when they would want to look.",
    inputSchema: {
      path: linked,
      rect: tilesRect.optional(),
      units: z.array(z.number().int().min(0)).optional().describe("unit indices, as map_units and editor_state list them (from 0)"),
      locations: z.array(z.union([z.string(), z.number().int().min(1)])).optional().describe("locations, each by name or by number as map_locations lists it (from 1)"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, rect, units, locations }) => {
    const link = await linkOf(file);
    // Names and numbers are the commands' way to say a location; the editor is told the slots.
    const slots = locations?.length ? await (async () => { const { doc } = await openMap(link.path); return locations.map((l) => locationIndex(doc.scenario, l)); })() : undefined;
    const r = (await link.call("show", { rect, units, locations: slots })).result as { rect: { x0: number; y0: number; x1: number; y1: number } };
    return ok(`The editor shows tiles ${r.rect.x0},${r.rect.y0} to ${r.rect.x1},${r.rect.y1} of ${link.name}.`, r);
  }));

  reg("editor_picture", {
    title: "The map as the editor draws it",
    description: "A picture of the linked map from the editor, drawn with the game's graphics the editor has, units, sprites and locations included: what the person sees, so it needs no copy of StarCraft here. By default the part in view; `rect` for other tiles, `whole` for the whole map. The result is a PNG image.",
    inputSchema: {
      path: linked,
      rect: tilesRect.optional(),
      whole: z.boolean().optional().describe("the whole map rather than the part in view"),
      locations: z.boolean().optional().describe("false to leave the locations out"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, rect, whole, locations }) => {
    const link = await linkOf(file);
    const a = await link.call("picture", { rect, whole, locations });
    if (!a.bytes) throw new CliError("The editor sent no picture");
    const r = a.result as { rect: { x0: number; y0: number; x1: number; y1: number }; pixelsPerTile: number };
    const text = `${link.name}: tiles ${r.rect.x0},${r.rect.y0} to ${r.rect.x1},${r.rect.y1} at ${r.pixelsPerTile} px a tile, as the editor draws it`;
    return { content: [{ type: "image", data: Buffer.from(a.bytes).toString("base64"), mimeType: "image/png" }, { type: "text", text }], structuredContent: { ...r, bytes: a.bytes.length } };
  }));

  reg("editor_save", {
    title: "Save the linked map",
    description: "The editor's Save for the linked map: the file on disk is written with everything changed since, by the tools and by the person. Until then the changes exist only in the editor.",
    inputSchema: { path: linked },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file }) => {
    const link = await linkOf(file);
    await link.call("save");
    return ok(`Saved: ${nearPath(link.path)} is as the editor has it.`, { path: link.path, saved: true });
  }));

  reg("editor_close", {
    title: "End the link",
    description: "End the link to the editor. The map stays open there with any unsaved changes, as an ordinary open map; the tools go back to reading and writing the file. Save first (editor_save) if the file should have the changes.",
    inputSchema: { path: linked },
  }, tool(async ({ path: file }) => {
    const link = await linkOf(file);
    await link.close();
    return ok(`${link.name} is no longer linked. The tools read and write ${nearPath(link.path)} again.`, { path: link.path, linked: false });
  }));
}
