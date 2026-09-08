import { atom } from "jotai";
import type { PreloadStep } from "../services/preload";
import { msg } from "../i18n";

/** Progress of the startup asset preload; the splash renders it. See services/preload.ts. */
export const preloadStepAtom = atom<PreloadStep>({
  progress: 0,
  completed: 0,
  total: 5,
  label: msg("Initializing renderer"),
  done: false,
});

/** Every task the preload has finished, newest last — the splash's log. */
export const preloadLogAtom = atom<{ label: string; failed?: string }[]>([]);
