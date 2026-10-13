import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { GameDataBody } from "../components/dialogs/GameDataDialog";
import Toasts from "../components/chrome/Toasts";
import { formatBytes } from "../editor/save";
import { copyKind, type CopyKind } from "../gamedata/copies";
import { resolveAssetSource } from "../gamedata/source";
import { listStoredCopies, profileOf, type StoredCopy } from "../gamedata/store";
import { SITE_ORIGIN } from "../moveIn";
import { t } from "../i18n";

/**
 * The Game Data page (`data.html`, a second page of the same build): what this browser
 * holds of StarCraft's files, and the controls to add and remove it. It is Help ▸ Game
 * Data… without the editor around it — the site's header links here, so somebody can see
 * and manage what they have given without opening a map — and the controls are the
 * dialog's own (`GameDataBody`).
 *
 * The page resolves the source itself, as the editor's preload does, and nothing else of
 * the editor is started: no plugins, no map, no tileset.
 */

function kindLine(kind: CopyKind, copy: StoredCopy): string {
  switch (kind) {
    case "download": return t("Blizzard's free StarEdit download.");
    case "classic": return t("From your own StarCraft files ({from}).", { from: copy.from });
    case "remastered": return t("From your own installation ({from}).", { from: copy.from });
    case "mod": return t("A mod's files, laid over the game's.");
  }
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export default function GameDataPage() {
  const source = useAtomValue(gameDataSourceAtom);
  const setSource = useSetAtom(gameDataSourceAtom);
  const revision = useAtomValue(gameDataRevisionAtom);
  const [copies, setCopies] = useState<StoredCopy[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveAssetSource().then((found) => { if (!cancelled) setSource(found); }, () => {});
    return () => { cancelled = true; };
  }, [setSource]);

  useEffect(() => {
    let cancelled = false;
    listStoredCopies().then((list) => { if (!cancelled) setCopies(list); }, () => { if (!cancelled) setCopies([]); });
    return () => { cancelled = true; };
  }, [source, revision]);

  const onSite = window.location.origin === SITE_ORIGIN;
  const editor = import.meta.env.BASE_URL;

  return (
    <div className="pg">
      <header className="pg-top">
        <a className="pg-mark" href={onSite ? "/" : editor}>scm<span>JS</span></a>
        <span className="grow" />
        <a className="pg-cta" href={editor}>{t("Open the editor")}</a>
      </header>
      <main className="pg-main">
        <h1>{t("Game data")}</h1>
        <p className="pg-lede">
          {t("StarCraft's own files, which the editor draws terrain and units from. They are read on this computer and kept in this browser; nothing here is sent anywhere.")}
        </p>

        <section className="pg-section">
          <h2>{t("In this browser")}</h2>
          {copies === null ? (
            <p className="hint">{t("Looking…")}</p>
          ) : copies.length === 0 ? (
            <p className="pg-none">{source?.kind === "bundled" ? t("No copy is kept here: the files come with this build.") : t("Nothing yet.")}</p>
          ) : (
            <ul className="pg-copies">
              {copies.map((copy) => {
                const profile = profileOf(copy);
                const kind = copyKind(copy);
                return (
                  <li key={profile.id} data-kind={kind}>
                    <div className="pg-copy-name">
                      <strong>{profile.name}</strong>
                      {source?.kind === "stored" && source.profile.id === profile.id && <span className="badge gold">{t("In use")}</span>}
                    </div>
                    <div className="pg-copy-what">{kindLine(kind, copy)}</div>
                    <div className="pg-copy-facts dim">
                      {t("{n, plural, one {# file} other {# files}}", { n: copy.files })} · {formatBytes(copy.bytes)}{when(copy.at) ? ` · ${when(copy.at)}` : ""}
                      {copy.where === "memory" ? ` · ${t("until this tab closes")}` : ""}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="pg-section">
          <h2>{source && source.kind !== "none" ? t("Change it") : t("Add it")}</h2>
          <GameDataBody />
        </section>
      </main>
      <Toasts />
    </div>
  );
}
