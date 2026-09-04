/**
 * The desktop build's update check, as a pure state machine and the words that go with it.
 *
 * The main process side is `desktop/updater.ts` (electron-updater over the GitHub releases
 * `.github/workflows/build.yml` publishes); this is only what the renderer shows for each
 * answer it gets back. Nothing here touches the bridge, so `tests/updates.test.ts` can
 * drive every state without Electron.
 *
 * Two facts shape it. A build that cannot *install* an update can usually still *check*
 * for one — macOS until there is a signing identity, a Linux `.deb` install, both check
 * fine and neither can apply anything — so "an update exists" and "you can get it here"
 * are separate, and `canDownload` is what decides between a progress bar and a link to the
 * release page. And a check that failed is an ordinary state (the machine is offline),
 * never an exception: `UpdateAvailability` carries `status: "error"` rather than throwing.
 */
import type { UpdateAvailability, UpdateProgress, UpdateSupport } from "../gamedata/desktop";

export type UpdateState =
  /** Nothing asked yet. */
  | { phase: "idle" }
  | { phase: "checking" }
  /** The feed answered: this is the newest there is. */
  | { phase: "current"; current: string; at: number }
  | { phase: "available"; current: string; info: AvailableUpdate; at: number }
  | { phase: "downloading"; current: string; info: AvailableUpdate; progress: UpdateProgress | null }
  /** Written to disk and waiting for a restart. */
  | { phase: "downloaded"; current: string; info: AvailableUpdate }
  /** The check or the download failed — offline, or the feed answered something unusable. */
  | { phase: "error"; current: string; message: string; support?: UpdateSupport }
  /** This build cannot ask at all (a development build). */
  | { phase: "unsupported"; current: string; support: UpdateSupport };

export interface AvailableUpdate {
  version: string;
  support: UpdateSupport;
  notes?: string;
  date?: string;
  bytes?: number;
}

export const INITIAL_UPDATE_STATE: UpdateState = { phase: "idle" };

/** The bridge's answer as a state. `now` is injected so the tests are not clock-dependent. */
export function stateFrom(answer: UpdateAvailability, now: number): UpdateState {
  switch (answer.status) {
    case "available":
      return {
        phase: "available",
        current: answer.current,
        at: now,
        info: { version: answer.version, support: answer.support, notes: answer.notes, date: answer.date, bytes: answer.bytes },
      };
    case "current":
      return { phase: "current", current: answer.current, at: now };
    case "unsupported":
      return { phase: "unsupported", current: answer.current, support: answer.support };
    case "error":
      return { phase: "error", current: answer.current, message: answer.message, support: answer.support };
  }
}

/**
 * Whether the dialog offers a Download button. False whenever the platform could not
 * install what it downloaded — the dialog offers the release page instead, rather than a
 * progress bar that is going to fail at the end.
 */
export function canDownload(state: UpdateState): boolean {
  return (state.phase === "available" || state.phase === "downloading") && state.info.support.install;
}

/** The update the state is about, if any — what the dialog's buttons act on. */
export function updateInfo(state: UpdateState): AvailableUpdate | null {
  switch (state.phase) {
    case "available":
    case "downloading":
    case "downloaded":
      return state.info;
    default:
      return null;
  }
}

/** Whether a startup check found something worth raising a toast for. */
export function isNews(state: UpdateState): boolean {
  return state.phase === "available";
}

/** The support facts of whatever the state last learned, for the release-page link. */
export function supportOf(state: UpdateState): UpdateSupport | null {
  switch (state.phase) {
    case "available":
    case "downloading":
    case "downloaded":
      return state.info.support;
    case "unsupported":
      return state.support;
    case "error":
      return state.support ?? null;
    default:
      return null;
  }
}

export interface Headline {
  title: string;
  detail?: string;
}

/** What the dialog (and the toast) say for each state. */
export function headline(state: UpdateState): Headline {
  switch (state.phase) {
    case "idle":
      return { title: "Check for updates" };
    case "checking":
      return { title: "Checking for updates…" };
    case "current":
      return { title: "scmJS is up to date", detail: `You have ${state.current}.` };
    case "available":
      return { title: `scmJS ${state.info.version} is available`, detail: `You have ${state.current}.` };
    case "downloading":
      return { title: `Downloading scmJS ${state.info.version}`, detail: progressLabel(state.progress) };
    case "downloaded":
      return { title: `scmJS ${state.info.version} is ready to install`, detail: "It will be applied when scmJS restarts." };
    case "error":
      return { title: "Could not check for updates", detail: state.message };
    case "unsupported":
      return { title: "Updates are not available in this build", detail: state.support.reason };
  }
}

/** "58% · 71.4 of 122 MB · 4.2 MB/s", or the empty-ish start of a download. */
export function progressLabel(progress: UpdateProgress | null): string {
  if (!progress || !progress.total) return "Starting…";
  const parts = [`${Math.round(progress.percent)}%`, `${formatBytes(progress.transferred, false)} of ${formatBytes(progress.total)}`];
  if (progress.bytesPerSecond > 0) parts.push(`${formatBytes(progress.bytesPerSecond)}/s`);
  return parts.join(" · ");
}

/** Binary units, one decimal below 100 — the sizes here run from a few MB to a few hundred. */
export function formatBytes(bytes: number, withUnit = true): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  // One decimal, but never a bare ".0" — "71.0 of 122 MB" reads worse than "71 of 122 MB".
  const text = value >= 100 || unit === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
  return withUnit ? `${text} ${units[unit]}` : text;
}

/**
 * Whether a check is worth making now. The startup check is skipped when one already ran
 * recently, so opening several windows (or a reload in development) does not ask GitHub
 * every time.
 */
export const RECHECK_MS = 6 * 60 * 60 * 1000;

export function shouldCheckOnStart(enabled: boolean, lastCheck: number | null, now: number): boolean {
  if (!enabled) return false;
  return lastCheck === null || now - lastCheck >= RECHECK_MS;
}
