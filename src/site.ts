/**
 * Which hosted build this is. The hosted nightly is served from `scmjs.dev/nightly/`, on the
 * same origin as the stable editor at `scmjs.dev/editor/` and the game at `/play/` — it needs
 * the game's page beside it, which only the site has. A browser keeps what a site stores per
 * origin, so on that shared origin the nightly keeps its own: its settings, plugins and
 * sign-in under `scmjs-nightly.` keys (`atoms/storage.ts`), its game data in a folder of its
 * own (`gamedata/store.ts`) and its recent files in a database of its own
 * (`services/handleStore.ts`) — a nightly must never write a stored shape the stable build
 * then reads back. The build workflow sets `SCMJS_SITE=nightly` for that one build only: the
 * nightly's download, container and desktop builds are not it.
 */
declare const __SCMJS_SITE__: string;

export const HOSTED_SITE: string = typeof __SCMJS_SITE__ === "string" ? __SCMJS_SITE__ : "";

/** This is the hosted nightly, sharing its origin with the stable editor. */
export const SHARED_NIGHTLY = HOSTED_SITE === "nightly";
