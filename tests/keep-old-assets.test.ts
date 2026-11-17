import { describe, expect, it } from "vitest";
// @ts-expect-error -- a plain .mjs script with no declarations
import { filesToFetch, nextList, referencedAssets } from "../scripts/keep-old-assets.mjs";

const own = ["assets/main-B.js", "assets/ui-X.js"];

describe("keep-old-assets", () => {
  it("starts a list when the live site has none", () => {
    expect(nextList("1.1.0", own, null)).toEqual({ versions: [{ version: "1.1.0", files: own }] });
  });

  it("keeps the newest earlier builds, up to the limit, with this one first", () => {
    const live = { versions: ["1.0.3", "1.0.2", "1.0.1", "1.0.0"].map((version) => ({ version, files: [`assets/main-${version}.js`] })) };
    const list = nextList("1.1.0", own, live, 2);
    expect(list.versions.map((v: { version: string }) => v.version)).toEqual(["1.1.0", "1.0.3", "1.0.2"]);
  });

  it("replaces an entry of its own version: a re-deploy of a tag is that tag", () => {
    const live = { versions: [{ version: "1.1.0", files: ["assets/main-old.js"] }, { version: "1.0.0", files: ["assets/main-A.js"] }] };
    expect(nextList("1.1.0", own, live).versions.map((v: { version: string }) => v.version)).toEqual(["1.1.0", "1.0.0"]);
  });

  it("drops a path that is not one file under assets/, whatever the live list says", () => {
    const live = { versions: [{ version: "1.0.0", files: ["assets/ok-A.js", "../etc/passwd", "assets/../index.html", "index.html", "assets/sub/x.js", 7] }, "junk", { version: 3 }] };
    expect(nextList("1.1.0", own, live).versions[1]).toEqual({ version: "1.0.0", files: ["assets/ok-A.js"] });
  });

  it("fetches each earlier file once, and none this build already has", () => {
    const live = { versions: [
      { version: "1.0.1", files: ["assets/ui-X.js", "assets/main-A.js", "assets/shared.js"] },
      { version: "1.0.0", files: ["assets/main-Z.js", "assets/shared.js"] },
    ] };
    expect(filesToFetch(nextList("1.1.0", own, live), own)).toEqual(["assets/main-A.js", "assets/main-Z.js", "assets/shared.js"]);
  });

  it("ignores a list that is not one", () => {
    for (const live of [undefined, {}, { versions: "no" }, []]) {
      expect(nextList("1.1.0", own, live).versions).toHaveLength(1);
    }
  });

  it("finds the hashed files a page and a chunk name, in each form a Vite build writes them", () => {
    const page = '<script type="module" crossorigin src="/editor/assets/main-C3p5lFCU.js"></script><link rel="stylesheet" href="/editor/assets/src--C0cpcpV.css">';
    const chunk = 'import{t as e}from"./ui-BQognf9B.js";m.f=["assets/FileDialogs-C1P3b6nD.js"];new URL(`engine-Ab_d-123.wasm`,import.meta.url);"logo.svg"';
    expect(referencedAssets(page).sort()).toEqual(["assets/main-C3p5lFCU.js", "assets/src--C0cpcpV.css"]);
    expect(referencedAssets(chunk).sort()).toEqual(["assets/FileDialogs-C1P3b6nD.js", "assets/engine-Ab_d-123.wasm", "assets/ui-BQognf9B.js"]);
  });
});
