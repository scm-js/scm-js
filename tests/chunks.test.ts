import { describe, expect, it } from "vitest";
import { isChunkLoadError } from "../src/app/chunks";

const site = "https://scmjs.dev";

describe("a chunk of the editor's own that did not download", () => {
  it("is told by each browser's words", () => {
    for (const message of [
      "Failed to fetch dynamically imported module: https://scmjs.dev/editor/assets/FileDialogs-C1P3b6nD.js",
      "error loading dynamically imported module: https://scmjs.dev/editor/assets/FileDialogs-C1P3b6nD.js",
      "Importing a module script failed.",
      "Unable to preload CSS for https://scmjs.dev/editor/assets/src--C0cpcpV.css",
    ]) expect(isChunkLoadError(new TypeError(message), site), message).toBe(true);
    expect(isChunkLoadError(new Error("Unable to preload CSS for https://scmjs.dev/editor/assets/x-Ab12Cd34.css"), site)).toBe(true);
  });

  it("is the page's own: a plugin's module from a blob or another site is the plugin's to report", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: blob:https://scmjs.dev/7f0c2a"), site)).toBe(false);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://raw.githubusercontent.com/scm-js/plugin-x/v1/src/index.ts"), site)).toBe(false);
  });

  it("is the desktop app's own files too", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: file:///C:/Program%20Files/scmJS/resources/app/dist/assets/a-Ab12Cd34.js"), "null")).toBe(true);
  });

  it("is nothing else", () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'tiles')"), site)).toBe(false);
    expect(isChunkLoadError(new TypeError("Failed to fetch"), site)).toBe(false);
    expect(isChunkLoadError("Failed to fetch dynamically imported module: x", site)).toBe(false);
    expect(isChunkLoadError(undefined, site)).toBe(false);
  });
});
