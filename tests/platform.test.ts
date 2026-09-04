/**
 * The words the chrome uses for the shell it is running in. The desktop build is the same
 * bundle in an Electron window, so "this browser" has to become "this app" wherever the
 * copy says it — `hostTerms()` is the one place that decides.
 */
import { afterEach, describe, expect, it } from "vitest";
import { hostTerms, isDesktop } from "../src/editor/platform";

const global = globalThis as { scmjsDesktop?: unknown };

function pretendDesktop() {
  global.scmjsDesktop = { platform: "linux", version: "0.0.0" };
}

afterEach(() => {
  delete global.scmjsDesktop;
});

describe("hostTerms", () => {
  it("says browser when there is no desktop bridge", () => {
    expect(isDesktop()).toBe(false);
    const host = hostTerms();
    expect(host.desktop).toBe(false);
    expect(host.here).toBe("this browser");
    expect(host.Here).toBe("This browser");
    expect(host.Noun).toBe("Browser");
    expect(host.downloads).toBe("the browser's downloads folder");
  });

  it("says app once the bridge is there", () => {
    pretendDesktop();
    expect(isDesktop()).toBe(true);
    const host = hostTerms();
    expect(host.desktop).toBe(true);
    expect(host.here).toBe("this app");
    expect(host.Here).toBe("This app");
    expect(host.Noun).toBe("Application");
    expect(host.downloads).toBe("the downloads folder");
  });

  it("follows the bridge appearing and going away, so it can be read in a render", () => {
    expect(hostTerms().noun).toBe("browser");
    pretendDesktop();
    expect(hostTerms().noun).toBe("app");
    delete global.scmjsDesktop;
    expect(hostTerms().noun).toBe("browser");
  });
});
