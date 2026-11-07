# The library

`@scm-js/core` is the editor's map code as an npm package: open a `.scm`, `.scx` or
`.chk`, read and change its triggers, strings, units, locations and settings, run Check
Map, and write the map back. It is the same code scmJS runs, built from the same source,
so a map reads and writes through the library exactly as it does in the editor of the same
version. It runs in Node.js and in the browser, and needs no game data.

Use it when the editor and the [command line](cli.md) do not do the thing you want: a
script that changes forty maps the same way, a build step that generates triggers, a check
of your own in CI, a tool of your own on top of the format.

```sh
npm install @scm-js/core
```

Node.js 22.12 or newer. The package is ES modules with TypeScript declarations, and its
one dependency is [mopaq](https://github.com/jeany55/mopaq), the MPQ library the editor
reads archives with.

## A first script

Open a map, say what is in it, run Check Map, change the name and write it out:

```js
import { readFile, writeFile } from "node:fs/promises";
import { openMapBytes, writeMapBytes, scenarioName, setScenarioName, mapStatistics, statisticsText, validateScenario } from "@scm-js/core";

const map = await openMapBytes(await readFile("(2)Destination.scx"), "(2)Destination.scx");
const scn = map.scenario;

console.log(scenarioName(scn));
console.log(statisticsText(mapStatistics(scn, null, null, null)));
for (const issue of validateScenario(scn, { extras: map.extras })) console.log(issue.level, issue.where, issue.text);

setScenarioName(scn, "Destination, revised");
await writeFile("out.scx", await writeMapBytes(scn, { format: "scx", extras: map.extras, stored: map.stored }));
```

`openMapBytes` does what File ▸ Open does: reads the archive, parses the scenario, keeps
the other members (sounds, scripts, anything else) in `extras`, restores a built map to
the map it was built from, and puts the warnings the editor would show in
`scenario.warnings`. `writeMapBytes` does what Save does, with the same options —
compression, which sections to strip, and the rest — and everything kept and uncompressed
when none are given. Pass `extras` and `stored` back in, or the sounds are lost.

## What is in it

The `Scenario` object is the map: `width`, `height`, `era` (the tileset), `strings`,
`units`, `locations`, `triggers`, `briefing`, the player tables, the settings tables, the
terrain. Everything else is a function that reads or changes one.

| Area | Functions |
| --- | --- |
| Files | `openMapBytes`, `writeMapBytes`; `loadMap` and `readMembers` for the archive itself; `parseScenario` and `serializeScenario` for a bare scenario; `createScenario` for a new map |
| Describing | `scenarioName`, `scenarioDescription`, `mapVersionOf`, `mapStatistics`, `statisticsText`, `findInScenario` |
| Check Map | `validateScenario`, `issueCounts` — every rule the editor runs that needs no game data |
| Triggers | `readTriggers` / `applyTriggers`, `readBriefing` / `applyBriefing`, `newTrigger`, `newCondition`, `newAction`, `triggerNames`, `triggerUsage`; the text form, `triggersToText` / `triggersFromText`; `.trg` files, `encodeTrg` / `decodeTrg`; the condition and action definitions |
| Strings | `readStrings` / `applyStrings`, `stringUsages`, `unusedStrings`, `deleteUnused`; the table as text, `formatStringTable` / `parseStringTable`; `plainText` to drop colour codes |
| Units | `addUnits`, `removeUnits`, `updateUnits`, `moveUnits`, `makeUnit`, `unitAt`, `unitsInBox`, `isResource` |
| Locations | `addLocation`, `editLocation`, `removeLocations`, `moveLocations`, `locationName`, `usedLocations` |
| Settings | `readPlayerSettings` / `applyPlayerSettings`, forces, unit, upgrade and tech settings, `changeMapVersion`, `changeTextEncoding` |
| The map | `resizeScenario`, `placeStartLocations`, `setScenarioName`, `setScenarioDescription`; `flatTerrain` and `baseTerrain`, the flat ground a new map is filled with |
| Names | `unitName`, `upgradeName`, `techName`, `TILESETS`, `PLAYER_TYPES`, `PLAYER_RACES`, `PLAYER_COLORS` |
| Plugins | `validateManifest`, `PLUGIN_API_VERSION` — what the editor checks a plugin's manifest for |

The declarations file says the rest: every function is typed, and the types are the
editor's own, so `TriggerRecord`, `UnitRecord`, `LocationRecord` and `Issue` are what the
[plugin API](plugins.md) calls them.

## How an edit works

Reading is a plain call. Changing has two shapes, both the editor's.

**Read, change, apply.** The settings and the trigger list come out as a value and go back
with an `apply`. The apply marks the sections it touched so the next write includes them;
changing `scenario.triggers` by hand does not.

```js
const triggers = readTriggers(scn);
triggers.push(newTrigger());              // owned by All Players unless told otherwise
applyTriggers(scn, triggers);
```

**Change lists.** Units and locations produce a list of changes, which `applyUnitChanges`
or `applyLocationChanges` carries out — or undoes, with `"undo"`. That is the editor's
undo history, and it is what makes a script's edit cheap to reverse.

```js
const serial = nextSerial(scn);
const changes = addUnits(scn, [makeUnit(null, START_LOCATION, 0, 10 * 32, 10 * 32, serial)]);
applyUnitChanges(scn, changes);
```

Positions are in pixels (a tile is 32). The `null` passed to `makeUnit` is the unit table
from the game data; without it a unit gets no default resources or hit points, which is
what a start location needs anyway.

## Triggers as text

`triggersToText` gives the triggers in the text form the editor's trigger window and the
TrigEdit plugin use, and `triggersFromText` reads it back, so triggers can live in a text
file, be diffed, edited in any editor and put back:

```js
import { writeFile } from "node:fs/promises";
await writeFile("triggers.txt", triggersToText(scn, readTriggers(scn)));
// … later …
applyTriggers(scn, triggersFromText(scn, await readFile("triggers.txt", "utf8")));
```

The [trigger reference](triggers.md) gives every condition and action in that form.
Strings have the same pair, `formatStringTable` and `parseStringTable`.

## What it does not do

- **Nothing that needs the game data.** Terrain checks (a unit on ground it cannot stand
  on), building counts, map pictures and the terrain tools need the tilesets and unit
  tables that only the editor has. `mapStatistics` and `validateScenario` take `null` for
  them and leave those parts out, as the command line does.
- **No plugin API.** The functions are the editor's, not `api.*`; a plugin's code does not
  run here. A plugin can share logic with a script by putting it in a module both import.
- **One language.** The library's own text — a warning, an issue — is English.
- **Map text is bytes.** Strings come and go in the map's encoding (`changeTextEncoding`
  switches it) and keep their colour codes; `plainText` strips them for display.

## Versions

The library's version is the editor's: `@scm-js/core` 0.9.0 reads and writes what scmJS
0.9.0 does, and the two are published together. A map written by the library opens in the
editor of the same version without a warning, and the other way round.

The surface is what this page lists. A function stays once published; one that has to go
is noted here first.

## In the browser

The package has no Node.js dependency, so it bundles into a page as it is. `openMapBytes`
takes a `Uint8Array`, which is what a `File` gives after `arrayBuffer()`.

## In the source

For developers. The package is built from the editor's own modules, which is how it stays
exactly the editor's code.

| File | Does |
| --- | --- |
| `core/src/index.ts` | The whole public surface: one line per export, from the editor's modules |
| `core/package.json` | The package; its version is written by the build from the editor's |
| `scripts/build-core.mjs` | Builds `core/dist/index.mjs` (one module, mopaq left as a dependency) and `core/dist/index.d.ts` (one declarations file) |
| `src/editor/mapFile.ts` | `openMapBytes` and `writeMapBytes`: opening and saving without the browser's pickers |
| `tests/core.test.ts` | That nothing behind the entry runs UI code, that the command line imports only what the entry exports, and that the entry opens, checks, rewrites and reopens the test maps |
| [@scm-js/replay](https://github.com/scm-js/replay) | Replays, a package of their own |
