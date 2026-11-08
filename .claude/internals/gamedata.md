# Game data sources, data sets, extraction

### Game data sources, extraction, desktop, releases (`src/gamedata/`, `desktop/`, `.github/workflows/build.yml`)

Both loaders fetch every file through `gamedata/source.ts#fetchAsset`, which resolves the session's
`AssetSource` once (`resolveAssetSource`, shared promise; `resetAssetSource` / `setAssetSource` after
Help ▸ Game Data… changes it) by running `locateGameData(deps)` — a pure chain over injected probes
(`tests/gamedata.test.ts` pins the order): **bundled** (`BASE_URL` + `tileset/manifest.json` or
`unit/manifest.json` answers JSON — a dev server answers index.html with 200, hence the parse), **stored**
(`store.ts`: the OPFS copy under `gamedata/` with a `stamp.json` written last; a memory `Map` when there is
no OPFS), **desktop** (`window.scmjsDesktop.gameData.locate()`, then it is bundled again — the source carries
`desktop: true`), **none**. There is deliberately no fifth step: the configured web address
(`VITE_GAME_DATA_URL` and a `gameDataUrl` preference over it, serving an extracted tree or the two archives)
was **removed** along with `installFromUrl`, the `remote` source kind and the CI variable — nothing is
fetched from an address the user did not name, and the chain running out and asking is easier to explain
than four ways of not being asked. The preload's first task is the resolution (progress on the splash for a
desktop extraction); `usePreload` mirrors the source into `gameDataSourceAtom` and opens the `gameData`
dialog with `{ auto: true }` when it ends at none — through `offerGameDataWhenClear`, which waits for `pluginsStartedAtom` (first activation pass settled, capped at `PLUGIN_WAIT_MS`) and then for `dialogStackAtom` to be empty (a link's Join / Open a Copy dialog raced it and was hidden under it on a slow probe; tests/gamedata-offer.test.ts). A plugin dialog that never closes means no offer; Help ▸ Game Data… still works. After an install the dialog calls `retryFailedParts`
(drops the `LazyFiles` nulls) / `retryTilesetParts` and bumps `gameDataRevisionAtom`, which `useTileset` /
`useUnitAssets` depend on — that is how a map already open picks the graphics up. It also calls
`useMapFileActions.ts#relayBlankTerrain`: the startup map was laid by `flatTerrain` with no CV5 to pick
variations from, so every pair took variation 0 — invisible under flat colours, and one megatile repeated
across the map the moment the graphics land. `newMapInto` records that fill in `blankFillAtom`
(`gameDataAtoms.ts`, cleared by `loadDocumentAtom` / `closeDocumentAtom`) and the relay lays the tiles and
ISOM again in place, leaving the map unmodified; it refuses once the map has been edited or has a path, so
a file's own terrain is never touched. `tests/blank-fill.test.ts`.

**Data sets** (`gamedata/profiles.ts`, `services/gameData.ts`): the editor draws from one set of
game files at a time, and a `GameDataProfile` (id + name) names it — `DEFAULT_PROFILE` is the game's
own; any other is a mod's, the same formats with files replaced, installed under its id
(`installDataSet`: the game's two archives required, the mod's archives and loose files laid over
them through `readerFor`'s overlay; `splitPickedFiles` turns a picked folder into that) and stored
under `gamedata-profiles/<id>/` beside the game's `gamedata/` (`store.ts#profileDir`, every store
function takes the id, `listStoredCopies`). The choice is `scmjs.gameData` (`gameDataProfileAtom`,
in `STORED_RESETS`; the resolver reads the key itself through `activeProfileId` since it runs
outside the store) and the chain asks for the chosen set's copy first, falling back to the game's
own with a note in `tried`. `AssetSource.profile` says which set answered. Switching is
`switchDataSet`: everything decoded describes the old files under the same ids, so it drops the lot
(`resetUnitAssets`, `releaseAllTilesets`, `clearFrameCache`, `clearComposedImages`), resolves again
and bumps `gameDataRevisionAtom` — `useUnitAssets` now re-reads `peekUnitAssets` on every bump
rather than keeping what it had. `api.gameData` and the `"gameData"` event are the plugin side
(`host.ts#gameDataApi`); `api.gameData.read(path)` (`host.ts#readGameFile`) hands a plugin one extracted file through `fetchAsset`, null for a missing one — a dev server's `text/html` fallback included. `extract.ts#EXTRA_TABLES` (`arr/orders.dat`; since 2026-11-08 also `portdata.dat/.tbl` and `mapdata.dat/.tbl`, so with `UNIT_TABLES` and `SOUND_TABLES` the copy holds all fifteen `arr\` files 1.16.1 has — pinned by `tests/datasets-widths.test.ts` "the extraction's tables"; `DATEX_TABLES` gained `portdata`/`mapdata`) is copied though the editor never reads it: OpenBW, behind Walkability's game pathing, will not start without it, and a stored copy made before 2026-09-25 lacks it (the plugin says to reinstall). The Mod Editor compared a mod's `mapdata`/`portdata` against a copy without them and counted them as changed, which is why all of `arr\` is kept now; a copy or `public/` extracted before 2026-11-08 lacks the four (`tests/gamedata.test.ts`'s byte-for-byte comparison with `public/` tolerates exactly those, `ADDED_SINCE`; `npm run extract` brings them). The play set already had `portdata` at the same path, so `copyPlaySet` now skips it (`result.files.has`). `extract.ts#ICON_FILES` (`unit/cmdbtns/cmdicons.grp` + `ticon.pcx`, 2026-10-15) are copied when present for `api.graphics.icon` (`plugins-host.md`); an older copy lacks them and plugins show names. A data set is a name over files in the game's formats — at any width since M4 (below); the CHK's
settings sections stay the format's.

**Names from the data** (`data/gameNames.ts`): `stat_txt.tbl` (entries 0–227 the unit types as
`Name\0Subname\0Category`, read by `decodeTblEntries`; the `label` columns of `weapons.dat` /
`upgrades.dat` / `techdata.dat` point into it, now decoded) gives the game's own names; the editor's
tables are StarEdit's. The rule is per entry: the data's name where it differs from what the
game's own data says for that id, StarEdit's elsewhere — so Blizzard's files change nothing and a
mod's renames show. `GAME_*` there are the game's names where they differ from StarEdit's,
generated from the real files and pinned in `tests/names.test.ts`; `namesFromAssets` builds a
`LoadedNames` (null per slot where the table stands) that `units/load.ts` installs through
`installNames` when the tables arrive, and `unitName` / `weaponName` / `upgradeName` / `techName`
read it first, so every caller follows. `UNIT_NAMES` stays the text trigger format's vocabulary;
`unitByName` accepts the loaded names too. Lists built once at import were the trap here: the
palette's and the settings dialogs' item lists are built per render or on the revision now.
(`UPGRADE_NAMES` had Plasma Shields at 7 where `upgrades.dat` has it at 15; fixed, with
`UPGRADE_RACE`.)

**The Game Data page** (`data.html` → `src/pages/data.tsx` → `pages/GameDataPage.tsx`, 2026-10-12): a
second Vite input (`build.rollupOptions.input` in `vite.config.ts`; the editor's entry chunk is
therefore `main-*.js`, not `index-*.js`), served at `scmjs.dev/editor/data` (Pages answers `/data`
with `data.html`; `vite preview` and the dev server want `/data.html`). It is the site's "what has
this browser been given": the list of `listStoredCopies()` with `gamedata/copies.ts#copyKind` saying
what each is (`download` = the stamp's `from` is an address, `classic` = archive names, `remastered` =
`isRemasteredOrigin` or the Remastered profile, `mod` = any other profile), over `GameDataBody` — the
dialog's whole body, split out of `GameDataDialog` so the page and the dialog are one set of controls
(`onReady` is how the dialog still closes itself after an automatic offer). The page resolves the
source itself and starts nothing else of the editor, but `services/gameData.ts` drags `documentAtoms`
and the map services in, so it loads ~900 KB of chunks the editor shares (cached for whoever has
opened the editor); splitting `adoptSource`'s editor half off would fix that and has not been done.
Its entry imports `moveIn` first, like `main.tsx`. `styles/pages.css` undoes `base.css`'s
`overflow: hidden` with `html:has(.pg)`. `e2e/dataPage.spec.ts` seeds a stamp in OPFS and reads the
list back. **`site/header.js` is a second reader of the stamps** (plain JS, no build, so it cannot
import `copies.ts`): it walks `gamedata/` and `gamedata-profiles/*/` for `stamp.json` and applies
the same rule to label the site's top bar. Change the rule or the stamp's shape and change both. The
same script is a second client of the scmjs.dev account: it reads and writes the session in
`scmjs.plugin.scmjs-dev.settings` and runs the plugin's popup sign-in (`/v1/auth/start`, the
`scmjs-ai-auth` message), so those names are a contract with the site too.

`GameDataDialog.tsx` shows one thing at a time: with data it is a status line ("Now") and Remove copy;
without, the status line is replaced by a caution notice (`.gd-alert`) saying what the editor cannot draw,
because flat colours and coloured markers read as broken rather than unconfigured, and the two routes are
weighted rather than listed — the download is a card (`.gd-card`) carrying the one large button
(`.gd-cta`), the user's own archives the quieter `.gd-alt` under it, and the footer says "Continue without
graphics" so leaving is a choice rather than a dismissal. **Download from Blizzard** (`install.ts#installFromZipUrl` over `BLIZZARD_ZIP_URL`) reads
Blizzard's own free StarEdit package — trimmed StarDat/BrooDat plus a `patch_rt.mpq`, all three fetched and
laid in the game's order. **The patch is not optional** (until 2026-10-15 it was skipped on the belief that it
"changes seven tables" away from the other routes): those seven — `units/weapons/flingy/techdata/upgrades.dat`,
`stat_txt.tbl`, `aiscript.bin` — are the 1.16.1 balance patch, which StarDat/BrooDat alone predate (22 bytes
of `units.dat`), and the folder route and the Remastered route both have the patched ones. With it, the editor's
938 files and the 1,301 of the play set (1,119 sounds) are byte for byte a 1.16.1 install's (measured
2026-10-15 by running `extractGameData` + `copyPlaySet` over both). A `public/arr` extracted from StarDat/BrooDat
without the patch is the old tables; re-extract. `zip.ts` is the pure part: a `RangeReader` (`httpRangeReader` over `fetch`, with an
`onProgress` that streams so an 82 MB member does not freeze the bar), `readZipDirectory` (EOCD then the
central directory, Zip64 reported rather than misread), `readZipMember` (the *local* header is measured
rather than trusting the directory's copy of its extra field, then `DecompressionStream("deflate-raw")`)
and `findMembers` (by base name, ignoring folder and case). Only 83 MB of the 101 MB zip is transferred and
no zip library is needed; `tests/zip.test.ts` drives it all over a zip built in the test. It goes through
`github.com/scm-js/cloudflare-blizzard-forwarder`, a Cloudflare Worker at `gamedata.scmjs.dev` that adds
the CORS header and forwards ranges, because `download.blizzard.com` serves a `*.cloudfront.net`
certificate, plain HTTP is mixed content, and no route there sends `Access-Control-Allow-Origin`; the
desktop uses the same address, its renderer being an ordinary page. The second route is **files / folder**
(`installFromFiles` → `extract.worker.ts`, which writes the OPFS copy with sync access handles — the one
write path every browser has, worker-only — or posts the files back for `keepInMemory`) with the desktop's
search / folder picker beside it. The desktop's Remove resolves again with `{ search: false }` so it does
not extract the same files straight back.

`extract.ts` is the extraction itself, pure and dependency-free apart from `iscript.ts` (`.ts` import
specifiers on purpose: Node's type stripping runs it), producing the exact bytes and manifests the old
scripts wrote — `scripts/extract-*.mjs` are thin wrappers now, `archives.ts` is the mopaq side. Never
redistribute what it produces: the forwarder passes Blizzard's own download through and keeps nothing, and
no build ships game data or an address to fetch it from.

**StarCraft: Remastered** (`gamedata/remastered.ts`, 2026-10-09): a Remastered installation has
no MPQs — CASC storage under `Data/`, read with `kascade` (ours, the sibling of mopaq; the main
entry is universal, `kascade/node` is the `node:fs` source the desktop uses). It is a third
*reader*, not a third extraction: `extractRemastered(storage)` produces the same
`GameDataExtraction`, so the stored copy, the manifests and the loaders are untouched. The one
structural problem is that `ReadMember` is synchronous and a storage is not. Rather than make the
extraction async (the Node scripts run it under type stripping, and every caller would change) or
keep a second list of which members it wants, the extraction is **run until it asks for nothing
new**: each pass answers from a `Map` of what has been read and records the misses, the misses are
read (24 at a time), and it goes again. `UNIT_TABLES` / `EXTRA_TABLES` are read up front because
`extractUnits` throws at the *first* missing table, which would otherwise cost a pass per table;
with them seeded it is three passes (tables → tilesets and graphics → nothing), ~1 s against a
local install. `tests/remastered.test.ts` proves the passes against the 1.16 archives standing in
for a storage (byte-equal to a direct extraction; needs `fixtures/data/`), and
`SCM_REMASTERED_DIR=<folder>` adds a run over a real installation (guarded with `if`, not
`skipIf`: it imports `kascade/node`).

What differs in the files (measured 2026-10-09, all eight tilesets): the tile tables are a
**strict superset** of 1.16's. `vx4ex` (already preferred by `tileset/load.ts`) + `vr4` compose
every 1.16 megatile to identical pixels, `vf4` and `wpe` match over the 1.16 range, and the only
in-range `cv5` changes (Platform, Desert, Twilight) are groups that had no megatiles before. Seven
tilesets gained megatiles and groups (Badlands 4844→6172 megatiles; Installation unchanged). So a
1.16 map draws the same from either, and a map using the added tiles draws *only* from these —
which is why the dialog offers Remastered beside an existing copy and not just in its place. The
`.dat` tables, `iscript.bin` and the GRPs are the patched ones (what StarEdit.zip's `patch_rt.mpq`
gives, which the download route lays over its archives): 934 files, 46 MB, 748 graphics —
plus the eight 2x terrain files (`tileset/<name>.hd.vr4`, 104 MB together, `extractTilesets`'s
`HD_TILES`; see `tileset.md`) and the 2x sprites of the reachable images that have one
(`unit/hd/main_NNN.anim`, 780 files, 216 MB after `slimAnim`; see `units.md`) — 1722 files and
366 MB in all, what View ▸ Remastered Graphics draws from.

The routes. **No data:** the folder button's pick is tested with `isRemasteredFolder`
(`.build.info` at the top) before the archives are looked for, and installs as the game's own
copy. **Data in place:** *Add StarCraft: Remastered…* under Data sets →
`services/gameData.ts#installRemasteredInto`, stored as `REMASTERED_PROFILE` (`remastered`) and
switched to. **Desktop:** `desktop/main.ts#extractFrom` takes a folder with the archives first and
an installation otherwise, so `locate()` finds a default Remastered install on first run;
`extractFrom` / `locate` became async for it. The worker gets the folder itself
(`ExtractRequest.remastered`): a `FileSystemDirectoryHandle` from `showDirectoryPicker`, or — no
picker (Firefox, Safari) — the `File`s of an `<input webkitdirectory>` pick through
`pickedFilesSource`. Both are structured-cloneable and neither is read until asked; a `File` is a
handle, so `slice()` reads a range of a 1 GB `data.NNN` without the rest, and only
`.build.info` + `Data/**` are posted. The file-list route is the one driven end to end in headless
Chromium (`setInputFiles(<install dir>)`, ~18 s over `/mnt/c`); the handle route and Firefox /
Safari are not, and whether those browsers include the dot-file `.build.info` in a folder pick is
unverified — without it the pick is simply not recognised as an installation.

A trap found on the way, older than this: `store.ts` caches directory lookups, *including the
misses*, and the worker writes behind the main thread's back — so `gamedata-profiles/`, looked for
when the dialog first listed the data sets, stayed "missing" after the first data set of a session
was installed and the new set was absent from the list until a reload. `forgetStoredFolders()`
after every worker install is the fix.

`extract.ts#SOUND_TABLES` (`arr/sfxdata.dat`, `arr/sfxdata.tbl`, 2026-10-12) are copied beside
`EXTRA_TABLES` when the source has them, and seeded in `extractRemastered` with the other tables —
both sources carry identical files (31985 / 10296 bytes). They are the *list* of the game's
sounds for the trigger sound picker (`strings-sounds.md`); a copy made before lacks them and the
picker says to install again.

Not done: the 4x terrain and sprites, and `npm run extract` from a Remastered folder.

**The play set** (`gamedata/play.ts`, 2026-10-12): what the game itself runs on, kept in a stored
copy for the site's play page (scm-sim at `scmjs.dev/play/`, same origin, so it reads the copy in
OPFS rather than asking for the game twice — the user's call: an owner of Remastered alone must be
able to play). The editor never opens any of it. `PLAY_MEMBERS` is the fixed part (104 files, ~5 MB:
`arr/portdata.*`, `scripts/{aiscript,bwscript}.bin`, `triggers/*.trg`, eight `game/` pictures,
`dlgs/tile.grp`, the three wireframe GRPs, per tileset the creep-edge GRP and five palette PCXs,
the cursors, and — optional, a Remastered installation's only — Remastered's console: nine
`hd2/game/consoles/<race>/console_{left,center,right}.dds` and `hd2/unit/cmdicons/cmdicons.dds.grp`,
~2 MB); `playSoundMembers` reads the rest out of `sfxdata.dat` + `.tbl` (1118 of the 1123
named are in either source; 279 MB from Remastered, ~95 MB decoded from the 1.16 archives). They
are stored under the game's own paths (`assetPath`), unlike the tileset remaps the editor renames
(`tileset/<name>.ofire.pcx`, `tileset/stat_txt.tbl`) — the play page maps those two itself
(scm-sim `web/gameSource.ts#copyPath`).

**Version 2 (2026-10-12): every image's picture.** The editor's extraction walks from the
units and sprites that can be placed (885 of 999 images); the game creates the other 114
images itself in play — the protoss warp texture and rift, terran and zerg construction, zerg
births, the nuke, every spell's overlay, the selection circles — and a game played from the
copy drew boxes or nothing for them (found by the user on a pylon warping in).
`playImageMembers` lists every GRP and overlay file images.dat names and every image's
`main_NNN.anim`; `copyPlaySet` takes the ones the copy has not got (`has`, the worker passing
`result.files`), the sprites slimmed as the editor's are. From Remastered that is 174 files
more, 26 MB: a copy is 3137 files / 668 MB, 48 s. `PLAY_VERSION` is 2; the play page still
plays from a version 1 copy, without those pictures, and says to renew it.

**Version 3 (2026-10-13): the rest of Remastered's interface.** 29 more optional `hd2/` members
(the fixed part is 133): the nineteen cursors' `hd2/cursor/<name>.dds.grp`,
`hd2/unit/wirefram/wirefram.dds.grp` (30 MB: a 1024×128 picture a unit type, eight squares — four
body parts in white, two shield outlines, the whole, one empty), `hd2/game/icons.dds.grp` (the
resource icons, 28 px) and each tileset's creep edges `hd2/tileset/<name>.dds.grp`. `grpwire` and
`tranwire.dds.grp` are deliberately left: they are the classic drawings with every pixel doubled.
Nothing for water and lava: the play page moves them from the editor's own files
(`tileset/<name>.hd.tmsk`, `.hd.mask`, `water_large.hd.grp`, `water_fine.hd.grp`,
`heat_noise.hd.dds`), which every Remastered copy has. A copy is 3166 files / 698 MB, 45 s. The
play page plays from versions 1–3 and draws a version 2 copy with the classic cursors, wireframes
and icons, saying nothing. **The play page must accept a version before an editor that writes it
is released** (scm-sim `web/gameSource.ts#PLAY_VERSIONS`), or a new copy is refused there.

**Version 4 (2026-10-13): the lighting's layers.** The play page lights Remastered's sprites as the
game's real-time lighting does (scm-sim `web/spritePass.ts`), from four layers of a sprite file the
editor has no use for and `slimAnim` drops: `normal`, `specular`, `ao_depth`, `emissive`
(`ANIM_LIT_LAYERS`; `slimAnim(bytes, kept)` takes the list). **Asked for at install** — the user's
decision: a tick box, off, in the Game Data dialog (web only; dialog state, not kept) and on the
play page's Game Files dialog, which passes `lighting` in its `scmjs.install` message;
`ExtractRequest.lighting` → `copyPlaySet(…, { lighting })`, and the stamp's `play.lit` says the
copy has them. With it `copyPlaySet` reads **every**
image's `main_NNN.anim` — the ones the extraction already wrote among them — and writes it with
six layers — and takes `anim/main.lit` (`PLAY_LIGHTS`, 462 KB: the game's lights, a frame of an
image at a time; scm-sim `src/render/lit.ts` has the format) — over the editor's two-layer file where the copy has one (the store truncates and
writes; the editor reads either, `parseAnim` taking the layers by name). A file written over is
not counted again and its bytes are the difference. Measured over the installation's 868
`HD2/anim/main_*.anim` (513 MB whole): diffuse 209 MB, teamcolor 30, normal 74, ao_depth 74,
specular 37, emissive 15, bright 74 (kept by nobody); 216 files have a normal layer at all. A copy
is 3166 files / 897 MB, 66 s with them and 698 MB, 45 s without, as it was. The play page takes
versions 1–4 and offers the lighting from a version 4 copy whose stamp says `lit`; from any other
its option is greyed and says to choose the folder again with the box ticked.

**Version 5 (2026-10-13): the button faces.** Three more optional members (the fixed part is 136),
`hd2/game/consoles/<race>/cmdbtns.dds.grp`, 166 KB each: 37 pictures, of which the play page uses
the first two — a 72×70 dark button face and the same held down. `console_right.dds` has the
hazard-striped plate of an *empty* place baked in, and the yellow icons straight on that were hard
to read; the game draws a face between the two. The play page takes versions 1–5 and draws the
icons on the plates from an earlier copy. (The other pictures — green frames, the digits 1–5,
larger frames in four colours — are not mapped.)

**Version 6 (2026-10-13): the count down's beat.** One more optional member, `sound\glue\countdown.wav`
(`PLAY_COUNTDOWN`): the play page's lobby counts down to a game between people with it, and it is a
menu's sound, which `sfxdata.dat` does not list — so no copy had it, and the page sounded a tone of its
own. Measured on the three sources: 1.16.1 has it in StarDat and BrooDat (8,008 bytes, 22 kHz mono, the
same bytes); Remastered has its own at that name (31,608 bytes, 44.1 kHz stereo) and the old one, byte
for byte, at `SD\sound\glue\countdown.wav`. A copy takes the one at the game's name, as it does for
every other sound, so a Remastered copy counts down with Remastered's. Not required: a copy without it
plays. The play page reads versions 1–6 (scm-sim `PLAY_VERSIONS`) and must be deployed first.

It is **not part of `extractGameData`**, on purpose: that would put 280 MB into the `Map` the
Remastered passes hold, change what `npm run extract` and the desktop write, and move the file
counts every test pins. Instead the worker copies it after the editor's files and before the
stamp — `writeStoredCopy(…, more)` hands `copyPlaySet` its own writer, so one file is in memory at
a time — reading straight from the source (`storage.readFile` or the archive reader). The stamp
gains `play: { version, files, sounds, bytes }` (and its `files` / `bytes` / `summary` include
them) only when every `PLAY_REQUIRED` member and 95% of the game's sounds were there (Remastered lacks one).
The rule was "at least one sound" until 2026-10-15, and under mopaq 1.5 a 1.16 copy read 3 of 1,119 (the
compressed WAVs need mopaq 1.6's Huffman + ADPCM) and still claimed `play`. The StarEdit download *does* have
every sound — the old "it has none" was the same decoding failure — so a download copy gets `play` too, and
**whether it may be played from is the play page's rule, not the copy's**: the user's decision (2026-10-15) is
that a copy from the download unlocks replays and the cinematic viewer but never Test Map or a game. The play
page tells it by the stamp's `from` (the download's URL). A failure while copying is a `problems` line and a copy without
`play`, never a failed install. A memory-only copy (no OPFS) has none. The desktop's own
extraction (`desktop/main.ts`) does not write it either: the desktop frames the hosted play page.

**The installer page** (`install.html` → `src/pages/install.ts`, a third Vite input, 2026-10-12):
no interface, a `message` listener. The play page frames it out of sight and posts a Remastered
folder pick (`{ type: "scmjs.install", files: [{ path, file }] }` — pairs, because a `File` posted to
another window keeps its bytes and loses `webkitRelativePath`; `installFromPickedRemastered` is
`installFromRemastered`'s file-list half taking them), and is told `scmjs.install.ready` /
`.progress` / `.done` (the stamp) / `.error`. Same origin only, both ways. Built because the user,
on the live play page, picked their Remastered folder and was sent to another page to pick it
again. Where it installs: the default copy when there is none or it is the free download or an
older Remastered copy; `REMASTERED_PROFILE` beside a classic or mod copy. Since 2026-10-13 (the user:
a Remastered folder given to the play page should make the editor default to Remastered too) it
then writes the editor's two stored choices as the atoms would — `hdGraphics: true` into
`scmjs.prefs`, and the Remastered data set into `scmjs.gameData` when the copy went in beside
another (`gamedata/remasteredDefault.ts`, `tests/remastered-default.test.ts`). Straight to storage
because `services/gameData` drags the document atoms in; only at that moment, like the dialog's
`turnOnRemasteredGraphics`. An editor tab already open picks it up at its next load. The message names are a contract with scm-sim's
`web/editorInstall.ts`. `e2e/installPage.spec.ts`.

**The stamp is now read by three programs**: `copies.ts`, `site/header.js`, and scm-sim's
`web/gameSource.ts` (which needs `from`, `at`, `profile`, `play`, and `PLAY_VERSION` = 1). Bump
`PLAY_VERSION` when the list changes so that an old copy cannot serve; the play page then asks
for a reinstall. What the classic game's interface needs beyond the play set (fonts, dialogs,
console art — Remastered has none of it) is scm-sim's interface pack, not ours.

**Chromium's folder picker cannot open the install (found by the user, 2026-10-09).**
`showDirectoryPicker` refuses any folder under Program Files — "can't open this folder because it
contains system files" — and that is where the installer puts StarCraft, classic or Remastered. So
both folder buttons in the dialog go through `<input webkitdirectory>` and never the picker; the
input has no blocklist, only the "upload N files?" question. `installFromRemastered` and the worker
still take a `FileSystemDirectoryHandle` (a plugin or a later caller may have one for a folder
elsewhere), but nothing in the editor produces one now. Headless testing had only ever driven the
input, which is why this was not seen.

**The option turns itself on once (2026-10-09, the user's call).** A copy made from a Remastered
installation is mostly Remastered's pictures, and someone who pointed the editor at Remastered and
then saw the 1.16 graphics would not go looking for a menu item — so
`services/gameData.ts#turnOnRemasteredGraphics` sets both `ViewFlags.hdGraphics` and
`Preferences.hdGraphics` at the moment such a copy is made, and never otherwise (switching data
sets, or a later launch, leaves the user's choice alone). The moments: the dialog's folder route
with no data (`fromRemastered`), *Add StarCraft: Remastered…* (`installRemasteredInto`), the
desktop's search / folder buttons when the result's origin is Remastered, and the desktop's silent
first-run extraction — which has no dialog, so `locateGameData` marks a source it extracted *on this
run* with `extractedFrom` (later launches find the copy at the bundled step and carry nothing) and
`usePreload` acts on it. "Is Remastered's" is `profiles.ts#isRemasteredOrigin` over the stamp's
`from`, which every such copy starts with `REMASTERED_ORIGIN`.

**Keeping the extraction off the startup path.** `REMASTERED_PROFILE`, `REMASTERED_ORIGIN` and
`isRemasteredOrigin` live in `profiles.ts`, and folder recognition (`BUILD_INFO`, `installRootOf`,
`pickedFilesSource`) in `remasteredFolder.ts`, because `services/gameData.ts`, `usePreload` and
`install.ts` are all reachable from startup and `remastered.ts` imports `extract.ts`. After the
split the extraction is in the worker chunk only (checked: its strings appear in
`extract.worker-*.js` and nowhere else in `dist/assets`).

**Moved out of `docs/game-data.md` (docs refresh, 2026-10-16).** Two things to know before
changing the extraction or the decoders: the manifests the extraction writes are what the loaders
probe for, so changing what is extracted means re-running it and checking the app against the
result, not only the tests; and `tests/dat.test.ts`, `tests/iscript.test.ts`,
`tests/animate.test.ts`, `tests/palette.test.ts` and `tests/tileset.test.ts` run against the real
files in `public/` and skip when they are absent, so a green run on a clone without them has not
exercised the decoders. Also cut from the reader's doc, recorded here: the download goes through
`gamedata.scmjs.dev` (scm-js/cloudflare-blizzard-forwarder) because Blizzard's download server's
HTTPS certificate is for another name, plain HTTP is blocked on an HTTPS page, and it sends no CORS
header — the forwarder adds the header and passes range requests through, stores nothing, and the
desktop app uses it too (its window has the same rules). Only the open map's tileset is decoded
into an atlas (a decoded tileset is ~20 MB of pixels); the others are fetched into the HTTP cache
but not decoded. Remastered terrain: six to nine thousand compressed pictures per tileset, a map
uses a few hundred, decoded on first draw. A copy in the browser keeps two of a Remastered sprite's
seven layers (diffuse + teamcolor) unless the lighting tick adds four more. The size figures the
docs give (browser copy ~140 MB classic, ~650 / ~850 MB Remastered (641 MB measured 2026-10-12); desktop ~30 / ~365 MB) come
from the measurements above; the classic browser figure is 30 MB + ~95 MB sounds + the play set's
small classic files, an estimate rather than a measured copy.

## Data sets widened (M4, 2026-11-08)

The mods plan's slice M4 (`scm-sim` branch mods-plan, `docs/mods-plan.md`, "Tier E"): the editor makes maps for a mod.

- **Widths from the file.** `dat.ts`'s readers keep their API and take every column from `table.ts#decodeDat`, so a
  table is the game's, DatExtend's expanded `.dat` or GPTP's `.datex` by its length (and name). `UnitsDat.flingy`,
  `groundWeapon`, `airWeapon` became `Uint16Array` (the widened columns; readers unaffected); the count of a table is
  `dat.ts#datCount(column)` (`units.flingy.length`) — no `count` field, so hand-built `UnitsDat` in tests still fit.
  `NO_UNIT` (228) stays the subunit sentinel at any width; "is this a unit type" is `< datCount(units.flingy)`
  (`sprites.ts#getUnitSprite`/`subunitOf`, `animate.ts`, `editor/units.ts`, `useSpriteTools`, `data/sprites.ts`).
  `data/units.ts#unitTypeCount()` is the loaded count for code without the tables (`validate`, `triggers`, `host`'s
  trigger list, which appends ids ≥ 233 after the classes so a place stays its value). The settings sections
  (`sections/settings.ts` UNIx/PUNI/UPGx/TECx 228/130/61/44) keep the format's constants; Unit Settings shows "No
  per-map settings for this unit…" for ids ≥ 228 instead of the form. Upgrade/tech lists stay at 61/44.
- **Loader.** `units/load.ts` fetches `unit/manifest.json` first (`unitManifest`, one promise a data set, dropped by
  `resetUnitAssets`); its `datex` list says which tables are stored as `arr/<t>.datex`, `optional` which of
  `rez/unitnames.tbl` / `unit/cmdbtns/uniticons.grp` exist (asked only then: a dev server answers a missing file with
  its page, and `fetchPart` now refuses `text/html` too). A bad `iscript.bin` costs animation, not the tables.
- **iscript.** `decodeIscript` takes its headers from `iscriptText.ts#readIscriptHeaders` (IceCC's `type + 1` entry
  points or PyMS's table, detected); `iscript.ts` imports only that file, with the `.ts` extension, for Node.
- **Extraction.** `extract.ts` imports `table.ts` (which now imports `./schema.ts` with the extension — Node type
  stripping). It prefers `arr\<t>.datex` for `DATEX_TABLES` when that is a whole number of entries, walks every
  unit/sprite of the file's width, skips an animation whose opcode it cannot read (Cosmonarchy's `flagjmp` 0x3E), and
  copies `UNIT_EXTRA_FILES`. The legacy (19192) units.dat is still refused with the BrooDat hint. Vanilla output is
  byte-identical to before (manifests compared).
- **Names and groups.** `unitnames.tbl` entry N names type N for every type where it has a non-`*` name (GPTP's
  `get_unit_name_ext` reads it before stat_txt), through the same per-entry rule; past 227 without it, `Unit #N`.
  `gameNames.ts#unitCatalogue` lists ids ≥ 228 (all of them without a name file, only the named ones with one —
  Cosmonarchy's 3,000-row table is mostly template copies) with race from group flags and Building from the special
  flags; `installNames(names, catalogue)`; `dataSetUnitGroups()` / `shownUnitGroups(name)` feed the palette (its own
  section headed by the data set's name), the object dialogs, Unit Settings and `api.names.unitGroups` (labels
  `"<set> · Terran Units"`). Ids < 228 keep `UNIT_GROUPS`. Icons: `iconFor` uses `uniticons.grp` for unit types when
  the set has it.
- **Tilesets.** `decode.ts#tileGroupOf(id, groupCount)`: twelve bits when the tileset has more than 2,048 groups,
  else eleven with bit 15 the creep flag (`hasCreepFlag`); `megatileForTile`, the ground overlays, placement,
  `tileInfo`, Check Map, statistics and the status bar pass the count. cv5/vf4/vr4/vx4ex were already any size.
  Cosmonarchy's Jungle has 40,109 megatiles: the atlas is 2,176 × 21,318 (≈185 MB of pixels) and drew fine in
  headless Chromium; a lazy atlas is the fix if a browser refuses it.
- **Over a copy** (`gamedata/overCopy.ts`, worker-side): `GameDataFiles.base` / `ExtractRequest.base` = a stored
  profile id, or the bundled URL for the default when this build serves it. The extraction runs until it asks for
  nothing new (the Remastered pattern), the tables read up front; `storedPathOf` is the inverse of the extraction's
  names. Such a copy writes no play set (stamp `base`); `hdOff` (images whose images.dat row or GRP bytes differ from
  the base's, among those with a 2x sprite) goes in the stamp and `load.ts#classicOnly` honours it. The dialog's
  folder route lays a folder without the two archives over the copy in use (or that copy's own base).
- **In memory**: `AssetSource.kind "reader"` (`DataSetReader { read, base, hash? }`), `fetchAsset` asks `read` then
  the base source; `services/gameData.ts#attachReaderDataSet` / `reloadDataSet`; never remembered; 2x sprites off.
  **Mod Editor asks (2026-11-08, branch `mods-api`):** `read(path, { member, under })` — `member` from
  `paths.ts#memberOfStored` (null for the two manifests), `under(p)` = `source.ts#readFrom(reader.base, p)`;
  `readUnder(path)` (the base of a reader source, else the source) behind `api.gameData.read(path, { under: true })`.
  `unit/manifest.json` the reader leaves null is the base's with `datex`/`optional` worked out by asking the reader
  (`readerManifest.ts`, imported on demand: `.datex` of a whole number of entries wins as in `extract.ts#datexOf`, a
  `.dat` alone takes the table out of `datex`, `UNIT_EXTRA_FILES` it answers go in `optional`); a reader answering the
  manifest is taken at its word (plugin-mods' `manifestFor` still works). `rehashDataSet(store, hash|null)` replaces the
  source with the same `read`/`base` and the new hash (setAssetSource + atom; no `dropDecodedData`, no revision bump;
  `testDataSet`/`stampDataSet` read the atom, so they follow). `attach` still always reloads, even with the same
  function — the plugin's "new hash ⇒ attach" path relies on it re-reading. `GameDataSource.base` for a reader = the
  base's profile id. `paths.ts` holds `storedPathOf` (re-exported from `overCopy.ts`) and its inverse; `storedPathOf`
  now renames only the extraction's own tileset subfiles (four remaps + `dddata.bin`) — the play set's
  `tileset\<name>\dark.pcx` etc. stay at the game's path, which is where `play.ts` writes them (the old regex sent
  them to `tileset/<name>.dark.pcx`, a path nothing writes).
- **Hash** (the one mod hash, 2026-11-08 branch `mod-hash`; `mods.md` "The mod hash, one rule"):
  `overCopy.ts#dataSetHashOf(names, own, code)` = core's `modHashOfDigests` over **every** own file — never compared
  with the base (the old `changedFiles`/`firstOf`/`copyChain`/`hashUnbased` are gone; `hashUnbased` stays in
  `StoredStamp` only so old stamps read). Names: the overlay's keys, `ExtractRequest.hashOnly` (loose files in
  `GAME_FOLDERS` the extraction does not read, `install.ts#isGamePath`), and each own archive's **listed** members, or
  `hash.ts#probeNames` for an archive with no list — no longer `asked` (what the extraction read), which made a listed
  archive's unlisted members count where the page does not. Code: `ExtractRequest.code` (loose `.qdp`/`.bwl`/`.fgp`/
  `.fgd` from `splitPickedFiles`, anywhere in the pick) → plugin and project lines; an own archive's `.fgp` member is a
  project line, its `.qdp`/`.fgd` members nothing. `splitPickedFiles` also takes `.exe` as an archive (installDataSet
  keeps `exeArchive(bytes).archive`, drops an exe with none) and skips `.dll`. Base-only (the game's own copy): no own
  file → no hash, as before. Proof: the worker's `onmessage` in Node over `fixtures/data` + Cosmonarchy's release
  folder as `splitPickedFiles` gives it → stamp `ac3f86533e4b5a31` (the page's), 2 s; `tests/datasets-widths.test.ts`
  "a made data set installed through the editor's extraction" (now counts the weapons.dat it ships unchanged).
- **The map's member** `scmjs\dataset.json` (`services/mapDataSet.ts`): `stampDataSet` before `buildOutgoing` in
  `saveDocument` (bytes the Save dialog built are dropped when it changed the extras), only for a non-default set,
  never removed; `offerMapDataSet` after `openFileInto` and the Open dialog's own load → the `mapDataSet` dialog
  (`NEEDS_PAYLOAD` in `dialogs.spec.ts`). The "Switch" / "Keep" buttons use `tc("data set", …)` because "Switch" is
  already the trigger switch in Korean.
- **Test Map**: `TestMapFile.dataSet {id,name,hash}` (`testMap.ts#testDataSet`); plugin-scm-sim (branch `mods`)
  posts it as `dataSet` in `scmjs.play`. The play page's acceptance is M1's.
- **Proofs**: `tests/datasets-widths.test.ts` (readers at three widths, grown tables made with `encodeDat`, tilesets
  grown, the over-copy extraction against `public/`), `tests/map-dataset.test.ts`, `tests/dataset-reader.test.ts`,
  `tests/datasets-cosmonarchy.test.ts` (`SCMJS_COSMONARCHY` / `SCMJS_COSMONARCHY_MAPS`: 404/404 open and save byte for
  byte, unit ids to 657, groups to 4,094). In headless Chromium on the dev server: a 240-type set installed over the
  bundled files through the dialog in ~7 s; Cosmonarchy (CMBW-editor.mpq + `mpq/`) in ~22 s, 1,202 GRPs, 4 missing.
- **Open (from the Mod Editor's pictures-and-sounds part, 2026-11-08; no code yet):** the editor's own copy holds no
  `sound\` files (only a copy with the play set has the game's sounds, at their game paths; a data set laid over a copy
  keeps none), so a reader set or a plugin comparing a mod's WAVs against the game's has nothing to compare with from
  the editor's files alone. And the editor's iscript reader knows only `scripts\iscript.bin`, while some mods split
  iscript across several files chosen by the high word of the iscript id (GPTP-style); the extraction's walk and the
  loaders would read only the first file's headers. Related, done on `mods-api`: `api.graphics.grpImage` (a plugin's
  GRP bytes drawn the editor's way, `formats/units/grpPicture.ts#paintGrpFrame`, either GRP encoding via
  `decodeGrpImage`, palette by tileset name through `ensureTileset`, team colour as `unitImage`'s; no remapping, no
  Remastered pictures, new canvas each call, not cached) and core exporting the WAV codec (`decodeWav`, `encodeWav`,
  `decodePcmWav`, `decodeImaAdpcm` — now exported from `formats/wav.ts` — `isPlainPcm`, `canDecodeWav`, `wavFrames`,
  `wavCodecName`, `WAV_FORMAT`).
