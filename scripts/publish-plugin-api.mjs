/**
 * `npm run publish:plugin-types` — push the generated declarations to
 * `github.com/scm-js/plugin-api`, the repository plugin repositories take their types
 * from:
 *
 *   "devDependencies": { "@scm-js/plugin-api": "github:scm-js/plugin-api#v0.1.0" }
 *
 * That repository holds nothing written by hand except its README and LICENSE: its
 * `index.d.ts` and `package.json` are what `scripts/build-plugin-types.mjs` produces
 * here, so the contract has one source (`src/plugins/api.ts`) and one copy of its
 * declarations, instead of the nine hand-refreshed copies plugin repositories used to
 * carry. `main` there is the tip of the contract; a `v*` tag is the contract as of that
 * editor release, which is why the package's version is the editor's.
 *
 * It commits nothing when nothing changed — the usual case for a release that did not
 * touch `api.ts` — so a tag is only made when there is something to tag or the tag was
 * asked for explicitly.
 *
 *   node scripts/publish-plugin-api.mjs                     # dry run: say what would change
 *   node scripts/publish-plugin-api.mjs --push              # commit and push main
 *   node scripts/publish-plugin-api.mjs --push --tag v0.1.0 # …and tag it
 *   node scripts/publish-plugin-api.mjs --work ../plugin-api --push   # use a checkout you have
 *
 * In CI the push needs a token with Contents: write on `scm-js/plugin-api` —
 * `PLUGIN_API_PAT`, an organisation secret — because a repository's own GITHUB_TOKEN
 * cannot write to another repository. Pass it as `GH_TOKEN`.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generate, writePluginApi } from "./build-plugin-types.mjs";

const REPO = "scm-js/plugin-api";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

/** The remote to push to: with a token, one that carries it; otherwise whatever the checkout has. */
export function remoteUrl(repo, token) {
  return token ? `https://x-access-token:${token}@github.com/${repo}.git` : `https://github.com/${repo}.git`;
}

/** Files written, and whether the checkout now differs from HEAD. */
function stage(work, files) {
  const names = writePluginApi(work, files);
  // Only the generated files, never anything else a checkout passed with `--work` holds.
  git(work, "add", "--", ...names);
  const staged = git(work, "diff", "--cached", "--name-only");
  return staged === "" ? [] : staged.split("\n");
}

async function main(argv) {
  const flag = (name) => argv.includes(name);
  const value = (name) => { const i = argv.indexOf(name); return i === -1 ? null : (argv[i + 1] ?? null); };

  const push = flag("--push");
  const tag = value("--tag");
  const repo = value("--repo") ?? REPO;
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "";
  const given = value("--work");

  const { files, editorVersion, apiVersion } = generate();

  const work = given ? resolve(given) : mkdtempSync(join(tmpdir(), "scmjs-plugin-api-"));
  const temporary = !given;
  try {
    if (temporary) {
      git(process.cwd(), "clone", "--depth", "1", remoteUrl(repo, token), work);
      // The push URL carries the token; the fetch above already did.
      if (token) git(work, "remote", "set-url", "origin", remoteUrl(repo, token));
    }
    const changed = stage(work, files);
    if (changed.length === 0) {
      console.log(`plugin-api: ${repo} already matches editor ${editorVersion} (API ${apiVersion}); nothing to push.`);
    } else {
      console.log(`plugin-api: ${changed.length} file(s) changed — ${changed.join(", ")}`);
      if (!push) {
        console.log(git(work, "diff", "--cached", "--stat"));
        console.log("plugin-api: dry run; pass --push to commit and push.");
        return;
      }
      // The identity a token-authenticated push needs; a local checkout keeps its own.
      if (temporary) {
        git(work, "config", "user.name", "github-actions[bot]");
        git(work, "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
      }
      git(work, "commit", "-m", `Types for editor ${editorVersion} (plugin API ${apiVersion})`);
      git(work, "push", "origin", "HEAD:main");
      console.log(`plugin-api: pushed to ${repo}.`);
    }
    if (push && tag) {
      // A shallow clone carries no tags, so the remote is what has to be asked.
      const existing = git(work, "ls-remote", "--tags", "origin", `refs/tags/${tag}`);
      if (existing !== "") {
        console.log(`plugin-api: ${repo} already has ${tag}; leaving it alone.`);
      } else {
        git(work, "tag", "-a", tag, "-m", `scmJS ${editorVersion} — plugin API ${apiVersion}`);
        git(work, "push", "origin", tag);
        console.log(`plugin-api: tagged ${tag}.`);
      }
    } else if (tag) {
      console.log(`plugin-api: dry run; would tag ${tag}.`);
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

