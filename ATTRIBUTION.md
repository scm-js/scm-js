# Attribution and third-party notices

This file records the provenance of code, algorithms, reference tables, file-format
knowledge, game resources, project inspirations, tools, and authored assets used by
scm-js. It was audited against the repository on 2026-09-01.

Attribution and permission are different things. A credit below does not grant a license
where the owner has not granted one, and scm-js's [MIT license](LICENSE) applies only to
original project code and assets that the project has the right to license.

## Original project

- **scm-js** is maintained by Jeany. The repository's original source code is available
  under the [MIT license](LICENSE).
- The commit history is the authoritative contributor record. It currently credits
  Jeany and `copilot-swe-agent[bot]`; the initial React/Jotai UI scaffold and later splash
  work were committed by the GitHub Copilot coding agent and co-authored by Jeany.
- `public/favicon.svg` is repository-original artwork introduced by Jeany.
- `src/assets/hero.png` entered in the initial Copilot-authored scaffold and is currently
  unused. No more specific upstream or generation metadata exists in the repository, so
  it should not be represented as third-party-verified artwork.

## StarCraft and Brood War data

StarCraft, StarCraft: Brood War, StarEdit, their names and terminology, and the extracted
game data described below are owned by Blizzard Entertainment or their respective
rights holders. They are not licensed by scm-js's MIT license. This project is not
affiliated with or endorsed by Blizzard Entertainment.

The current repository tracks files generated from `StarDat.mpq` and `BrooDat.mpq`:

| Repository paths | Source and use |
| --- | --- |
| `public/tileset/*.{cv5,vf4,vr4,vx4,wpe}` | Blizzard tileset groups, flags, minitiles, megatiles, and palettes |
| `public/tileset/*.pcx`, `*.bin`, and `stat_txt.tbl` | Blizzard effect-remap, doodad-placement, and string data |
| `public/arr/*`, `public/game/tunit.pcx`, `public/scripts/iscript.bin` | Blizzard unit lookup, colour-remap, and animation data |
| `public/unit/**/*.grp` and `public/unit/**/*.lo?` | Blizzard sprite frames and overlay positions |
| `public/**/manifest.json` | scm-js-generated inventories of the extracted files |

The extraction code is original scm-js code, but running it does not change ownership
of its output. `scripts/extract-tilesets.mjs` and `scripts/extract-units.mjs` are intended
for data from a StarCraft installation the user is entitled to use. Map fixtures under
`fixtures/` are gitignored for the same reason.

**Distribution note:** the repository's attribution cannot supply permission to
redistribute Blizzard data. Maintainers of public forks, releases, and hosted builds
should independently confirm their rights or omit the extracted files and require users
to generate them locally.

Static names and vocabulary in `src/data/units.ts`, `src/data/players.ts`,
`src/data/tilesets.ts`, and `src/data/triggers.ts` describe StarCraft game concepts and
StarEdit terminology. They are credited to Blizzard and the mapping community's format
research; their presence does not imply endorsement.

## Adapted algorithms and reference tables

### Chkdraft

[Chkdraft](https://github.com/TheNitesWhoSay/Chkdraft) is an open-source StarCraft map
editor by Justin Forsberg (`jjf28`, now `TheNitesWhoSay`). Chkdraft's repository is
licensed under the MIT license, copyright 2015-2026 Justin Forsberg.

scm-js uses Chkdraft in these specific ways:

| scm-js code | Chkdraft contribution |
| --- | --- |
| `src/editor/isom.ts` | TypeScript port/adaptation of Chkdraft's reverse-engineered StarEdit isometric terrain behavior and shape/link model |
| `src/data/isomTables.ts` | Per-tileset ISOM terrain numbering and adjacency lists copied and transformed from Chkdraft's mapping-core tables |
| `src/formats/tileset/cycle.ts` | Palette-cycle band tables adapted from Chkdraft's colour-cycler data; scm-js supplies its own renderer and game-frame timing |
| `src/data/tilesets.ts`, `src/formats/tileset/palette.ts` | Terrain names and palette ordering cross-checked against Chkdraft and extracted game files |

Relevant upstream mapping-core files include
[`sc.h`](https://github.com/TheNitesWhoSay/Chkdraft/blob/master/src/mapping_core/sc.h),
[`sc.cpp`](https://github.com/TheNitesWhoSay/Chkdraft/blob/master/src/mapping_core/sc.cpp),
[`scenario.h`](https://github.com/TheNitesWhoSay/Chkdraft/blob/master/src/mapping_core/scenario.h),
and [`scenario.cpp`](https://github.com/TheNitesWhoSay/Chkdraft/blob/master/src/mapping_core/scenario.cpp).
The full Chkdraft MIT notice is reproduced at the end of this document.

### iscript bytecode references

`src/formats/dat/iscript.ts` implements its own small decoder and animator, but its
opcode names, animation slots, and argument layouts follow community disassemblers and
engine research:

- [PyMS / PyICE](https://github.com/poiuyqwert/PyMS) by `poiuyqwert`, an MIT-licensed
  Brood War modding suite.
- [IceCC](https://github.com/andreas-volz/icecc), originally by Jeff Pang (2000-2002)
  and modified by ShadowFlare (2006-2007), distributed under GPL-2.0. It is a reference;
  no IceCC source code is included in scm-js.
- [OpenBW](https://github.com/OpenBW/openbw), a community StarCraft engine
  reimplementation. It is a behavioral/layout reference; no OpenBW source code is
  included in scm-js. The linked repository did not declare a license during this audit,
  so scm-js does not treat its code as reusable licensed material.

### File-format references and verification

The following community resources document formats decoded independently in `src/formats`:

- The [Staredit Network `scenario.chk` reference](https://wiki.staredit.net/wiki/Scenario.chk)
  documents CHK sections, records, validation sizes, and repeated-section behavior.
- The [Staredit Network terrain-format reference](https://wiki.staredit.net/wiki/Terrain_Format)
  documents CV5, VF4, VX4/VX4EX, VR4, WPE, and `dddata.bin` layouts.
- [PyMS](https://github.com/poiuyqwert/PyMS) provides interoperable tools for DAT, GRP,
  PCX, TBL, LO, tileset, trigger, and iscript formats and is used as a compatibility
  reference, not as a bundled dependency.
- Real files extracted from StarCraft and maps written by StarEdit are used locally for
  compatibility tests. Those fixtures are not licensed as scm-js code and remain
  gitignored.

## Editor and interface inspiration

These projects are design and behavior references; their source code is not bundled:

- **StarEdit** (Blizzard Entertainment, 1998), the official editor whose file output and
  isometric brush behavior scm-js aims to preserve.
- **SCMDraft 2**, by Suicidal Insanity with community collaborators including
  DarkWizzard. It inspired layer organization, non-isometric terrain modes, placement
  options, brush shortcuts, and undo depth. The project's home is
  [Stormcoast Fortress](https://www.stormcoast-fortress.net/).
- **StarForge**, by Heimdal, with later StarForge:Ultimate work by Heimdal, Clokr, and
  zergstain. It inspired the dense raw-tile browsing workflow.
- **Chkdraft**, by Justin Forsberg, also serves as a UI/behavior reference in addition to
  the explicitly adapted code listed above.

## Direct software dependencies

The exact dependency graph, versions, and declared license identifiers are locked in
`package-lock.json`. Each package retains its own license; a dependency's presence here
does not relicense it under scm-js.

### Runtime

| Project | Use | License and credit |
| --- | --- | --- |
| [React](https://github.com/facebook/react) / React DOM | UI and rendering | MIT; copyright Meta Platforms, Inc. and affiliates |
| [Jotai](https://github.com/pmndrs/jotai) | Application state | MIT; copyright 2020 Poimandres |
| [Radix UI](https://github.com/radix-ui/primitives) | Accessible menu/tab/tooltip primitives | MIT; copyright 2022 WorkOS |
| [Lucide](https://github.com/lucide-icons/lucide) | Interface icons through `lucide-react` | ISC; copyright Lucide Icons and Contributors; some icons derive from Feather Icons, MIT, copyright Cole Bemis |
| [mopaq](https://github.com/jeany55/mopaq) | MPQ reading/writing and PKWARE DCL support | MIT; copyright 2026 Jeany |

### Development and build

| Project | License and credit |
| --- | --- |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0; Microsoft Corporation |
| [Vite](https://github.com/vitejs/vite) and [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react) | MIT; VoidZero/Vite contributors and Yuxi (Evan) You/Vite contributors |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT; VoidZero and Vitest contributors |
| [Oxlint / Oxc](https://github.com/oxc-project/oxc) | MIT; VoidZero Inc., contributors, and Boshen |
| [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) React/Node type packages | MIT; Microsoft Corporation and package contributors |

Transitive dependencies are installed from the lockfile. Their package-level license
files in `node_modules` are authoritative and should be retained or collected by any
distribution process that bundles their code.

## Maintenance rule

When adding an external resource:

1. Put a short provenance comment beside copied or adapted algorithms/tables.
2. Add the project, author/maintainer, source URL, exact use, and license here.
3. Preserve any required copyright and license notice.
4. Record the source and license of every imported image, sound, font, map, or data file.
5. Keep proprietary extraction inputs and test fixtures out of git unless redistribution
   permission has been established.

## MIT notice for Chkdraft and MIT-licensed dependencies

The copyright holders for each MIT-licensed project are identified above. Runtime code
and adapted material covered by the common notice below include these notices:

- Copyright (c) 2015-2026 Justin Forsberg (Chkdraft)
- Copyright (c) Meta Platforms, Inc. and affiliates (React and React DOM)
- Copyright (c) 2020 Poimandres (Jotai)
- Copyright (c) 2022 WorkOS (Radix UI)
- Copyright (c) 2026 Jeany (mopaq)
- Copyright (c) 2013-present Cole Bemis (Feather-derived Lucide icons)

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
