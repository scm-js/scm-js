import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { viewOnlyAtom } from "../../atoms/editorAtoms";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { pluginFileTypesAtom } from "../../atoms/pluginAtoms";
import { heldGameData, type HeldGameData } from "../../gamedata/copies";
import { listStoredCopies } from "../../gamedata/store";
import { opensReplays } from "../../plugins/fileTypes";
import { SITE_PAGES } from "../../site";
import { t, tc } from "../../i18n";

/**
 * The site's own items at the right end of the menu bar, for an editor that is on the site
 * (`platform.ts#isOnSite`; `MenuBar` renders this nowhere else): the two other doors, Play
 * and Replays, what this browser holds of the game, and the library. They are the site
 * header's items in the editor's bar, so the one bar reads as part of the site.
 *
 * They are plain links that leave the editor in the same tab, as the site's own header
 * does. Unsaved work is asked about by `useCloseGuard`'s `beforeunload`, exactly as when
 * the tab is closed; Ctrl or a middle click opens one beside the editor instead.
 */
export default function SiteNav() {
  // A map open to look at only, in an editor where a plugin opens replays, is a replay's: that door is where the person is.
  const viewOnly = useAtomValue(viewOnlyAtom) !== null;
  const replays = opensReplays(useAtomValue(pluginFileTypesAtom));
  const inReplays = viewOnly && replays;
  return (
    <nav className="site-nav" aria-label="scmjs.dev">
      <a className="site-door" href={SITE_PAGES.play}>{tc("site", "Play")}</a>
      <a className={`site-door replays${inReplays ? " here" : ""}`} href={SITE_PAGES.replays} aria-current={inReplays ? "page" : undefined}>{tc("site", "Replays")}</a>
      <GameDataChip />
      <a className="site-door library" href={SITE_PAGES.library}>{tc("site", "Library")}</a>
    </nav>
  );
}

function heldLabel(held: HeldGameData): string {
  switch (held) {
    case "none": return t("No game data");
    case "download": return t("Editor graphics");
    case "classic": return t("StarCraft 1.16");
    case "remastered": return t("StarCraft: Remastered");
    case "both": return t("StarCraft 1.16 + Remastered");
  }
}

/**
 * What this browser holds of the game's files, as the site's header says it (the rule is
 * `copies.ts#heldGameData`, the words are the header's), linking to the Game Data page where
 * copies are added and removed. Out of the bar until the copies have been listed.
 */
function GameDataChip() {
  const source = useAtomValue(gameDataSourceAtom);
  const revision = useAtomValue(gameDataRevisionAtom);
  const [held, setHeld] = useState<HeldGameData | null>(null);

  // Listed again whenever the source or what is installed changes, as the Game Data page does.
  useEffect(() => {
    let cancelled = false;
    listStoredCopies().then((copies) => { if (!cancelled) setHeld(heldGameData(copies)); }, () => { if (!cancelled) setHeld("none"); });
    return () => { cancelled = true; };
  }, [source, revision]);

  if (held === null) return null;
  const label = heldLabel(held);
  const title = held === "none"
    ? (source?.kind === "bundled" ? t("No copy is kept here: the files come with this build.") : t("This browser holds none of StarCraft's files. Click to add them."))
    : held === "download" ? t("The editor's graphics, from Blizzard's free download. Click to manage them.")
      : t("Files from your own StarCraft are kept in this browser. Click to manage them.");
  return (
    <a className="site-data" href={SITE_PAGES.gameData} data-state={held === "none" ? "none" : held === "download" ? "download" : "own"} title={title} aria-label={label}>
      <span className="site-data-dot" aria-hidden />
      <span className="site-data-label">{label}</span>
    </a>
  );
}
