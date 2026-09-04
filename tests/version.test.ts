import { describe, expect, it } from "vitest";
import { shortVersion } from "../src/version";

// The splash's version line. A nightly's version is a patch bump of the newest release tag
// plus a prerelease (`scripts/next-version.mjs`, build.yml), so the channel has to survive
// the trim or the splash names a release that has not shipped.
describe("shortVersion", () => {
  it("leaves a release alone", () => {
    expect(shortVersion("0.1.0")).toBe("0.1.0");
    expect(shortVersion("1.10.2")).toBe("1.10.2");
  });

  it("keeps the channel and drops the date and run number", () => {
    expect(shortVersion("0.1.1-nightly.20260904.42")).toBe("0.1.1-nightly");
    expect(shortVersion("0.1.1-dev.20260904.7")).toBe("0.1.1-dev");
    expect(shortVersion("1.0.0-beta.1")).toBe("1.0.0-beta");
  });

  it("handles a prerelease with no dot, and build metadata", () => {
    expect(shortVersion("1.0.0-rc")).toBe("1.0.0-rc");
    expect(shortVersion("1.0.0-nightly+abc1234")).toBe("1.0.0-nightly");
    expect(shortVersion("1.0.0+abc1234")).toBe("1.0.0");
  });
});
