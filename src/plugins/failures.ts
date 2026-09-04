/**
 * What to say when a plugin the user did not ask for does not load.
 *
 * A plugin that does not load leaves a feature simply absent, and `activatePlugin` used
 * to record that in `pluginRuntimesAtom` and nothing else: the only place it showed was
 * Manage Plugins, which nobody opens to find out why Repair did not check the map it just
 * opened. Silence is the bug; this is the notice.
 *
 * It mattered most when the defaults were fetched at startup and anything between the
 * editor and GitHub — offline, a proxy, a renamed repository — took five features away at
 * once. They are compiled in now (`scripts/vendor-plugins.mjs`), so what this usually
 * reports is a plugin the user added, or a build that skipped the vendoring; the failure
 * is rarer and no less worth saying.
 *
 * Pure, so the wording is tested rather than eyeballed (`tests/plugins.test.ts`). The
 * hook that owns the activation pass (`hooks/usePlugins.ts`) is what pushes it.
 */
import type { Toast } from "../editor/view";
import type { CachedManifest, PluginInstall, PluginRuntime } from "../atoms/pluginAtoms";

export interface PluginFailure {
  spec: string;
  /** What to call it: the manifest's name when one was read, else the repository's. */
  name: string;
  error: string;
}

/**
 * A name for a plugin whose manifest never arrived — which is the usual case here, since
 * the fetch that would have described it is the one that failed. The repository name
 * without the `plugin-` prefix everything in the organisation carries is close enough to
 * the plugin's real name to be recognised ("repair", "image-to-terrain").
 */
export function specLabel(spec: string): string {
  const gh = /^github:[^/@\s]+\/([^/@\s]+)/i.exec(spec.trim());
  if (gh) return gh[1].replace(/^plugin-/i, "");
  const builtin = /^builtin:([\w-]+)$/i.exec(spec.trim());
  return builtin ? builtin[1] : spec;
}

/**
 * Every enabled plugin whose last activation ended in an error, in list order. The
 * manifest cache is consulted for a name because the fetch that would have described the
 * plugin is usually the same one that just failed — a returning user has the real name
 * from an earlier session, and a first-time one gets the repository's.
 */
export function pluginFailures(
  wanted: readonly PluginInstall[],
  runtimes: Record<string, PluginRuntime>,
  cached: Record<string, CachedManifest> = {},
): PluginFailure[] {
  const out: PluginFailure[] = [];
  for (const p of wanted) {
    if (!p.enabled) continue;
    const rt = runtimes[p.spec];
    if (rt?.status !== "error") continue;
    const name = rt.manifest?.name ?? cached[p.spec]?.manifest.name ?? specLabel(p.spec);
    out.push({ spec: p.spec, name, error: rt.error ?? "It did not load." });
  }
  return out;
}

/** True for a plugin this build fetches rather than has compiled in. */
const isRemote = (spec: string) => !/^builtin:/i.test(spec.trim());

/** A loader message ends where it ends; the sentence after it needs somewhere to start. */
const sentence = (text: string) => {
  const t = text.trim();
  return t === "" || /[.!?…:]$/.test(t) ? t : `${t}.`;
};

/**
 * The one notice for a whole activation pass. Five failures offline is one problem, not
 * five, so beyond a pair they are counted rather than listed — and the message under it
 * is the first one, which offline is the same as the rest bar the address in it.
 *
 * `ttl: 0` because this lands seconds after launch, while the splash is still up: a
 * notice that expires behind the splash was never shown. The button is the place the
 * error can actually be read.
 */
export function failureToast(failures: readonly PluginFailure[], openPlugins: () => void): Omit<Toast, "id"> | null {
  if (failures.length === 0) return null;
  const names = failures.map((f) => f.name);
  const plural = failures.length > 1;
  const title = failures.length === 1 ? `${names[0]} did not load`
    : failures.length === 2 ? `${names[0]} and ${names[1]} did not load`
    : `${failures.length} plugins did not load`;
  // Where they come from is the part that says what to do about it: a plugin fetched at
  // startup failing usually means the connection, not the plugin.
  const where = failures.every((f) => isRemote(f.spec))
    ? ` ${plural ? "They are" : "It is"} fetched from ${plural ? "their repositories" : "its repository"} when the editor starts.`
    : "";
  return {
    kind: "warn",
    title,
    detail: `${plural ? `${failures[0].name}: ` : ""}${sentence(failures[0].error)}${where} Everything else in the editor works.`,
    ttl: 0,
    action: { label: "Plugins…", run: openPlugins },
  };
}
