/**
 * The editor's own format code, for a test that reads a file the editor wrote.
 *
 * It is loaded through Vite rather than imported: the modules under `src/` are written for
 * Vite's resolution (a JSON catalogue imported bare, for one), which is what vitest gives
 * the suites under `tests/` and what Playwright's own loader does not. Only the types are
 * imported here, so nothing of `src/` is evaluated outside that.
 */
import { join } from "node:path";
import { createServer } from "vite";

type ScenarioModule = typeof import("../../src/formats/chk/scenario");
type ScmModule = typeof import("../../src/formats/mpq/scm");
export type Scenario = import("../../src/formats/chk/scenario").Scenario;

export interface Formats {
  scenario: ScenarioModule;
  /** A `.scm` / `.scx` / `.chk` file's bytes as a parsed scenario. */
  read(bytes: Uint8Array): Promise<Scenario>;
  close(): Promise<void>;
}

export async function loadFormats(): Promise<Formats> {
  const vite = await createServer({
    root: join(import.meta.dirname, "../.."),
    configFile: false,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const scenario = await vite.ssrLoadModule("/src/formats/chk/scenario.ts") as ScenarioModule;
  const scm = await vite.ssrLoadModule("/src/formats/mpq/scm.ts") as ScmModule;
  return {
    scenario,
    read: async (bytes) => scenario.parseScenario((await scm.loadMap(bytes)).chk),
    close: () => vite.close(),
  };
}
