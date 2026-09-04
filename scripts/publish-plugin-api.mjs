/**
 * `npm run publish:plugin-types` — publish the generated declarations as
 * `@scm-js/plugin-api`, the package plugin repositories take their types from:
 *
 *   "devDependencies": { "@scm-js/plugin-api": "^1" }
 *
 * Two places, one artifact. **npm** is what a plugin repository depends on, because a
 * registry is where `^1`, `npm outdated` and `npm update` mean something and where
 * somebody outside the organisation looks first. **`github.com/scm-js/plugin-api`** is
 * where the same two files are committed and tagged: the audit trail behind the tarball,
 * the README, and the way in for anyone whose registry the package is not on.
 *
 * Neither holds anything written by hand except that repository's README and LICENSE —
 * `scripts/build-plugin-types.mjs` produces `index.d.ts` and `package.json`, so the
 * contract has one source (`src/plugins/api.ts`) and one copy of its declarations,
 * instead of the nine hand-refreshed copies plugin repositories used to carry.
 *
 * The version is decided here, against the registry, not against the editor: the major is
 * `PLUGIN_API_VERSION` and the minor moves whenever the declarations change
 * (`nextVersion`). So this publishes exactly as often as the contract moves, and does
 * nothing at all — no commit, no tag, no tarball — when a build did not touch it. That is
 * also why the generated file carries no date and no editor version.
 *
 *   node scripts/publish-plugin-api.mjs                    # dry run: say what would happen
 *   node scripts/publish-plugin-api.mjs --push             # commit, tag and push the repository
 *   node scripts/publish-plugin-api.mjs --push --npm       # …and publish the tarball
 *   node scripts/publish-plugin-api.mjs --work ../plugin-api --push   # use a checkout you have
 *
 * In CI the git push needs `PLUGIN_API_PAT` (an organisation secret: a token with
 * Contents: write on `scm-js/plugin-api` and nothing else, since a repository's own
 * GITHUB_TOKEN cannot write to another repository), passed as `GH_TOKEN`. The npm publish
 * needs either npm's trusted publishing over OIDC — nothing to store, and the reason the
 * package's `repository` names scm-js, where the workflow runs — or an `NPM_TOKEN`. The
 * tarball is published with `--provenance` when Actions built it, so the package page
 * names the workflow run and the commit it came from.
 *
 * An npm version cannot be republished, so the order matters: the tarball goes first and
 * the repository is pushed and tagged once it lands. The failure that leaves is a version
 * on the registry with no tag behind it, which the next run fixes; the other order leaves
 * a tag claiming a version nobody can install.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generate, nextVersion, PACKAGE_NAME, writePluginApi } from "./build-plugin-types.mjs";

const REPO = "scm-js/plugin-api";
const REGISTRY = "https://registry.npmjs.org";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The remote to push to: with a token, one that carries it; otherwise plain https. */
export function remoteUrl(repo, token) {
  return token ? `https://x-access-token:${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
}

/** The newest published version, or null when the package is not on the registry yet. */
export async function publishedVersion(registry = REGISTRY, name = PACKAGE_NAME) {
  const res = await fetch(`${registry}/${name.replace("/", "%2f")}`, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} asking ${registry} for ${name}`);
  const body = await res.json();
  return body["dist-tags"]?.latest ?? null;
}

async function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] ?? null); };

  const push = flag("--push");
  const toNpm = flag("--npm");
  const repo = value("--repo") ?? REPO;
  const registry = value("--registry") ?? REGISTRY;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const given = value("--work");

  const published = await publishedVersion(registry);
  const version = value("--version") ?? nextVersion(generate().apiVersion, published);
  const { files, editorVersion, apiVersion } = generate({ version });

  const work = given ? resolve(given) : mkdtempSync(join(tmpdir(), "scmjs-plugin-api-"));
  const temporary = !given;
  try {
    if (temporary) {
      git(process.cwd(), "clone", "--depth", "1", remoteUrl(repo, token), work);
      if (token) git(work, "remote", "set-url", "origin", remoteUrl(repo, token));
    }

    // The declarations alone decide whether there is anything to do: `package.json`'s
    // version is derived from that answer, so comparing it would always say "changed".
    let same = false;
    try { same = readFileSync(join(work, "index.d.ts"), "utf8") === files["index.d.ts"]; } catch { same = false; }
    if (same && published !== null) {
      console.log(`plugin-api: the contract has not moved since ${published}; nothing to publish.`);
      return;
    }
    console.log(`plugin-api: ${published ?? "nothing"} published → ${version} (API ${apiVersion}, editor ${editorVersion}).`);

    const names = writePluginApi(work, files);
    git(work, "add", "--", ...names);

    if (!push) {
      console.log(git(work, "diff", "--cached", "--stat") || "  (the repository already carries these files)");
      console.log(`plugin-api: dry run; --push commits and tags v${version}${toNpm ? ", --npm publishes the tarball" : ""}.`);
      return;
    }

    if (toNpm) {
      const args = ["publish", "--access", "public"];
      if (process.env.GITHUB_ACTIONS === "true") args.push("--provenance");
      execFileSync("npm", args, { cwd: work, stdio: "inherit" });
      console.log(`plugin-api: published ${PACKAGE_NAME}@${version}.`);
    }

    if (temporary) {
      git(work, "config", "user.name", "github-actions[bot]");
      git(work, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    }
    if (git(work, "diff", "--cached", "--name-only") !== "") {
      git(work, "commit", "-m", `${PACKAGE_NAME} ${version} (plugin API ${apiVersion}, editor ${editorVersion})`);
      git(work, "push", "origin", "HEAD:main");
      console.log(`plugin-api: pushed to ${repo}.`);
    }
    const tag = `v${version}`;
    if (git(work, "ls-remote", "--tags", "origin", `refs/tags/${tag}`) !== "") {
      console.log(`plugin-api: ${repo} already has ${tag}; leaving it alone.`);
    } else {
      git(work, "tag", "-a", tag, "-m", `${PACKAGE_NAME} ${version}`);
      git(work, "push", "origin", tag);
      console.log(`plugin-api: tagged ${tag}.`);
    }
  } finally {
    if (temporary) rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).catch((err) => {
    // A token can appear in a git error's URL; never let one reach the log.
    const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
    let message = err instanceof Error ? err.message : String(err);
    if (token) message = message.split(token).join("***");
    console.error(`publish-plugin-api: ${message}`);
    process.exit(1);
  });
}
