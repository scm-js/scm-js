# Install recipes for `scmjs`

Every release (and the nightly) carries the command line as a single program with Node inside
it, built by `scripts/build-cli-binary.mjs` in the `cli-binary` job of `build.yml`:

| Asset | Holds |
| --- | --- |
| `scmjs-cli-windows-x64.zip` | `scmjs.exe`, `LICENSE`, `THIRD-PARTY-NOTICES.txt` |
| `scmjs-cli-macos-arm64.tar.gz` | `scmjs` (signed ad hoc), the same two files |
| `scmjs-cli-macos-x64.tar.gz` | the same |
| `scmjs-cli-linux-x64.tar.gz` | the same |
| `SHA256SUMS` | the SHA-256 of every asset of the release, in `sha256sum`'s form |

The folders here are the recipes three package managers install it with. They hold
placeholders (`@VERSION@`, `@DATE@`, `@SHA256_WINDOWS_X64@` and so on), not a release:

| Folder | Package manager | Published in |
| --- | --- | --- |
| `scoop/scmjs.json` | Scoop | a bucket, `github.com/scm-js/scoop-bucket`, as `bucket/scmjs.json` |
| `winget/*.yaml` | winget | `github.com/microsoft/winget-pkgs`, as `manifests/s/scm-js/scmjs/<version>/` |
| `homebrew/scmjs.rb` | Homebrew | a tap, `github.com/scm-js/homebrew-tap`, as `Formula/scmjs.rb` |

The docs (`docs/cli.md`, "Installing") give the install commands as these names make them:
`scoop bucket add scm-js https://github.com/scm-js/scoop-bucket` then `scoop install scmjs`,
`winget install scm-js.scmjs`, and `brew install scm-js/tap/scmjs`. `scmjs about` and
`scmjs doctor` print `scoop update scmjs`, `winget upgrade scm-js.scmjs` and
`brew upgrade scmjs` for a program they find in those package managers' folders
(`cli/src/runtime.ts`), so a different bucket, identifier or tap means changing them too.

## Filling them for a release

Once the release is out (its `SHA256SUMS` is read from the release page):

```sh
node scripts/release-recipes.mjs 0.12.0
```

writes `packaging/out/v0.12.0/` (ignored by git), laid out as the three repositories are:
`scoop/bucket/scmjs.json`, `winget/manifests/s/scm-js/scmjs/0.12.0/*.yaml` and
`homebrew/Formula/scmjs.rb`. `--sums cli/dist/bin/SHA256SUMS --partial` fills them from a
local build instead, with zeros for the archives not built here, to try a recipe.

## Each release

The release tells all three itself: the `packages` job at the end of `build.yml` runs once
the release has its assets, on a numbered release only.

- **Homebrew.** It runs `scm-js/homebrew-tap`'s `update.yml` with the version. That fills
  `Formula/scmjs.rb` from `packaging/homebrew/scmjs.rb` at the release's tag, with
  `scripts/release-recipes.mjs`, installs it from the tap, runs `brew test`, and pushes it
  to main.
- **Scoop.** It runs `scm-js/scoop-bucket`'s `excavator.yml`. Scoop's `checkver` reads the
  newest scm-js release (the nightly is a pre-release and is skipped), and `autoupdate`
  rewrites `bucket/scmjs.json` with its URL and the hash from its `SHA256SUMS`. The commit
  is pushed to main.
- **winget.** It opens the version's pull request to `microsoft/winget-pkgs` from a fork:
  the three files of `packaging/winget`, filled by `scripts/release-recipes.mjs`, as one
  commit on a branch `scm-js.scmjs-<version>`. Microsoft's checks and a moderator do the
  rest, which takes from hours to days. Nothing is sent while the package is not in
  winget-pkgs at all (its first version is reviewed as a new package and goes in by hand,
  "The first time" below), or when the version is there or has an open pull request.

The job needs two secrets in scm-js, and does its part for whichever is set:

| Secret | What it is | Lets the job |
| --- | --- | --- |
| `PACKAGES_PAT` | A fine-grained token for `scm-js/homebrew-tap` and `scm-js/scoop-bucket` with Actions: read and write | run the two workflows |
| `WINGET_PAT` | A classic token with `public_repo`, of the account whose fork of `winget-pkgs` the pull request comes from | write the branch to the fork and open the pull request |

Without `PACKAGES_PAT` the tap and the bucket still follow by themselves: each workflow
also runs on a schedule, every 4 hours as written and every 8 to 10 as GitHub runs it.
Without `WINGET_PAT` a version goes to winget by hand:
`wingetcreate update scm-js.scmjs --version <v> --urls https://github.com/scm-js/scm-js/releases/download/v<v>/scmjs-cli-windows-x64.zip --submit`.
A step that fails leaves a warning on the run and does not fail it.

A release whose archives are not uploaded yet is left for the next run. Either workflow can
be run by hand from its repository's Actions tab: it updates nothing that is already
current, and checks with a dry-run push that it can still push.

Both repositories' main needs pull requests (a ruleset, as on scm-js's other repositories),
which a workflow's own token cannot get past. So each workflow pushes over SSH with a deploy
key that has write access to that repository alone, kept as its `CI_BUILD_KEY` secret, and
the workflow's token only reads. Scoop's ready-made Excavator action
(`ScoopInstaller/GithubActions`) always pushes with the workflow's token, so the bucket runs
`checkver` with steps of its own instead. To replace a key, make a new one, add it as a
deploy key with write access, set `CI_BUILD_KEY` to its private half, and remove the old
deploy key.

## The first time

How the three were first published, for a new package manager or a repository made again:

- **Scoop.** Make the repository from Scoop's bucket template
  (github.com/ScoopInstaller/BucketTemplate) and commit the filled `bucket/scmjs.json`. Try
  it with `scoop install <path to scmjs.json>`.
- **winget.** Submit the three filled files as a pull request to `microsoft/winget-pkgs`:
  `wingetcreate submit packaging/out/v<version>/winget/manifests/s/scm-js/scmjs/<version>`
  (or `komac`). `winget validate --manifest <that folder>` checks them first, and
  `winget install --manifest <that folder>` installs from them (it needs
  `winget settings --enable LocalManifestFiles` once, as administrator). The review scans
  the zip; an unsigned program is accepted. The first version is
  microsoft/winget-pkgs#475062.
- **Homebrew.** Make the repository and commit the filled `Formula/scmjs.rb`. Check it with
  `brew install --formula ./Formula/scmjs.rb`, `brew test scmjs` and
  `brew audit --new scmjs`. No bottle is needed: the formula installs the release's program
  as it is.

## Signing

None of the programs is code-signed, as the desktop installers are not. Windows shows
SmartScreen's warning the first time; macOS refuses a program downloaded in a browser until its
quarantine flag is cleared (`xattr -d com.apple.quarantine scmjs`); the docs say both.
Homebrew and Scoop downloads carry no quarantine flag. A Developer ID signature with
notarization (macOS) and an Authenticode signature (Windows) would go in
`scripts/build-cli-binary.mjs` after the injection, where the macOS programs are signed ad hoc
today.
