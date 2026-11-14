# @scm-js/bot

Types for StarCraft: Brood War bots written in JavaScript. A bot is one ES module that
plays a computer seat on [scmjs.dev/play](https://scmjs.dev/play/), which runs the game's
own 1.16.1 engine in the browser, or from a terminal with `scmjs bot run`. This package
gives your editor completion for what the game hands the bot. Nothing in it runs, and a
bot imports nothing at run time.

```sh
npm install --save-dev @scm-js/bot
```

In JavaScript, name the type in a comment:

```js
/** @type {import("@scm-js/bot").EasyBot} */
export default {
  name: "Miner",
  onFrame(game) {
    game.mine();                          // idle workers to the minerals
    game.keepSupply();                    // a depot, pylon or overlord before supply runs out
    game.want(game.race.worker, 24);      // train workers up to 24, counting those on their way
    game.want("Barracks", 2);             // a builder, the money, a site, another try if refused
    game.want("Marine", 40);
    if (game.army.length >= 12) game.army.idle.attack(game.enemyBase());
  },
};
```

In TypeScript, import them with `import type`:

```ts
import type { EasyBot, Game } from "@scm-js/bot";
```

Add the file on the play page under Options, Community bots, "Add a bot from a file…", and
choose it in a computer row of the setup screen; or run
`scmjs bot run mybot.mjs "(2)Jungle Duel.scx"` with the
[scmjs command line](https://www.npmjs.com/package/@scm-js/cli).

The guide, with a first bot, everything `game` offers, bots for mods and the interface
underneath (`create(init)` and `onFrame(view, api)`, `BotModule` here), is at
[docs.scmjs.dev/bots](https://docs.scmjs.dev/bots/).

The package's major version is the bot interface's, `BOT_API`. The interface only grows: a
field or a call that exists keeps its meaning. MIT-licensed; the source is
[github.com/scm-js/scm-js](https://github.com/scm-js/scm-js), under `bot/`.
