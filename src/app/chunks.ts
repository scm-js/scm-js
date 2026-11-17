/**
 * A part of the editor's own code that did not arrive.
 *
 * The editor loads most of itself on demand: every dialog is its own chunk, fetched the first
 * time it opens. A chunk that cannot be fetched fails the `import()` with an error whose only
 * mark is its message, which each browser words its own way. The usual cause on the site is a
 * page opened before a release: the chunks it asks for are named by their content's hash, and
 * a deploy that does not carry the old names along leaves it asking for files that are not
 * there. The other is a connection that dropped. Either way a reload is the cure, which is
 * what the notice for it offers.
 */

/** Each browser's words for a module that could not be fetched, and Vite's for a stylesheet a chunk needs. */
const MESSAGES = /^(?:Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS for)\b/i;

/** The address at the end of the message, where the browser gives one (Safari does not). */
function addressOf(message: string): string | undefined {
  const last = message.trim().split(/\s+/).pop()?.replace(/\.$/, "") ?? "";
  return /^[a-z][\w+.-]*:/i.test(last) ? last : undefined;
}

/**
 * Whether `err` is one of the editor's own chunks failing to load. A module from elsewhere —
 * a plugin, which loads from a `blob:` address or another site — is not: its failure is the
 * plugin's to report. `origin` is the page's, a parameter so tests need no `location`.
 */
export function isChunkLoadError(err: unknown, origin: string | undefined = globalThis.location?.origin): boolean {
  if (!(err instanceof Error) || !MESSAGES.test(err.message)) return false;
  const address = addressOf(err.message);
  if (!address) return true;
  if (address.startsWith("blob:")) return false;
  try {
    return origin === undefined || new URL(address).origin === origin;
  } catch {
    return false;
  }
}
