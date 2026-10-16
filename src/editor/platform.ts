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
import { msg, translate } from "../i18n";

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
  noun: msg("browser"),
  Noun: msg("Browser"),
  here: msg("this browser"),
  Here: msg("This browser"),
  downloads: msg("the browser's downloads folder"),
};

const DESKTOP: HostTerms = {
  desktop: true,
  noun: msg("app"),
  Noun: msg("Application"),
  here: msg("this app"),
  Here: msg("This app"),
  downloads: msg("the downloads folder"),
};

/** The words for the shell this is running in. Cheap enough to call in a render. */
export function hostTerms(): HostTerms {
  const terms = isDesktop() ? DESKTOP : BROWSER;
  return { desktop: terms.desktop, noun: translate(terms.noun), Noun: translate(terms.Noun), here: translate(terms.here), Here: translate(terms.Here), downloads: translate(terms.downloads) };
}
