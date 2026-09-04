/**
 * The version `main` is building towards, worked out rather than remembered.
 *
 * Both workflows need it: `build.yml` labels a nightly `<base>-nightly.<date>.<run>`, and
 * `release.yml` offers it as the version to cut when none is given. Keeping it in one
 * tested place is the point — the arithmetic is small but the failure is not. A nightly
 * must sort ABOVE the release it follows and BELOW the release it precedes, or the in-app
 * updater either offers nightly users a downgrade it cannot install (too low) or offers
 * them nothing until that version finally ships (too high).
 *
 * The rule is a patch bump of the newest release tag, which is the only choice that can
 * never be too high: 0.8.0 -> 0.8.1 puts the nightlies in the narrow band above 0.8.0 and
 * below anything anyone would ship next, 0.9.0 and 1.0.0 included. It is deliberately not
 * a guess at the *intended* next version — that is what the release workflow's `version`
 * input is for, and guessing it here is what strands people.
 *
 * Two edges: with no release tags at all nothing has shipped, so nothing can be
 * downgraded and package.json's own version is used as it stands. And a prerelease tag
 * (v1.0.0-beta.1) is answered with its release version, since 1.0.0 is what comes next —
 * `1.0.0-nightly.…` sorts above `1.0.0-beta.1` ("nightly" > "beta") and below `1.0.0`.
 *
 *   node scripts/next-version.mjs            # the base, e.g. 0.8.1
 *   node scripts/next-version.mjs --tag      # the newest release tag, or nothing
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Pure: the newest release tag (or null) and package.json's version in, the base out. */
export function baseVersion(latestTag, packageVersion) {
  if (!latestTag) return packageVersion;
  const version = latestTag.replace(/^v/, "");
  const [core, ...pre] = version.split("-");
  const [major, minor, patch] = core.split(".").map(Number);
  if ([major, minor, patch].some((n) => !Number.isInteger(n) || n < 0)) return packageVersion;
  // A prerelease tag is already pointing at its release; anything else has shipped.
  return pre.length > 0 ? core : `${major}.${minor}.${patch + 1}`;
}

/** The newest `v*` tag by version order, or null when the repository has none. */
export function latestReleaseTag(cwd = process.cwd()) {
  try {
    const out = execFileSync("git", ["tag", "--list", "v*", "--sort=-v:refname"], { cwd, encoding: "utf8" });
    return out.split("\n").map((t) => t.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = resolve(import.meta.dirname, "..");
  const tag = latestReleaseTag(root);
  if (process.argv.includes("--tag")) {
    if (tag) console.log(tag);
  } else {
    console.log(baseVersion(tag, JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version));
  }
}
