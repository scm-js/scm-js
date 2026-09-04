/**
 * The desktop build's update check, as the renderer holds it. The state machine and every
 * string it shows are `editor/updates.ts` (pure, tested); this is the part that talks to
 * `window.scmjsDesktop.updates` and keeps one answer for the whole app, so the Help item,
 * the startup toast and Preferences all read the same thing.
 *
 * There is exactly one check in flight at a time (`checkingAtom` guards it) and the
 * progress events are subscribed once, by `hooks/useUpdateCheck.ts`.
 */
import { atom } from "jotai";
import { desktopBridge } from "../gamedata/desktop";
import type { UpdateProgress } from "../gamedata/desktop";
import { INITIAL_UPDATE_STATE, stateFrom, updateInfo, type UpdateState } from "../editor/updates";

export type { UpdateState } from "../editor/updates";

export const updateStateAtom = atom<UpdateState>(INITIAL_UPDATE_STATE);

/** When the last check finished, so the startup one can be skipped if it just ran. */
export const lastUpdateCheckAtom = atom<number | null>(null);

const inFlight = atom(false);

/**
 * Ask the feed. Answers the state it settled on, so a caller (the startup check) can act
 * on the result without subscribing. Never throws — a bridge that is not there, or a
 * check already running, simply leaves the state alone.
 */
export const checkForUpdatesAtom = atom(null, async (get, set, options: { nightly: boolean }): Promise<UpdateState> => {
  const bridge = desktopBridge();
  if (!bridge || get(inFlight)) return get(updateStateAtom);
  set(inFlight, true);
  set(updateStateAtom, { phase: "checking" });
  try {
    const answer = await bridge.updates.check(options.nightly);
    const next = stateFrom(answer, Date.now());
    set(updateStateAtom, next);
    set(lastUpdateCheckAtom, Date.now());
    return next;
  } catch (err) {
    // The bridge itself failing is still just a failed check.
    const next: UpdateState = { phase: "error", current: bridge.version, message: err instanceof Error ? err.message : String(err) };
    set(updateStateAtom, next);
    return next;
  } finally {
    set(inFlight, false);
  }
});

/**
 * Start the download of whatever the last check found. Progress arrives through the
 * subscription in `useUpdateCheck`, so this only has to move the state and report a
 * refusal — the "downloaded" state comes from the event, not from here.
 */
export const downloadUpdateAtom = atom(null, async (get, set) => {
  const bridge = desktopBridge();
  const state = get(updateStateAtom);
  const info = updateInfo(state);
  if (!bridge || !info || state.phase !== "available") return;
  set(updateStateAtom, { phase: "downloading", current: state.current, info, progress: null });
  const result = await bridge.updates.download();
  if (!result.ok) {
    set(updateStateAtom, { phase: "error", current: state.current, message: result.message ?? "The download failed.", support: info.support });
  }
});

/** A `download-progress` event; ignored unless a download is what we think is happening. */
export const updateProgressAtom = atom(null, (get, set, progress: UpdateProgress) => {
  const state = get(updateStateAtom);
  if (state.phase !== "downloading") return;
  set(updateStateAtom, { ...state, progress });
});

export const updateDownloadedAtom = atom(null, (get, set) => {
  const state = get(updateStateAtom);
  const info = updateInfo(state);
  if (!info) return;
  set(updateStateAtom, { phase: "downloaded", current: "current" in state ? state.current : "", info });
});

export const updateFailedAtom = atom(null, (get, set, message: string) => {
  const state = get(updateStateAtom);
  const info = updateInfo(state);
  set(updateStateAtom, { phase: "error", current: "current" in state ? state.current : "", message, support: info?.support });
});

/** Open the releases page — every case that cannot install, and "what changed". */
export const openReleasesAtom = atom(null, (_get, _set, url?: string) => {
  void desktopBridge()?.updates.openReleases(url);
});
