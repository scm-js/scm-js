/**
 * `?plugin=github:scm-js/<repository>` in the editor's address: a link that asks for one of
 * the project's own plugins, which the docs site's "Try it" links carry so that a reader
 * without the API Playground is offered it. The link can only *ask*: a plugin that is not
 * installed opens the same confirmation Browse Plugins opens, and one that is turned off is
 * offered in a notice. Only the scm-js organisation's repositories, with no ref or folder,
 * so a link cannot be used to put an arbitrary address in front of the user.
 */
import type { PluginInstall } from "../atoms/pluginAtoms";
import { pluginKey } from "./defaults";
import { installFor } from "./requires";

export const PLUGIN_PARAM = "plugin";

const ALLOWED = /^github:scm-js\/[A-Za-z0-9._-]+$/;

export type PluginLinkAction =
  | { kind: "none" }
  | { kind: "refused"; spec: string }
  | { kind: "enable"; spec: string }
  | { kind: "install"; spec: string };

/** What a `?plugin=` link should do, given what is installed. */
export function pluginLinkAction(spec: string | null, installs: readonly PluginInstall[]): PluginLinkAction {
  if (spec === null || spec.trim() === "") return { kind: "none" };
  const s = spec.trim();
  if (!ALLOWED.test(s)) return { kind: "refused", spec: s };
  const found = installFor(s, installs, pluginKey);
  if (!found) return { kind: "install", spec: s };
  return found.enabled ? { kind: "none" } : { kind: "enable", spec: found.spec };
}
