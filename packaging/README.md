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

The docs (`docs/cli.md`, "Without Node") give the install commands as these names make them:
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

## The first time

- **Scoop.** Make the repository `scm-js/scoop-bucket` from Scoop's bucket template
  (github.com/ScoopInstaller/BucketTemplate) and commit the filled `bucket/scmjs.json`. The
  template's Excavator workflow runs `checkver` and `autoupdate` on a schedule: it reads the
  newest release, rewrites the URL and takes the hash from that release's `SHA256SUMS`, so
  later releases need nothing by hand. Try it with `scoop install <path to scmjs.json>`.
- **winget.** Submit the three filled files as a pull request to `microsoft/winget-pkgs`:
  `wingetcreate submit packaging/out/v<version>/winget/manifests/s/scm-js/scmjs/<version>`
  (or `komac`). `winget validate --manifest <that folder>` checks them first, and
  `winget install --manifest <that folder>` installs from them (it needs
  `winget settings --enable LocalManifestFiles` once, as administrator). The review scans
  the zip; an unsigned program is accepted. Later versions:
  `wingetcreate update scm-js.scmjs --version <v> --urls https://github.com/scm-js/scm-js/releases/download/v<v>/scmjs-cli-windows-x64.zip --submit`,
  which can run from a workflow with a token of its own.
- **Homebrew.** Make the repository `scm-js/homebrew-tap` and commit the filled
  `Formula/scmjs.rb`. Check it with `brew install --formula ./Formula/scmjs.rb`,
  `brew test scmjs` and `brew audit --new scmjs`. Later versions:
  `brew bump-formula-pr --version <v> scm-js/tap/scmjs` updates the version and every
  `sha256` (or run `release-recipes.mjs` and commit its file). No bottle is needed: the
  formula installs the release's program as it is.

## Signing

None of the programs is code-signed, as the desktop installers are not. Windows shows
SmartScreen's warning the first time; macOS refuses a program downloaded in a browser until its
quarantine flag is cleared (`xattr -d com.apple.quarantine scmjs`); the docs say both.
Homebrew and Scoop downloads carry no quarantine flag. A Developer ID signature with
notarization (macOS) and an Authenticode signature (Windows) would go in
`scripts/build-cli-binary.mjs` after the injection, where the macOS programs are signed ad hoc
today.
