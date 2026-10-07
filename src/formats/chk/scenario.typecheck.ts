/**
 * What `markDirty` must refuse and must allow, checked by `npm run build`.
 *
 * Nothing imports this file and nothing in it runs (the same arrangement as
 * `plugins/api.typecheck.ts`): each `@ts-expect-error` line is a call that must not
 * compile, and tsc fails the build the day one of them does.
 */
import { markDirty, strSectionName, unitSettingsSections, type Scenario } from "./scenario";

export function dirtyNames(scn: Scenario, name: string): void {
  markDirty(scn, "UNIT", "STR ", strSectionName(scn), ...unitSettingsSections(scn));
  // @ts-expect-error a misspelt name
  markDirty(scn, "UNTI");
  // @ts-expect-error the trailing space is part of the name
  markDirty(scn, "STR");
  // @ts-expect-error a section the editor carries as bytes has no encoder, so marking it would drop it
  markDirty(scn, "VCOD");
  // @ts-expect-error a name that is only known to be a string
  markDirty(scn, name);
}
