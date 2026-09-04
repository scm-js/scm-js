import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Download, ExternalLink, RefreshCw, RotateCw } from "lucide-react";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import {
  checkForUpdatesAtom, downloadUpdateAtom, openReleasesAtom, updateStateAtom,
} from "../../atoms/updateAtoms";
import { canDownload, formatBytes, headline, supportOf } from "../../editor/updates";
import { guardedAction } from "../../hooks/useMapFileActions";
import { desktopBridge } from "../../gamedata/desktop";
import { Button, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/**
 * Help ▸ Check for Updates…, and where the startup toast's Download leads.
 *
 * One dialog for every state the check can be in (`editor/updates.ts` holds the machine
 * and the words). The thing it is careful about is not promising what the platform cannot
 * do: a build that can check but not install — macOS while unsigned, a Linux `.deb`
 * install — gets the release page rather than a progress bar, and says why.
 *
 * Installing quits the app, so it goes through the same unsaved-changes gate as the window's
 * close button — the very same `guardedAction(…, "quit")` call `useCloseGuard` makes.
 */
export function UpdateDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const state = useAtomValue(updateStateAtom);
  const check = useSetAtom(checkForUpdatesAtom);
  const download = useSetAtom(downloadUpdateAtom);
  const openReleases = useSetAtom(openReleasesAtom);
  const prefs = useAtomValue(preferencesAtom);
  const [installing, setInstalling] = useState(false);

  // Opened from the Help menu with nothing known yet: ask straight away, so the dialog is
  // never a button the user has to find. Opened from the toast, the answer is already there.
  useEffect(() => {
    if (state.phase === "idle") void check({ nightly: prefs.updates.nightly });
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const words = headline(state);
  const support = supportOf(state);
  const busy = state.phase === "checking" || state.phase === "downloading" || installing;

  /** Quitting to install replaces the app, so an unsaved map is asked about first. */
  const install = async () => {
    setInstalling(true);
    const go = await guardedAction(store, async () => true, (done) => ({ action: "quit", done }));
    if (!go) { setInstalling(false); return; }
    await desktopBridge()?.updates.install();
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Software Update"
      icon={<RefreshCw size={14} />}
      size="sm"
      footerLeft={
        <Button size="sm" disabled={busy} onClick={() => void check({ nightly: prefs.updates.nightly })}>
          <RotateCw size={11} /> Check again
        </Button>
      }
      footer={<Button variant="primary" onClick={() => close(entry.key)}>Close</Button>}
    >
      <div className="stack">
        <Group title={words.title}>
          {words.detail && <p className="hint" style={{ margin: 0 }}>{words.detail}</p>}

          {state.phase === "downloading" && (
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg-0)", border: "1px solid var(--border)" }}>
                <div style={{ height: "100%", width: `${(state.progress?.percent ?? 0).toFixed(1)}%`, background: "var(--gold)", transition: "width 120ms linear" }} />
              </div>
            </div>
          )}

          {state.phase === "available" && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              {canDownload(state)
                ? <Button size="sm" variant="primary" onClick={() => void download()}><Download size={11} /> Download</Button>
                : <Button size="sm" variant="primary" onClick={() => openReleases(support?.releasesUrl)}><ExternalLink size={11} /> Open download page</Button>}
              {state.info.bytes !== undefined && canDownload(state) && <span className="hint">About {formatBytes(state.info.bytes)}.</span>}
            </div>
          )}

          {state.phase === "downloaded" && (
            <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
              <Button size="sm" variant="primary" disabled={installing} onClick={() => void install()}>Restart and install</Button>
              <span className="hint">Or leave it — it is applied the next time scmJS quits.</span>
            </div>
          )}
        </Group>

        {/* Why there is a link instead of a button. Shown whenever the platform cannot
            apply an update — except where the headline is already saying it, which is the
            "unsupported" phase. */}
        {support && !support.install && support.reason && support.reason !== words.detail && (
          <p className="hint">{support.reason}</p>
        )}

        {(state.phase === "current" || state.phase === "error" || (support && !support.install)) && (
          <div className="row" style={{ gap: 6 }}>
            <Button size="sm" onClick={() => openReleases(support?.releasesUrl)}><ExternalLink size={11} /> Releases on GitHub</Button>
          </div>
        )}
      </div>
    </DialogFrame>
  );
}
