/**
 * What a manifest's `requires` means for the installed list: which plugins are needed by
 * which, and the order to start them in. Pure — the installs and a way to look each
 * one's manifest up come in, nothing is fetched and no atom is read — so the rules are
 * testable in node and the two dialogs and the activation pass cannot disagree.
 *
 * Every match is by `key` (`pluginKey`: the repository behind any version, a bundled
 * copy answering for the spec it was built from), never by spec: a manifest says
 * `github:scm-js/plugin-eudplib`, the installed row is that at a tag or a commit, and
 * the desktop's `builtin:eudplib` stands for the same plugin.
 */
import type { PluginInstall } from "../atoms/pluginAtoms";
import type { PluginManifest } from "./api";

export type ManifestLookup = (spec: string) => PluginManifest | null | undefined;
export type KeyOf = (spec: string) => string;

/** The specs a manifest requires; none for a manifest not yet read. */
export const requirementsOf = (manifest: PluginManifest | null | undefined): string[] => manifest?.requires ?? [];

/** The installed row a required spec stands for, matched the way every list here matches. */
export function installFor(required: string, installs: readonly PluginInstall[], key: KeyOf): PluginInstall | undefined {
  const k = key(required);
  return installs.find((p) => key(p.spec) === k);
}

/** The installed rows a plugin requires — only those that are in the list; the rest are the install path's job. */
export function requiredInstalls(spec: string, installs: readonly PluginInstall[], manifests: ManifestLookup, key: KeyOf): PluginInstall[] {
  const out: PluginInstall[] = [];
  for (const r of requirementsOf(manifests(spec))) {
    const found = installFor(r, installs, key);
    if (found && found.spec !== spec && !out.some((p) => p.spec === found.spec)) out.push(found);
  }
  return out;
}

/**
 * Who needs whom: for each installed spec, the specs of the *enabled* plugins whose
 * manifest requires it. A plugin with an entry here cannot be turned off or removed while
 * the entry is non-empty; the row says who is holding it.
 */
export function neededBy(installs: readonly PluginInstall[], manifests: ManifestLookup, key: KeyOf): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of installs) {
    if (!p.enabled) continue;
    for (const r of requirementsOf(manifests(p.spec))) {
      const found = installFor(r, installs, key);
      if (!found || found.spec === p.spec) continue;
      const list = out.get(found.spec) ?? [];
      if (!list.includes(p.spec)) list.push(p.spec);
      out.set(found.spec, list);
    }
  }
  return out;
}

export interface OrderProblem {
  kind: "cycle" | "unknown";
  /** The plugin whose `requires` raised it. */
  spec: string;
  /** The required spec, as the manifest wrote it. */
  required: string;
}

/**
 * The installs in an order that starts each plugin after the ones it requires: a
 * depth-first pass that emits a plugin's requirements before it, keeping the list's own
 * order otherwise. A requirement that is not in the list is reported and skipped (the
 * plugin still starts — `services.watch` copes with a provider that never comes), and a
 * cycle is reported and broken at the point it closes, so nothing here can hang or throw.
 */
export function activationOrder(installs: readonly PluginInstall[], manifests: ManifestLookup, key: KeyOf, onProblem?: (problem: OrderProblem) => void): PluginInstall[] {
  const out: PluginInstall[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>();
  const visit = (p: PluginInstall) => {
    if (done.has(p.spec)) return;
    if (onPath.has(p.spec)) return;
    onPath.add(p.spec);
    for (const r of requirementsOf(manifests(p.spec))) {
      const found = installFor(r, installs, key);
      if (!found) { onProblem?.({ kind: "unknown", spec: p.spec, required: r }); continue; }
      if (found.spec === p.spec) continue;
      if (onPath.has(found.spec)) { onProblem?.({ kind: "cycle", spec: p.spec, required: r }); continue; }
      visit(found);
    }
    onPath.delete(p.spec);
    done.add(p.spec);
    out.push(p);
  };
  for (const p of installs) visit(p);
  return out;
}
