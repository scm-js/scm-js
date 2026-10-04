/**
 * What the plugin API's types must refuse and must allow, checked by `npm run build`.
 *
 * Nothing imports this file and nothing in it runs: each `@ts-expect-error` line is a
 * write a plugin must not be able to compile, and tsc fails the build the day one of them
 * starts compiling. The lines without the comment are the reads and hand-backs that must
 * keep working.
 */
import type { PluginApi, ReadonlyScenario, UnitRecord } from "./api";

export function readonlyScenario(api: PluginApi, scn: ReadonlyScenario): void {
  // @ts-expect-error a record's field
  scn.units[0].x = 5;
  // @ts-expect-error a list's slot
  scn.units[0] = scn.units[1];
  // @ts-expect-error a list's length
  scn.units.push(scn.units[0]);
  // @ts-expect-error a tile
  scn.tiles[0] = 3;
  // @ts-expect-error a typed array's bulk writes
  scn.tiles.fill(0);
  // @ts-expect-error a scalar
  scn.width = 64;
  // @ts-expect-error the dirty set
  scn.dirty.add("UNIT");
  // @ts-expect-error a nested list
  scn.triggers[0].actions.length = 0;
  // @ts-expect-error a nested record
  scn.triggers[0].conditions[0].type = 1;

  api.document.edit("check", (tx) => {
    // @ts-expect-error the transaction's scenario is the same view
    tx.scenario.units.length = 0;

    // Reads, copies, and handing what was read back to the API.
    const moved: UnitRecord[] = scn.units.map((u) => ({ ...u, x: u.x + 32 }));
    tx.addUnits(moved);
    tx.addUnits(scn.units);
    tx.removeUnits(api.selection.units());
    tx.setTile(0, 0, scn.tiles[0]);
  });
  api.triggers.text.print(scn.triggers);
  api.triggers.fingerprint(scn.triggers[0]);
  api.triggers.references(scn.briefing, { briefing: true });
  api.exchange.encodeTrg(scn.triggers);
  void scn.tiles.slice().fill(0);
}
