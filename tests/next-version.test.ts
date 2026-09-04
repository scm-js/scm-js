import { describe, expect, it } from "vitest";
// @ts-expect-error - plain .mjs, no declarations
import { baseVersion } from "../scripts/next-version.mjs";
import semver from "semver";

const base = baseVersion as (tag: string | null, pkg: string) => string;
const nightly = (b: string) => `${b}-nightly.20260905.42`;

describe("the version main builds towards", () => {
  it("is a patch bump of the newest release tag", () => {
    expect(base("v0.8.0", "0.8.0")).toBe("0.8.1");
    expect(base("0.8.0", "0.8.0")).toBe("0.8.1");
    expect(base("v0.9.9", "0.9.9")).toBe("0.9.10");
    expect(base("v1.0.0", "1.0.0")).toBe("1.0.1");
  });

  it("uses package.json until something has shipped", () => {
    // Nothing released means nothing to downgrade, so the version being worked on stands.
    expect(base(null, "0.1.0")).toBe("0.1.0");
    expect(semver.lt(nightly("0.1.0"), "0.1.0")).toBe(true);
  });

  it("answers a prerelease tag with its release version", () => {
    expect(base("v1.0.0-beta.1", "0.9.0")).toBe("1.0.0");
    // Which has to sit above the beta and below the release itself.
    expect(semver.gt(nightly("1.0.0"), "1.0.0-beta.1")).toBe(true);
    expect(semver.lt(nightly("1.0.0"), "1.0.0")).toBe(true);
  });

  it("falls back rather than inventing a version from a tag it cannot read", () => {
    expect(base("vhello", "0.3.0")).toBe("0.3.0");
    expect(base("v1.2", "0.3.0")).toBe("0.3.0");
  });

  /**
   * The property the whole scheme exists for: a nightly must be newer than the release it
   * follows and older than every release that could plausibly come next — so the updater
   * offers it to nightly users whatever the next version number turns out to be.
   */
  it("never strands a nightly, whichever version is released next", () => {
    for (const released of ["0.8.0", "0.9.9", "1.0.0"]) {
      const b = base(`v${released}`, released);
      expect(semver.gt(nightly(b), released)).toBe(true);
      for (const next of [semver.inc(released, "patch")!, semver.inc(released, "minor")!, semver.inc(released, "major")!]) {
        expect(semver.lte(nightly(b), next)).toBe(true);
      }
    }
  });
});
