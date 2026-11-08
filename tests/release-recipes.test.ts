/**
 * The install recipes in packaging/ filled for a release (scripts/lib/recipes.mjs, scripts/release-recipes.mjs): every
 * placeholder filled from SHA256SUMS, each archive's hash in its own place, and the archives' names the ones
 * scripts/build-cli-binary.mjs makes.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ARCHIVES, fillRecipe, parseSums, recipes, recipeValues } from "../scripts/lib/recipes.mjs";

const hash = (c: string) => c.repeat(64);
const SUMS = [
  `${hash("a")}  scmjs-cli-windows-x64.zip`,
  `${hash("b")} *scmjs-cli-macos-arm64.tar.gz`,
  `${hash("c")}  scmjs-cli-macos-x64.tar.gz`,
  `${hash("d")}  scmjs-cli-linux-x64.tar.gz`,
  `${hash("e")}  scmJS-windows-x64-setup.exe`,
  "",
].join("\n");

describe("the install recipes", () => {
  const values = recipeValues("1.2.3", parseSums(SUMS), "2026-11-08");
  const filled = Object.fromEntries(recipes("1.2.3").map((r) => [r.to, fillRecipe(readFileSync(r.from, "utf8"), values)]));

  it("reads sha256sum's lines, binary mark or not", () => {
    expect(parseSums(SUMS).get("scmjs-cli-macos-arm64.tar.gz")).toBe(hash("b"));
    expect(parseSums(SUMS).size).toBe(5);
  });

  it("fills every placeholder of every recipe", () => {
    expect(Object.keys(filled)).toEqual([
      "scoop/bucket/scmjs.json",
      "winget/manifests/s/scm-js/scmjs/1.2.3/scm-js.scmjs.yaml",
      "winget/manifests/s/scm-js/scmjs/1.2.3/scm-js.scmjs.installer.yaml",
      "winget/manifests/s/scm-js/scmjs/1.2.3/scm-js.scmjs.locale.en-US.yaml",
      "homebrew/Formula/scmjs.rb",
    ]);
    for (const [name, text] of Object.entries(filled)) expect(text, name).not.toMatch(/@[A-Z0-9_]+@/);
  });

  it("puts each archive's hash with its address", () => {
    const scoop = JSON.parse(filled["scoop/bucket/scmjs.json"]);
    expect(scoop.version).toBe("1.2.3");
    expect(scoop.architecture["64bit"]).toEqual({ url: "https://github.com/scm-js/scm-js/releases/download/v1.2.3/scmjs-cli-windows-x64.zip", hash: hash("a") });
    expect(scoop.autoupdate.architecture["64bit"].hash.url).toBe("$baseurl/SHA256SUMS");
    expect(filled["winget/manifests/s/scm-js/scmjs/1.2.3/scm-js.scmjs.installer.yaml"]).toContain(`InstallerSha256: "${hash("a")}"`);
    const brew = filled["homebrew/Formula/scmjs.rb"];
    for (const [file, c] of [["scmjs-cli-macos-arm64.tar.gz", "b"], ["scmjs-cli-macos-x64.tar.gz", "c"], ["scmjs-cli-linux-x64.tar.gz", "d"]])
      expect(brew).toContain(`url "https://github.com/scm-js/scm-js/releases/download/v1.2.3/${file}"\n      sha256 "${hash(c)}"`);
  });

  it("refuses a release whose sums lack an archive, unless asked to stand in for it", () => {
    const some = parseSums(`${hash("a")}  scmjs-cli-windows-x64.zip\n`);
    expect(() => recipeValues("1.2.3", some)).toThrow(/scmjs-cli-macos-arm64\.tar\.gz/);
    expect(recipeValues("1.2.3", some, "2026-11-08", hash("0")).missing).toEqual(Object.values(ARCHIVES).slice(1));
    expect(() => fillRecipe("@NOPE@", values)).toThrow(/@NOPE@/);
  });

  it("names the archives the build makes", () => {
    const build = readFileSync("scripts/build-cli-binary.mjs", "utf8");
    for (const file of Object.values(ARCHIVES)) expect(build).toContain(`asset: "${file.replace(/\.(zip|tar\.gz)$/, "")}"`);
  });
});
