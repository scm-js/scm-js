/**
 * Where the app's version comes from: `package.json`, injected by `vite.config.ts` as
 * `__APP_VERSION__`. CI rewrites that field before building, so a nightly carries its own
 * prerelease string (`0.1.1-nightly.20260904.42`) and a tagged release carries the tag.
 *
 * `APP_VERSION` is that string whole — what Help ▸ About shows, so the exact build is
 * always readable. `APP_VERSION_SHORT` is the splash's version line, which has room for a
 * version and not a date and a run number: the release plus the *channel* it was cut on,
 * never the release alone. A nightly's version is a patch bump of the newest release tag
 * (`scripts/next-version.mjs`), so trimming it back to the core said `0.1.1` on a build of
 * a version nobody had shipped — indistinguishable from the real 0.1.1 when it arrives.
 */
declare const __APP_VERSION__: string;

export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";

/**
 * `0.2.0` → `0.2.0`, `0.1.1-nightly.20260904.42` → `0.1.1-nightly`, `1.0.0-beta.1` →
 * `1.0.0-beta`: the release, plus the first prerelease identifier when there is one.
 *
 * `index.html`'s boot splash carries the same line and cannot import this — `vite.config.ts`
 * substitutes its `%APP_VERSION_SHORT%` token with a copy of this rule, so change both.
 */
export function shortVersion(version: string): string {
  const dash = version.indexOf("-");
  if (dash < 0) return version.split("+")[0];
  const channel = version.slice(dash + 1).split(/[.+]/)[0];
  return channel ? `${version.slice(0, dash)}-${channel}` : version.slice(0, dash);
}

export const APP_VERSION_SHORT: string = shortVersion(APP_VERSION);
