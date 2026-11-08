// The install recipes in packaging/ (Scoop, winget, Homebrew) filled for one release: the version, the date, and each
// archive's SHA-256 from the release's SHA256SUMS. Pure, for scripts/release-recipes.mjs and tests/release-recipes.test.ts.

/** The placeholder each archive's checksum fills, and the archive (scripts/build-cli-binary.mjs names them). */
export const ARCHIVES = {
  SHA256_WINDOWS_X64: "scmjs-cli-windows-x64.zip",
  SHA256_MACOS_ARM64: "scmjs-cli-macos-arm64.tar.gz",
  SHA256_MACOS_X64: "scmjs-cli-macos-x64.tar.gz",
  SHA256_LINUX_X64: "scmjs-cli-linux-x64.tar.gz",
};

/** Each recipe in packaging/ and where its filled copy goes, laid out as the bucket, winget-pkgs and the tap lay them out. */
export const recipes = (version) => [
  { from: "packaging/scoop/scmjs.json", to: "scoop/bucket/scmjs.json" },
  ...["scm-js.scmjs.yaml", "scm-js.scmjs.installer.yaml", "scm-js.scmjs.locale.en-US.yaml"].map((f) => ({ from: `packaging/winget/${f}`, to: `winget/manifests/s/scm-js/scmjs/${version}/${f}` })),
  { from: "packaging/homebrew/scmjs.rb", to: "homebrew/Formula/scmjs.rb" },
];

/** sha256sum's lines (`<hash>  <name>`, or `<hash> *<name>`) as name → hash. */
export function parseSums(text) {
  const sums = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(.+?)\s*$/i.exec(line);
    if (m) sums.set(m[2], m[1].toLowerCase());
  }
  return sums;
}

/**
 * The values the placeholders take. An archive missing from the sums is an error, not an empty hash — unless
 * `missing` is given (a local build of some targets), whose hash stands in and is named in the result's `missing`.
 */
export function recipeValues(version, sums, date = new Date().toISOString().slice(0, 10), missing = null) {
  const values = { VERSION: version, DATE: date };
  for (const [key, file] of Object.entries(ARCHIVES)) {
    let hash = sums.get(file);
    if (!hash && missing) { hash = missing; (values.missing ??= []).push(file); }
    if (!hash) throw new Error(`SHA256SUMS has no line for ${file}`);
    values[key] = hash;
  }
  return values;
}

/** A recipe with every `@NAME@` filled; a name with no value is an error. */
export function fillRecipe(text, values) {
  return text.replace(/@([A-Z0-9_]+)@/g, (_, name) => {
    if (!(name in values)) throw new Error(`No value for @${name}@`);
    return values[name];
  });
}
