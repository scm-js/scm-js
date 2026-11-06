/**
 * `?plugin-dev=http://127.0.0.1:<port>/` in the editor's address: `scmjs plugin dev` (cli/src/plugin.ts) serving a
 * plugin being written on this machine. The editor installs it the usual way the first time (the same confirmation
 * as Manage Plugins), reloads it when it is already there, and reloads it again each time the command says the
 * files changed (`/__scmjs/events`, a server-sent event stream on the same address).
 *
 * Only a plugin served on this machine's own loopback address over plain http, at the root of a port, is taken: a
 * link cannot point the editor at somebody else's server, and what it can point at is a program the person is
 * running themselves. Installing still asks, as for any plugin.
 */
export const PLUGIN_DEV_PARAM = "plugin-dev";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** The plugin address a `?plugin-dev=` value names, as Manage Plugins would keep it, or null when it is not one. */
export function devPluginSpec(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value.trim()); } catch { return null; }
  if (url.protocol !== "http:" || !LOOPBACK.has(url.hostname) || !url.port) return null;
  if (url.pathname !== "/" || url.search || url.username || url.password) return null;
  return `http://${url.host}/`;
}

/** Where the command says that the files changed. */
export const devEventsUrl = (spec: string) => `${spec}__scmjs/events`;
