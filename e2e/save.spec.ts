/**
 * A map goes through the editor and comes out right: opened from a file, changed in a
 * dialog, saved, and the file that was written read back — here, by the format code, and
 * again by the editor.
 *
 * The suites under `tests/` prove the format code and the store's half of a save. What
 * only a browser shows is the rest of the chain: that the dialog's OK reaches the
 * scenario, that the section it touched was marked for writing, and that the bytes the
 * Save button hands the browser are the ones the Save dialog built.
 */
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { test, expect } from "./support/editor";
import type { Scenario } from "./support/formats";

const MAP = join(import.meta.dirname, "../tests/maps/ums.scx");

const hex = (data: Uint8Array) => Buffer.from(data).toString("hex");
/** Every section of a scenario as written, by name — the same name twice keeps both. */
const sections = (scn: Scenario) => scn.chk.sections.map((s) => [s.name, hex(s.data)] as const);

test("a renamed map is saved with the new name and nothing else changed", async ({ editor, formats }, testInfo) => {
  const { page } = editor;
  const { scenarioName, strSectionName } = formats.scenario;
  const before = await formats.read(new Uint8Array(readFileSync(MAP)));
  const oldName = scenarioName(before);
  const newName = `${oldName} (renamed)`;

  await editor.open();
  await editor.dismissGameDataOffer();
  await editor.openMap(MAP);
  await expect(page).toHaveTitle("ums.scx — scmJS");

  // Rename it in Map Properties.
  await editor.menu("File", "Map Properties…");
  const properties = editor.dialog("Map Properties");
  // The name is drawn the game's way until it is clicked, and is a text field after.
  const shown = properties.getByRole("textbox").first();
  await expect(shown).toHaveText(oldName!);
  await shown.click();
  await properties.locator("input[type=text]").first().fill(newName);
  await properties.getByRole("button", { name: "OK" }).click();
  await expect(properties).toHaveCount(0);

  // The chrome follows the scenario, and the map now has something to save.
  await expect(page.locator(".menubar-doc")).toContainText(`${newName} *`);
  await expect(page).toHaveTitle("*ums.scx — scmJS");

  const saved = await editor.saveAs();
  expect(saved.fileName).toBe("ums.scx");
  await expect(page).toHaveTitle("ums.scx — scmJS");

  // The file: the new name, and every section the rename did not touch byte for byte.
  const after = await formats.read(saved.bytes);
  expect(scenarioName(after)).toBe(newName);
  const touched = new Set(["SPRP", strSectionName(before)]);
  const untouched = (scn: Scenario) => sections(scn).filter(([section]) => !touched.has(section));
  expect(untouched(after)).toEqual(untouched(before));

  // And the editor opens what it wrote.
  const written = testInfo.outputPath("renamed.scx");
  writeFileSync(written, saved.bytes);
  await editor.openMap(written);
  await expect(page).toHaveTitle("renamed.scx — scmJS");
  await expect(page.locator(".menubar-doc")).toContainText(newName);
  await expect(page.locator(".menubar-doc")).not.toContainText("*");
});
