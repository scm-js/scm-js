# Attribution and third-party notices

Where the code, algorithms, reference tables, format knowledge, game data, artwork and
dependencies in scmJS come from, and on what terms. Checked against the repository on
2026-09-04.

Attribution and permission are different things. A credit here does not grant a license
the owner has not granted, and the project's [MIT license](LICENSE) covers only original
project code and the assets the project has the right to license.

## scmJS

- **scmJS** is maintained by Jeany and released under the [MIT license](LICENSE).
- The commit history is the contributor record. Parts of the code were written with AI
  coding assistants: GitHub Copilot's coding agent produced the initial React scaffold
  and the first splash screen (pull requests 1 to 4, committed as `copilot-swe-agent`),
  and later work carries `Co-Authored-By` trailers naming the Claude model used. All of it
  was directed, reviewed and is maintained by Jeany, who is responsible for it.
- **Artwork.** `public/icon.png`, `public/favicon.svg`, the app logo component and the
  splash screen's wireframe globe are one original drawing, made for this project.
- **Screenshots.** The pictures in `docs/images/` show the editor with Blizzard's own
  maps open (Big Game Hunters, Binary Burghs, Crescent Moon and Ground Zero, from the
  game's Maps folder), so they contain Blizzard's terrain and unit art. They document the
  editor and are not offered as reusable assets.
- **Related repositories** under [github.com/scm-js](https://github.com/scm-js), each with
  its own LICENSE: the plugins (`plugin-*`, MIT, copyright scmJS), `plugin-api` (the
  published typings), `registry` (the plugin index), `site` (scmjs.dev), `docs` and
  `nightly` (deploy targets), `cloudflare-blizzard-forwarder` (the game-data download
  forwarder), `ai-server`, and `.github` (the shared plugin workflow). A plugin that
  adapts outside work records it in its own repository; the Walkability plugin's analysis,
  for one, follows the method of the BWEM library (Brood War Easy Map, by Igor Dimitrijevic).

## StarCraft and Brood War data

StarCraft, StarCraft: Brood War, StarEdit, their names and terminology, and the game data
described below belong to Blizzard Entertainment or their respective rights holders. None
of it is licensed by this project's MIT license. This project is not affiliated with or
endorsed by Blizzard Entertainment.

**The repository tracks no Blizzard data.** The editor's graphics are read out of the
game's own archives, `StarDat.mpq` and `BrooDat.mpq`, on the user's machine, by one of
three routes, all of which produce the same files:

- `npm run extract`, for a source checkout, writes them into `public/` (gitignored, see
  [its README](public/README.md)).
- Help ▸ Game Data… extracts from archives the user picks, or the desktop app finds, into
  the browser's private storage or the app's data folder.
- Help ▸ Game Data… can also download Blizzard's own free StarEdit package from
  Blizzard's server and extract the two archives it carries. The request goes through a
  Cloudflare Worker at `gamedata.scmjs.dev` because Blizzard's server sends no
  cross-origin header; the worker forwards range requests and stores nothing.

| Generated paths | What they are |
| --- | --- |
| `public/tileset/*.{cv5,vf4,vr4,vx4,wpe}` | tileset groups, flags, minitiles, megatiles and palettes |
| `public/tileset/*.pcx`, `*.dddata.bin`, `stat_txt.tbl` | effect colour remaps, the doodad placement table, the game's name strings |
| `public/arr/*.dat`, `images.tbl` | the unit, weapon, upgrade and technology tables and the image lookup chain |
| `public/game/tunit.pcx`, `public/scripts/iscript.bin` | team colours and the animation scripts |
| `public/unit/**/*.grp`, `*.lo?` | sprite frames and overlay positions |
| `public/**/manifest.json` | inventories written by the extraction (project-generated, listing Blizzard's files) |

The extraction code is the project's own; running it does not change who owns its
output. It is meant for data from a StarCraft installation the user is entitled to use.
The Blizzard maps and archives used by the tests live in `fixtures/`, gitignored for the
same reason.

**Distribution.** This file cannot supply permission to redistribute Blizzard's data. No
build, installer, container image or hosted site of this project carries the extracted
files or the archives, and a fork, release or hosted build must keep it that way unless
its maintainer has independently confirmed the right to do otherwise. The container
image's web server answers 404 for the data paths for this reason.

**Game facts written into the source.** Some of Blizzard's data is reproduced as
constants so the editor works without the extracted files:

- `src/formats/chk/sections/vcod.ts` holds the 1040-byte `VCOD` verification table
  StarEdit writes into every map it creates. The game refuses a map without one, so an
  editor that creates maps has to write it, as every open-source editor does.
- `DEFAULT_UPGRADE_MAX` in `src/formats/chk/sections/settings.ts` is the `maxRepeats`
  column of `upgrades.dat`, so a new map carries StarEdit's defaults.
- `src/data/gameNames.ts` pins the unit, weapon, upgrade and technology names from
  `stat_txt.tbl` where they differ from StarEdit's, so a mod's renames can be told apart.
- `FOG_TINT` in `src/components/viewport/fog.ts` is one colour per tileset averaged from
  the game's `dark.pcx` remap.
- The names and vocabulary in `src/data/units.ts`, `weapons.ts`, `sprites.ts`,
  `players.ts`, `tilesets.ts` and `triggerDefs.ts` are StarEdit's terminology and the
  mapping community's names for the game's concepts.

## Adapted code and reference tables

### Chkdraft

[Chkdraft](https://github.com/TheNitesWhoSay/Chkdraft) is an open-source StarCraft map
editor by Justin Forsberg (`jjf28`, now `TheNitesWhoSay`), MIT-licensed, copyright
2015-2026 Justin Forsberg. It is the one project whose code this editor adapts, in these
places, each carrying a provenance comment:

| In scmJS | From Chkdraft |
| --- | --- |
| `src/editor/isom.ts` | The isometric terrain brush: a TypeScript port of Chkdraft's reverse-engineering of StarEdit's isometric behaviour and its shape and link model. |
| `src/data/isomTables.ts` | The per-tileset ISOM terrain numbering and adjacency lists, copied from `mapping_core/sc.h` and transformed. |
| `src/formats/tileset/cycle.ts` | The palette-cycling band tables per tileset, from Chkdraft's colour cycler. The renderer and the game-frame timing are this project's. |
| `src/data/tilesets.ts` | The terrain names per tileset, checked against the extracted files in `tests/palette.test.ts`. |

The relevant upstream files are in Chkdraft's
[`src/mapping_core/`](https://github.com/TheNitesWhoSay/Chkdraft/tree/master/src/mapping_core)
(`sc.h`, `sc.cpp`, `scenario.h`, `scenario.cpp`). Chkdraft's MIT notice is reproduced at
the end of this file.

### iscript

`src/formats/dat/iscript.ts` is the project's own decoder and animator for the game's
animation bytecode. Its opcode names, animation slot order and argument layouts follow
the community's disassemblers, none of whose code is included:

- [PyMS](https://github.com/poiuyqwert/PyMS) by Zach Zahos (`poiuyqwert`), an
  MIT-licensed Brood War modding suite; its PyICE component is the iscript reference.
- [IceCC](https://github.com/andreas-volz/icecc), by Jeff Pang (2000-2002) with
  modifications by ShadowFlare (2006-2007), GPL-2.0. A reference only.
- [OpenBW](https://github.com/OpenBW/openbw), a community reimplementation of the game
  engine, for how the engine behaves. A reference only; the repository declared no
  license file when checked, so nothing from it is treated as reusable.

### Format references

The file formats are decoded independently in `src/formats/`, from these public
descriptions:

- [Staredit Network's `scenario.chk` reference](https://wiki.staredit.net/wiki/Scenario.chk):
  the CHK sections, their records and sizes, and how the game treats repeated sections.
- [Staredit Network's terrain format reference](https://wiki.staredit.net/wiki/Terrain_Format):
  CV5, VF4, VX4 and VX4EX, VR4, WPE and `dddata.bin`.
- [Staredit Network's colour code table](https://wiki.staredit.net/wiki/Color): the text
  control bytes and what the game draws for each, in `src/editor/textColors.ts`.
- **SCMDraft 2's TrigEdit syntax** is the text trigger format `src/formats/triggers/text.ts`
  prints and parses, and `src/data/triggerDefs.ts` orders arguments the same way, so
  triggers move between the two editors as text. The `.trg` import and export are
  SCMDraft's raw record format.
- The deaths-table address the EUD helpers use (`DEATHS_TABLE_ADDRESS` in
  `src/data/triggerDefs.ts`) is the community's published figure for 1.16.1.
- `src/formats/wav.ts` follows the RIFF/WAVE container and the IMA and Microsoft ADPCM
  specifications as published; the codecs are original.
- PyMS, above, is also the compatibility reference for the DAT, GRP, PCX, TBL and LO
  decoders.
- Maps written by StarEdit and Blizzard's own maps are the ground truth the tests
  re-encode byte for byte. They stay in the gitignored `fixtures/`.

## Editors this one learns from

Design and behaviour references only; no code from them is used:

- **StarEdit** (Blizzard Entertainment, 1998), the official editor whose file output and
  isometric brush this editor reproduces.
- **SCMDraft 2**, by Suicidal Insanity with community collaborators including
  DarkWizzard, at [Stormcoast Fortress](https://www.stormcoast-fortress.net/): the layer
  organisation, the non-isometric terrain modes, placement options, brush shortcuts, the
  undo depth and the text trigger syntax.
- **StarForge**, by Heimdal, with the later StarForge:Ultimate work by Heimdal, Clokr and
  zergstain: the raw tile browsing workflow.
- **Chkdraft**, by Justin Forsberg, as a behaviour reference beyond the code listed above.

## Software dependencies

Exact versions and license identifiers are in `package-lock.json`. Each package keeps its
own license; being listed here does not relicense it.

### In the web bundle

| Project | Use | License |
| --- | --- | --- |
| [React](https://github.com/facebook/react) and React DOM | the interface | MIT, Meta Platforms, Inc. and affiliates |
| [Jotai](https://github.com/pmndrs/jotai) | application state | MIT, copyright 2020 Poimandres |
| [Radix UI](https://github.com/radix-ui/primitives) | menus, tabs, tooltips, popovers, context menus | MIT, copyright 2022 WorkOS |
| [Lucide](https://github.com/lucide-icons/lucide), through `lucide-react` | the interface icons | ISC, Lucide Icons and Contributors; some icons derive from Feather Icons, MIT, copyright Cole Bemis |
| [mopaq](https://github.com/jeany55/mopaq) | reading and writing MPQ archives, including PKWARE DCL | MIT, copyright 2026 Jeany |
| [TypeScript](https://github.com/microsoft/TypeScript) | transpiling `.ts` plugins in the browser, in a worker | Apache-2.0, Microsoft Corporation |
| The five default plugins | compiled into the bundle from their repositories at the tags pinned in `src/plugins/defaults.ts` | MIT, copyright scmJS |

The build writes the license text of every one of these into `THIRD-PARTY-NOTICES.txt`
at the root of the bundle (`scripts/lib/notices.mjs`, run from `vite.config.ts`), so the
web zip, the installers, the hosted sites and the container image all carry them. The
list is read from `package.json`'s dependencies and from the vendored plugins rather than
kept by hand, and a dependency with no license file fails the build.

### In the desktop app

| Project | Use | License |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | the application shell; it bundles Chromium and Node.js, whose notices ship inside the Electron distribution | MIT, Electron contributors |
| [electron-updater](https://github.com/electron-userland/electron-builder) | in-app updates | MIT, copyright 2015 Loopline Systems |

### Build and development only

| Project | Use | License |
| --- | --- | --- |
| [Vite](https://github.com/vitejs/vite) and [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react) | bundling | MIT, VoidZero Inc. and Vite contributors; Yuxi (Evan) You and Vite contributors |
| [Vitest](https://github.com/vitest-dev/vitest) | tests | MIT, VoidZero Inc. and Vitest contributors |
| [Oxlint](https://github.com/oxc-project/oxc) | linting | MIT, VoidZero Inc. and contributors |
| [electron-builder](https://github.com/electron-userland/electron-builder) | packaging the desktop app | MIT, copyright 2015 Loopline Systems |
| [dts-bundle-generator](https://github.com/timocov/dts-bundle-generator) | bundling the plugin typings | MIT, copyright 2017 Evgeniy Timokhov |
| [marked](https://github.com/markedjs/marked) | rendering the documentation site | MIT, MarkedJS |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) type packages | React and Node types | MIT, Microsoft Corporation and contributors |
| [Playwright](https://github.com/microsoft/playwright) and [sharp](https://github.com/lovell/sharp) | the guide's screenshots; installed ad hoc, not dependencies | Apache-2.0, Microsoft Corporation; Apache-2.0, Lovell Fuller and contributors |

### Services and infrastructure

- **GitHub** hosts the repositories, the releases, the Actions builds (`actions/checkout`,
  `setup-node`, `upload-artifact`, `download-artifact`, `upload-pages-artifact`,
  `deploy-pages`, and `docker/setup-buildx-action`, `login-action`, `metadata-action`,
  `build-push-action`), GitHub Pages for the hosted editor and the docs, and the GitHub
  Container Registry for the image.
- The **container image** is built on `nginx:alpine` (nginx, BSD-2-Clause; Alpine Linux
  packages under their own licenses).
- **npm** publishes `@scm-js/plugin-api`.
- **Cloudflare Workers** runs the game-data download forwarder.
- **scmscx.com**, the community map archive, is what the scmscx.com plugin searches,
  through the routes its own site uses. It is not affiliated with this project.

## Maintenance rule

When adding an external resource:

1. Put a short provenance comment beside copied or adapted algorithms and tables.
2. Add the project, author or maintainer, source URL, exact use and license here.
3. Preserve any required copyright and license notice.
4. Record the source and license of every imported image, sound, font, map or data file.
5. Keep Blizzard's archives, extracted data and maps out of git unless redistribution
   permission has been established.

## MIT notice for Chkdraft and MIT-licensed dependencies

The copyright holders of each MIT-licensed project are named above. The shipped code and
adapted material under this notice carry these copyrights:

- Copyright (c) 2015-2026 Justin Forsberg (Chkdraft)
- Copyright (c) Meta Platforms, Inc. and affiliates (React and React DOM)
- Copyright (c) 2020 Poimandres (Jotai)
- Copyright (c) 2022 WorkOS (Radix UI)
- Copyright (c) 2026 Jeany (mopaq)
- Copyright (c) 2026 scmJS (the default plugins)
- Copyright (c) 2013-present Cole Bemis (Feather-derived Lucide icons)
- Copyright (c) Electron contributors (Electron, desktop app)
- Copyright (c) 2015 Loopline Systems (electron-updater, desktop app)

> MIT License
>
> Permission is hereby granted, free of charge, to any person obtaining a copy of this
> software and associated documentation files (the "Software"), to deal in the Software
> without restriction, including without limitation the rights to use, copy, modify,
> merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to the following
> conditions:
>
> The above copyright notice and this permission notice shall be included in all copies
> or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
> INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
> PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
> HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
> CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR
> THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## ISC notice for Lucide

Copyright (c) 2026 Lucide Icons and Contributors

> Permission to use, copy, modify, and/or distribute this software for any purpose with
> or without fee is hereby granted, provided that the above copyright notice and this
> permission notice appear in all copies.
>
> THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD
> TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN
> NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL
> DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER
> IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
> CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Apache-2.0 notice for TypeScript

TypeScript is copyright Microsoft Corporation and licensed under the Apache License,
Version 2.0. The full license is at
[apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0), in
`node_modules/typescript/LICENSE.txt`, and in the bundle's `THIRD-PARTY-NOTICES.txt`.
