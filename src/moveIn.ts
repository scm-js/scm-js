/**
 * The editor moved from `editor.scmjs.dev` to `scmjs.dev/editor/`, and a browser keeps
 * what a site stores per origin — so at the new address the preferences, the plugin list
 * and the sign-in of anyone who used the old one are simply not there. This brings them
 * over, once: the old address keeps one page (`/moved.html`, the front-door worker's —
 * scm-js/cloudflare-link-previews), which, loaded in a frame, posts back the `scmjs.` keys
 * that browser holds for it.
 *
 * It has to finish before anything reads storage, and most of the editor reads it while
 * its modules are evaluated (`atomWithStorage`, `main.tsx`'s own language lookup). So
 * `main.tsx` imports this before React and the app, and the `await` at the bottom holds
 * the modules after it. Everywhere but the site itself — the desktop app, the nightly
 * editor, a container, `npm run dev` — and on every visit after the first, nothing is
 * awaited and nothing is loaded.
 *
 * Game data is not brought over (it is large, and the editor offers to install it again),
 * and neither is anything kept outside `localStorage`.
 */
import { browserStorage, STORAGE_PREFIX, storagePersists } from "./atoms/storage";
import { SHARED_NIGHTLY } from "./site";

/** The site, the only origin that asks. */
export const SITE_ORIGIN = "https://scmjs.dev";
/**
 * The origin the editor had, and its hand-off page. The hosted nightly moved too, from
 * `nightly.editor.scmjs.dev` to `scmjs.dev/nightly/`, and asks its own old address: that
 * Pages site keeps a static `moved.html` at its root (the nightly-site job writes it — the
 * old nightly address is not behind the front-door worker). What it brings is written under
 * the nightly's own keys (`atoms/storage.ts`), and so is the note that it has asked.
 */
export const OLD_ORIGIN = SHARED_NIGHTLY ? "https://nightly.editor.scmjs.dev" : "https://editor.scmjs.dev";
const HANDOFF_URL = `${OLD_ORIGIN}/moved.html`;

/**
 * Set once the old address has answered, whatever it said. Not under the editor's `scmjs.`
 * prefix, on purpose: Preferences ▸ Clear all data removes every key that is, and with
 * this gone the next visit would bring the cleared settings straight back.
 */
export const MOVED_KEY = "scmjs-moved";
/** How many visits have asked and heard nothing (offline, the frame blocked). */
export const TRIES_KEY = "scmjs-moved-tries";
const MAX_TRIES = 3;
/** The boot splash is on screen meanwhile; a visit that hears nothing starts after this. */
const TIMEOUT_MS = 4000;

type Store = Pick<Storage, "getItem" | "setItem">;

/** Whether this visit should ask the old address. */
export function owed(origin: string, storage: Store): boolean {
  return origin === SITE_ORIGIN && storage.getItem(MOVED_KEY) === null && Number(storage.getItem(TRIES_KEY) ?? 0) < MAX_TRIES;
}

/**
 * The old address's entries into storage: the editor's own keys only, and never over a
 * key already here — what somebody has set at the new address since wins. Returns how
 * many were written.
 */
export function takeIn(storage: Store, entries: unknown): number {
  if (!entries || typeof entries !== "object") return 0;
  let written = 0;
  for (const [key, value] of Object.entries(entries)) {
    if (!key.startsWith(STORAGE_PREFIX) || typeof value !== "string" || storage.getItem(key) !== null) continue;
    try {
      storage.setItem(key, value);
      written++;
    } catch {
      // Storage is full; the rest may still fit.
    }
  }
  return written;
}

/** The hand-off page's answer (`null` entries: it could not read its storage), or undefined after the time limit. */
function ask(): Promise<{ entries: unknown } | undefined> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = HANDOFF_URL;
    const done = (answer: { entries: unknown } | undefined) => {
      clearTimeout(timer);
      window.removeEventListener("message", heard);
      frame.remove();
      resolve(answer);
    };
    const heard = (e: MessageEvent) => {
      if (e.origin !== OLD_ORIGIN || e.source !== frame.contentWindow) return;
      const data = e.data as { scmjsMove?: unknown; entries?: unknown } | null;
      if (data && data.scmjsMove === 1) done({ entries: data.entries });
    };
    const timer = setTimeout(() => done(undefined), TIMEOUT_MS);
    window.addEventListener("message", heard);
    document.documentElement.appendChild(frame);
  });
}

async function moveIn(): Promise<void> {
  const storage = browserStorage();
  const answer = await ask();
  try {
    if (answer) {
      takeIn(storage, answer.entries);
      storage.setItem(MOVED_KEY, "1");
    } else {
      storage.setItem(TRIES_KEY, String(Number(storage.getItem(TRIES_KEY) ?? 0) + 1));
    }
  } catch {
    // Nothing to keep the answer in; the next visit asks again.
  }
}

if (typeof window !== "undefined" && storagePersists() && owed(window.location.origin, browserStorage())) await moveIn();
