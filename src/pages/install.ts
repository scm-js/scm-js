/**
 * The installer page (`install.html`): no interface, only an ear. Another page of this site
 * — the play page, which is not this program — frames it and hands over a StarCraft:
 * Remastered folder its visitor picked there; the copy is made here, by the same
 * extraction the Game Data page runs, and the other page is told how far it is and when
 * it is done. So the game is installed where the person happened to be asked for it, and
 * there is still one copy and one program that knows how to make it.
 *
 * The conversation, all of it with this page's own origin and no other:
 *   → `{ type: "scmjs.install.ready" }`                          said once, to the framing page
 *   ← `{ type: "scmjs.install", files: [{ path, file }], lighting? }`  a folder pick: each file with its path in the
 *                                                                 folder; `lighting`: keep what the real-time lighting reads
 *   → `{ type: "scmjs.install.progress", fraction, label }`
 *   → `{ type: "scmjs.install.done", copy }`                     the new copy's stamp
 *   → `{ type: "scmjs.install.error", message }`
 *
 * Where the copy goes: in the place of the game's own when there is none, or when what is
 * there is Blizzard's free download or an earlier Remastered copy (nothing is lost by
 * either); beside it, as the Remastered data set, when the person's own 1.16 copy is there.
 * The editor then starts with what was installed: Remastered graphics on and, where the
 * copy went in beside another, that data set chosen (`gamedata/remasteredDefault.ts`) —
 * somebody who gave the site their Remastered folder to play with expects the editor to
 * draw with it too.
 */
import { browserStorage } from "../atoms/storage";
import { copyKind } from "../gamedata/copies";
import { installFromPickedRemastered } from "../gamedata/install";
import { REMASTERED_PROFILE } from "../gamedata/profiles";
import type { PickedFile } from "../gamedata/remasteredFolder";
import { startWithRemastered } from "../gamedata/remasteredDefault";
import { storedCopy } from "../gamedata/store";

let busy = false;

window.addEventListener("message", (e: MessageEvent) => {
  if (e.origin !== location.origin || !e.source) return;
  const data = e.data as { type?: unknown; files?: unknown; lighting?: unknown } | null;
  if (!data || data.type !== "scmjs.install") return;
  const reply = (message: object) => (e.source as Window).postMessage(message, location.origin);
  if (busy) { reply({ type: "scmjs.install.error", message: "An installation is already running." }); return; }
  const files = (Array.isArray(data.files) ? data.files : []).filter((f): f is PickedFile => !!f && typeof (f as PickedFile).path === "string" && (f as PickedFile).file instanceof Blob);
  busy = true;
  void (async () => {
    try {
      const existing = await storedCopy();
      const kind = existing ? copyKind(existing) : null;
      const beside = kind === "classic" || kind === "mod";
      const copy = await installFromPickedRemastered(files, (fraction, label) => reply({ type: "scmjs.install.progress", fraction, label }), beside ? REMASTERED_PROFILE : undefined, { lighting: data.lighting === true });
      startWithRemastered(browserStorage(), beside ? REMASTERED_PROFILE.id : undefined);
      reply({ type: "scmjs.install.done", copy });
    } catch (err) {
      reply({ type: "scmjs.install.error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
    }
  })();
});

if (window.parent !== window) window.parent.postMessage({ type: "scmjs.install.ready" }, location.origin);
