/**
 * Which hosted build this is. The hosted nightly is served from `scmjs.dev/nightly/`, on the
 * same origin as the stable editor at `scmjs.dev/editor/` and the game at `/play/` — it needs
 * the game's page beside it, which only the site has. A browser keeps what a site stores per
 * origin, so on that shared origin the nightly keeps its own: its settings, plugins and
 * sign-in under `scmjs-nightly.` keys (`atoms/storage.ts`) and its recent files in a database
 * of its own (`services/handleStore.ts`) — a nightly must never write a stored shape the
 * stable build then reads back. The game data is the exception: the game's page at `/play/`
 * reads the one copy at the root of the origin's files, so the nightly installs there too
 * (`gamedata/store.ts`), and one install serves both editors and the game. The build workflow sets `SCMJS_SITE=nightly` for that one build only: the
 * nightly's download, container and desktop builds are not it.
 */
declare const __SCMJS_SITE__: string;

export const HOSTED_SITE: string = typeof __SCMJS_SITE__ === "string" ? __SCMJS_SITE__ : "";

/** This is the hosted nightly, sharing its origin with the stable editor. */
export const SHARED_NIGHTLY = HOSTED_SITE === "nightly";

/** The site's origin: the editor is at `/editor/` there, the nightly at `/nightly/`. */
export const SITE_ORIGIN = "https://scmjs.dev";

/** Where a page is, as `window.location` says it. */
export interface PageAddress { origin: string; hostname: string; pathname: string }

/**
 * Whether the editor at this address has the site's own pages beside it: its home at `/`,
 * the game at `/play/`, replays at `/replay/` and the library at `/library`. That is
 * scmjs.dev itself, and a stand-in for it on one's own machine, which serves the editor
 * under `/editor/` with the rest of the site around it. The desktop app, the container
 * image, `npm run dev` at `/` and a bundle hosted anywhere else have no such pages, so
 * nothing there may link to them. The scm-sim plugin decides where the play page is by
 * the same rule (`simAddress` in its `address.ts`): keep the two in step.
 */
export function onSite(at: PageAddress, desktop = false): boolean {
  if (desktop) return false;
  if (at.origin === SITE_ORIGIN) return true;
  return /^(localhost|127\.0\.0\.1)$/.test(at.hostname) && at.pathname.startsWith("/editor/");
}

/**
 * The site's pages the editor links to, from the root of its origin. `gameData` is the
 * editor's own Game Data page (`data.html`) at the address the site's header gives it.
 */
export const SITE_PAGES = {
  home: "/",
  /** The home page in Korean, where the site's own header sends a Korean reader. */
  homeKo: "/ko/",
  play: "/play/",
  replays: "/replay/",
  library: "/library",
  gameData: "/editor/data",
} as const;
