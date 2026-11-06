# @scm-js/core

StarCraft: Brood War maps in Node.js and the browser, as the [scmJS](https://scmjs.dev)
editor reads and writes them. Open a `.scm`, `.scx` or `.chk`; read and change its
triggers, strings, units, locations and settings; run Check Map; write the map back. It is
the editor's own code, built from the same source, so a map goes through this library
exactly as it goes through the editor of the same version. No game data is needed.

```sh
npm install @scm-js/core
```

```js
import { readFile, writeFile } from "node:fs/promises";
import { openMapBytes, writeMapBytes, scenarioName, readTriggers, triggersToText, validateScenario } from "@scm-js/core";

const map = await openMapBytes(await readFile("(2)Destination.scx"), "(2)Destination.scx");
console.log(scenarioName(map.scenario));
console.log(triggersToText(map.scenario, readTriggers(map.scenario)));
for (const issue of validateScenario(map.scenario, { extras: map.extras })) console.log(issue.level, issue.text);

await writeFile("out.scx", await writeMapBytes(map.scenario, { format: "scx", extras: map.extras, stored: map.stored }));
```

The guide, with what is in the package and how an edit works, is at
[docs.scmjs.dev/core](https://docs.scmjs.dev/core/). The `scmjs` command line
([@scm-js/cli](https://www.npmjs.com/package/@scm-js/cli)) is built on the same functions;
replays are [@scm-js/replay](https://www.npmjs.com/package/@scm-js/replay).

Node.js 22.12 or newer. ES modules, with TypeScript declarations. The one dependency is
[mopaq](https://github.com/jeany55/mopaq). MIT-licensed; the source is
[github.com/scm-js/scm-js](https://github.com/scm-js/scm-js), under `core/`.
