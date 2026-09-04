/**
 * Which shell the editor is running in, and the words the chrome should use for it.
 *
 * The desktop build is the same bundle in an Electron window, so every "this browser" the
 * copy was written with reads wrong there: nobody who double-clicked an application thinks
 * of it as a browser, even though one is underneath. `hostTerms()` is the one place that
 * decides, so a string is written once and says "browser" or "app" by itself.
 *
 * It is deliberately only about *wording*. What the shell can actually do — a folder
 * picker, a game to start, a window to hold closed — is asked of `desktopBridge()` and the
 * platform APIs themselves; a term here never gates behaviour.
 */

import { desktopBridge } from "../gamedata/desktop";

/** Whether this is the desktop build (the Electron bridge is there). */
export function isDesktop(): boolean {
  return desktopBridge() !== null;
}

export interface HostTerms {
  /** True in the desktop build; the fields below are its wording. */
  desktop: boolean;
  /** Mid-sentence noun: "browser" / "app" — "the {noun} could not decode it". */
  noun: string;
  /** The same word as a heading or the start of a sentence: "Browser" / "Application". */
  Noun: string;
  /** "this browser" / "this app" — "kept in {here}". */
  here: string;
  /** The same at the start of a sentence: "This browser" / "This app". */
  Here: string;
  /** Where a saved file lands: "the browser's downloads folder" / "the downloads folder". */
  downloads: string;
}

const BROWSER: HostTerms = {
  desktop: false,
  noun: "browser",
  Noun: "Browser",
  here: "this browser",
  Here: "This browser",
  downloads: "the browser's downloads folder",
};

const DESKTOP: HostTerms = {
  desktop: true,
  noun: "app",
  Noun: "Application",
  here: "this app",
  Here: "This app",
  downloads: "the downloads folder",
};

/** The words for the shell this is running in. Cheap enough to call in a render. */
export function hostTerms(): HostTerms {
  return isDesktop() ? DESKTOP : BROWSER;
}
