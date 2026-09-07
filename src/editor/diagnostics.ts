/**
 * The few lines above a shared log that say which editor produced it.
 *
 * Most of what a bug report needs is here rather than in the entries: the build, whether
 * it is the desktop app or a browser, where the game data came from (a missing or partial
 * extraction explains a whole class of "the map draws wrong"), which plugins are running
 * and at what versions, and the shape of the map that was open. A log without this is a
 * list of events with nothing to compare them against.
 *
 * Pure — `atoms/logAtoms.ts` reads the store and hands the facts here. Kept separate so
 * the wording is tested rather than eyeballed, the way `plugins/failures.ts` is.
 *
 * What is deliberately *not* collected: full file paths (a desktop path carries the user's
 * own name — `log.ts#baseName` trims them), the user agent string beyond its shape, and
 * anything from a plugin's stored settings. The Debug Console says what a copy contains
 * before it is copied; that promise is kept here.
 */

export interface PluginFact {
  name: string;
  version?: string;
  status: string;
  /** Present when the status is an error — the reason, which is usually the whole report. */
  error?: string;
}

export interface DiagnosticsFacts {
  version: string;
  /** "desktop" / "browser", with the platform when the desktop bridge names one. */
  host: string;
  /** `navigator.userAgent`, trimmed to the engine — enough to tell Firefox from Chrome. */
  agent?: string;
  /** How the game data resolved: the source's own one-line label, or nothing when none did. */
  gameData?: string;
  /** The data set in force, when it is not the game's own. */
  profile?: string;
  map?: {
    /** The file's name only, never its folder. */
    file?: string;
    width: number;
    height: number;
    tileset: string;
    version: string;
    modified: boolean;
    /** How many maps are open, when more than one is. */
    open?: number;
  };
  plugins: PluginFact[];
}

/** A user agent cut to the part that identifies the engine; the full string is noise and near-unique. */
export function shortAgent(ua: string): string {
  const m = /(Firefox|Edg|OPR|Chrome|Version)\/(\d+)/.exec(ua);
  const engine = m ? `${m[1] === "Edg" ? "Edge" : m[1] === "OPR" ? "Opera" : m[1] === "Version" ? "Safari" : m[1]} ${m[2]}` : "unknown";
  const os = /Windows NT ([\d.]+)/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${engine} on ${os}` : engine;
}

/**
 * The header, as the plain block that goes at the top of a copied log. Written to be
 * skimmed by whoever the report lands with, so every line is `label: value` and an absent
 * fact is an absent line rather than an empty one.
 */
export function diagnosticsHeader(f: DiagnosticsFacts): string {
  const lines = [`scm-js ${f.version} · ${f.host}`];
  if (f.agent) lines.push(`Browser: ${f.agent}`);
  lines.push(`Game data: ${f.gameData ?? "none — the editor is running without the game's graphics"}`);
  if (f.profile) lines.push(`Data set: ${f.profile}`);
  if (f.map) {
    const m = f.map;
    lines.push(`Map: ${m.file ?? "unsaved"} · ${m.width}×${m.height} · ${m.tileset} · ${m.version}${m.modified ? " · modified" : ""}${m.open && m.open > 1 ? ` · ${m.open} open` : ""}`);
  } else {
    lines.push("Map: none open");
  }
  if (f.plugins.length === 0) lines.push("Plugins: none");
  else {
    lines.push("Plugins:");
    for (const p of f.plugins) {
      lines.push(`  ${p.name}${p.version ? ` ${p.version}` : ""} — ${p.status}${p.error ? `: ${p.error}` : ""}`);
    }
  }
  return lines.join("\n");
}
