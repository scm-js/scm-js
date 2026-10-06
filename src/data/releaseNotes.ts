/**
 * The release notes bundled with this build: every `docs/releases/<version>.md`, newest
 * first. The text is a few tens of kilobytes that only Help ▸ What's New reads, so this
 * module is reached through `import()` alone — never statically from the startup path.
 */
import { compareVersions, type ReleaseNotes } from "../editor/releaseNotes";

const files = import.meta.glob(["../../docs/releases/*.md", "!**/README.md"], { eager: true, query: "?raw", import: "default" }) as Record<string, string>;

export const RELEASE_NOTES: ReleaseNotes[] = Object.entries(files)
  .map(([path, markdown]) => ({ version: path.slice(path.lastIndexOf("/") + 1, -".md".length), markdown }))
  .filter((n) => /^\d+\.\d+\.\d+$/.test(n.version))
  .sort((a, b) => compareVersions(b.version, a.version));
