import { atom } from "jotai";

/**
 * The open map that is linked to `scmjs` on this computer (services/editorLink.ts), by its
 * document id, or null. One link at a time, and not a per-document register: the id says
 * which map it is, so the status bar shows it only while that map is in front.
 */
export const linkedDocumentAtom = atom<{ id: number; name: string } | null>(null);
