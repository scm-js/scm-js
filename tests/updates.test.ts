import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import type { UpdateAvailability, UpdateSupport } from "../src/gamedata/desktop";
import {
  canDownload, formatBytes, headline, isNews, progressLabel, RECHECK_MS,
  shouldCheckOnStart, stateFrom, supportOf, updateInfo, type UpdateState,
} from "../src/editor/updates";
import { updateProgressAtom, updateStateAtom } from "../src/atoms/updateAtoms";

const RELEASES = "https://github.com/scm-js/scm-js/releases";
const installable: UpdateSupport = { check: true, install: true, releasesUrl: RELEASES };
const checkOnly: UpdateSupport = { check: true, install: false, reason: "macOS will not install an unsigned update.", releasesUrl: RELEASES };
const neither: UpdateSupport = { check: false, install: false, reason: "This is a development build.", releasesUrl: RELEASES };

const available = (support: UpdateSupport, version = "0.2.0"): UpdateAvailability =>
  ({ status: "available", current: "0.1.0", support, version, bytes: 122 * 1024 * 1024 });

describe("update state", () => {
  it("maps each answer the bridge can give", () => {
    expect(stateFrom(available(installable), 100)).toMatchObject({ phase: "available", current: "0.1.0", at: 100, info: { version: "0.2.0" } });
    expect(stateFrom({ status: "current", current: "0.2.0", support: installable }, 1)).toMatchObject({ phase: "current", current: "0.2.0" });
    expect(stateFrom({ status: "unsupported", current: "0.1.0", support: neither }, 1)).toMatchObject({ phase: "unsupported" });
    expect(stateFrom({ status: "error", current: "0.1.0", support: installable, message: "offline" }, 1))
      .toMatchObject({ phase: "error", message: "offline" });
  });

  it("offers a download only where one could be installed", () => {
    expect(canDownload(stateFrom(available(installable), 0))).toBe(true);
    // macOS and a .deb install can see the update but not apply it: the dialog must show
    // the release page instead of a progress bar that would fail at the end.
    expect(canDownload(stateFrom(available(checkOnly), 0))).toBe(false);
    expect(canDownload({ phase: "current", current: "0.1.0", at: 0 })).toBe(false);
  });

  it("carries the update and its support facts through the download states", () => {
    const state = stateFrom(available(installable), 0) as Extract<UpdateState, { phase: "available" }>;
    const downloading: UpdateState = { phase: "downloading", current: "0.1.0", info: state.info, progress: null };
    expect(updateInfo(downloading)?.version).toBe("0.2.0");
    expect(supportOf(downloading)).toBe(installable);
    expect(updateInfo({ phase: "checking" })).toBeNull();
    // An unsupported build still knows where the releases are.
    expect(supportOf({ phase: "unsupported", current: "0.1.0", support: neither })?.releasesUrl).toBe(RELEASES);
  });

  it("never reads a declined check as up to date", () => {
    // electron-updater's AppImageUpdater resolves `checkForUpdates()` with null rather
    // than throwing when APPIMAGE is not in the environment, and a Linux build started
    // from an unpacked folder hits it. `desktop/updater.ts` turns that into "unsupported";
    // reading it as "current" would tell the user they are up to date when nothing was
    // ever fetched.
    const declined: UpdateAvailability = {
      status: "unsupported", current: "0.1.0",
      support: { check: false, install: false, reason: "scmJS was started from an unpacked folder.", releasesUrl: RELEASES },
    };
    const state = stateFrom(declined, 0);
    expect(state.phase).toBe("unsupported");
    expect(headline(state).title).toBe("Updates are not available in this build");
    expect(canDownload(state)).toBe(false);
    expect(isNews(state)).toBe(false);
  });

  it("only calls an available update news", () => {
    expect(isNews(stateFrom(available(installable), 0))).toBe(true);
    expect(isNews({ phase: "current", current: "0.1.0", at: 0 })).toBe(false);
    expect(isNews({ phase: "error", current: "0.1.0", message: "x" })).toBe(false);
  });

  it("words every phase", () => {
    expect(headline({ phase: "current", current: "0.1.0", at: 0 })).toEqual({ title: "scmJS is up to date", detail: "You have 0.1.0." });
    expect(headline(stateFrom(available(installable), 0)).title).toBe("scmJS 0.2.0 is available");
    expect(headline({ phase: "unsupported", current: "0.1.0", support: neither }).detail).toBe(neither.reason);
    expect(headline({ phase: "error", current: "0.1.0", message: "offline" }).detail).toBe("offline");
  });
});

describe("formatting", () => {
  it("sizes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    // A whole number keeps no trailing ".0".
    expect(formatBytes(2 * 1024 * 1024)).toBe("2 MB");
    expect(formatBytes(122 * 1024 * 1024)).toBe("122 MB");
    // Under 100 keeps a decimal; at or above it does not.
    expect(formatBytes(99.5 * 1024 * 1024)).toBe("99.5 MB");
  });

  it("progress", () => {
    expect(progressLabel(null)).toBe("Starting…");
    expect(progressLabel({ percent: 0, transferred: 0, total: 0, bytesPerSecond: 0 })).toBe("Starting…");
    expect(progressLabel({ percent: 58.4, transferred: 71 * 1024 * 1024, total: 122 * 1024 * 1024, bytesPerSecond: 4.2 * 1024 * 1024 }))
      .toBe("58% · 71 of 122 MB · 4.2 MB/s");
  });
});

describe("startup check", () => {
  it("skips when the preference is off, and when one just ran", () => {
    const now = 1_000_000_000;
    expect(shouldCheckOnStart(false, null, now)).toBe(false);
    expect(shouldCheckOnStart(true, null, now)).toBe(true);
    expect(shouldCheckOnStart(true, now - 60_000, now)).toBe(false);
    expect(shouldCheckOnStart(true, now - RECHECK_MS, now)).toBe(true);
  });
});

describe("progress events", () => {
  it("are ignored unless a download is what the renderer thinks is happening", () => {
    const store = createStore();
    const progress = { percent: 10, transferred: 1, total: 10, bytesPerSecond: 1 };
    // An event arriving while idle (a download started by an earlier window) must not
    // invent a downloading state out of nothing.
    store.set(updateProgressAtom, progress);
    expect(store.get(updateStateAtom).phase).toBe("idle");

    const info = { version: "0.2.0", support: installable };
    store.set(updateStateAtom, { phase: "downloading", current: "0.1.0", info, progress: null });
    store.set(updateProgressAtom, progress);
    expect(store.get(updateStateAtom)).toMatchObject({ phase: "downloading", progress });
  });
});
