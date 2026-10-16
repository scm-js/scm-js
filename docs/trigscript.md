# TrigScript

TrigScript lets you write a map's triggers as code. The code is TypeScript, and it is kept
inside the map. TrigScript is a plugin that is on from the start: Triggers ▸ TrigScript…
opens it as soon as a map is open.

A script can make two kinds of things:

| | `trigger()` | `program()` |
| --- | --- | --- |
| What it makes | Ordinary triggers in the map's list | Code that runs inside the game |
| Plays on | Every version of StarCraft | StarCraft: Remastered only |
| Good for | Anything the Trigger Editor can do, without the repetition | Counters, timers, per-player state, loops over units, keys and chat |

Each `trigger()` call becomes one trigger, the same kind the Trigger Editor shows. The
code around the calls runs only while the script is applied, so a loop over the players, a
helper that returns the ten triggers a shop needs, or a table of waves all end up as plain
triggers.

Code inside `program(() => { … })` runs in the game instead. It has variables, arrays,
text, functions, classes, loops and `sleep`, so a lives counter or a wave timer is a loop
rather than a dozen triggers with hand-numbered death counts. The eudplib plugin (also on
from the start) builds programs into the map when it is [saved](guide.md#saving), and **a
map with a program in it needs StarCraft: Remastered**. If the map must play on the
classic game, use `trigger()` only.

![The TrigScript editor on a wave-defence script: the files on the left and the code checked as you type](images/trigscript.webp)

TrigScript works beside the editor's other trigger tools. The Trigger Editor shows the
triggers a script made, and the Text Trigger Editor (the TrigEdit plugin, installed but
off until you turn it on) shows them as text. The Trigger Map plugin, from Plugins ▸
Browse Plugins…, draws how triggers depend on each other. See
[Triggers](guide.md#triggers) in the user guide. What each condition and action does in
the game is in the [trigger reference](triggers.md). The words this page uses are
explained under [Terms](#terms).

## Quick start

This makes a map where Player 1 wins by walking a Marine onto a marked spot.

1. Open a map, or make one with File ▸ New (Ctrl+N). In Scenario ▸ Player Settings, give
   Player 1 a fixed race such as Terran. A player left on *User Selectable* gets a melee
   base instead of the units you place; see [Your first map](guide.md#your-first-map).
2. On the **Units** layer (`U`), pick Player 1 at the top of the palette and place a
   Terran Marine.
3. On the **Locations** layer (`L`), drag a box a short walk away from the Marine.
   Double-click the box and name it `Beacon`.
4. Open Triggers ▸ TrigScript…. Replace the contents of `main.ts` with:

   ```ts
   trigger(P1, [
     bring(P1, units.AnyUnit, locations.Beacon, ">=", 1),
   ], [
     displayText("You found the beacon."),
     victory(),
   ]);
   ```

   As you type `locations.`, the editor offers the map's locations by name.
5. Save the map (Ctrl+S). Saving applies the script: the trigger goes into the map's
   trigger list. The status bar at the bottom of the TrigScript window shows how many
   triggers the script made and where they start in the list, such as **1 trigger at #1**.
6. Press **Play** (F5) in the TrigScript window, or use Tools ▸ Test Map in the editor.
   The first time, Test Map needs to know where the game is; see [Test
   Map](guide.md#test-map). In the game, open Single Player ▸ Custom Game, pick the map
   from the `scmJS` folder, and choose *Use Map Settings* as the game type. Walk the
   Marine to the beacon.

To see what the script made, open the Trigger Editor (Ctrl+T). The trigger is there with a
`script` badge. From here, [Writing triggers](#writing-triggers) explains the parts of a
trigger, and [Examples of triggers](#examples-of-triggers) has complete scripts to start
from.

## Writing triggers

A trigger is one call:

```ts
trigger(AllPlayers, [
  bring(CurrentPlayer, units.AnyUnit, locations.Beacon, ">=", 1),
], [
  displayText("You found it!"),
  preserve(),
]);
```

`trigger(players, conditions, actions, options?)` records one trigger:

- `players` is one player or a list of them.
- `conditions` is a list of conditions, up to 16.
- `actions` is a list of actions, up to 64.
- `options` are the trigger's flags by name. `{ preserve: true }` is the same as the
  `preserve()` action; `disabled`, `ignoreGameEnd` and the others are listed in the
  [Reference](#triggers).

The order of the `trigger()` calls is the order of the triggers in the map.

### Conditions and actions

Every condition and action the game has is a function named after StarEdit's name for it,
in camel case: `bring`, `deaths`, `command`, `accumulate`, `elapsedTime`, `createUnit`,
`displayText`, `setResources`, `moveUnit`, `order`, `runAiScript`, `victory`. The one
exception is the Switch condition, which is `switchIs`, because `switch` is a reserved
word.

The arguments come in the order the Trigger Editor shows them. Where the Trigger Editor
offers a list, the argument is a short word:

- a comparison is `">="`, `"<="` or `"=="`;
- a modifier is `"set"`, `"add"` or `"subtract"`;
- a resource is `"ore"`, `"gas"` or `"oreAndGas"`;
- an order is `"move"`, `"patrol"` or `"attack"`;
- a unit count is a number or `"All"`.

The full list is in the [Reference](#argument-words). StarEdit's own labels, such as
`"At least"`, work too. Hover over any function in the editor to see its arguments.

`not(condition)` is the opposite of a condition, where one condition can say it:
`not(bring(…, ">=", 1))` is "at most 0".

### Names from the map

Units, locations and switches are named the way the map names them:

- Each display name becomes an identifier: `Terran Marine` is `units.TerranMarine`, and
  `Terran Siege Tank (Tank Mode)` is `units.TerranSiegeTankTankMode`. The display name
  works as well: `units["Terran Marine"]`.
- `locations.` lists the map's locations, and `switches.` its switches, by number and by
  any name the map gives them.
- `P1` … `P12`, `CurrentPlayer` and `AllPlayers` are constants. The other player groups
  are under `players`: `players.Force1`, `players.Foes`, `players.Allies`.
- A plain number works wherever a name does. That is how an EUD player or an unusual unit
  id gets in.

The editor checks the names as you type. A location passed where a unit belongs is an
error, and so is a name the map no longer has.

### Many triggers from a little code

The script runs when it is applied, and everything TypeScript offers is available at that
moment. A loop makes the same trigger for several players, a function returns a list of
actions, a table holds the numbers, and a template string builds the text:

```ts
function reinforce(p: Player) {
  return trigger(p, [deaths(p, units.TerranMarine, ">=", 10)], [
    createUnit(p, units.TerranSiegeTankTankMode, 1, locations.Spawn),
    setDeaths(p, units.TerranMarine, "subtract", 10),
    displayText("Reinforcements have arrived."),
  ], { preserve: true });
}

for (const p of [P1, P2, P3, P4]) reinforce(p);
```

Nested lists are flattened, and `false`, `null` and `undefined` entries are skipped. A
helper can return a list of actions, and a condition can be written
`hardMode && bring(…)`.

A condition is a *value* here: the game tests it later, when the map is played. So
`if (bring(…))` outside a program does not do what it looks like, and the editor says so.
The test belongs in a trigger's conditions, or in an `if` inside a [program](#programs).

### Several files

A script can have several files. `import { x } from "./name"` brings in another file of
the map's script; nothing else can be imported. The library is available everywhere
without an import, and also as the module `"trigscript"` for anyone who prefers
`import { trigger, bring } from "trigscript"`.

### Hyper triggers

`hyperTriggers(P8)` anywhere in the script adds the usual three preserved triggers of
sixty-two waits, so that the game goes through the trigger list every 2 frames instead of
every 31 ([Hyper triggers](triggers.md#hyper-triggers)). Give them to a player whose other
triggers never wait, usually a computer slot: each player has one wait slot, and the hyper
triggers keep it busy ([Waits](triggers.md#waits)). A map with a program does not need
them, since its build already makes the list run every frame.

## Examples of triggers

Each of these is a complete `main.ts`, and each plays on every version of the game. They
assume a map with locations named `Beacon`, `Spawn`, `Base`, `Hill` and `Shop`. Use your
own names; the editor completes them.

**Starting resources and a welcome.** No preserve, so the trigger runs once, and
`CurrentPlayer` means each player in turn.

```ts
trigger(AllPlayers, [always()], [
  setResources(CurrentPlayer, "set", 500, "ore"),
  setResources(CurrentPlayer, "set", 100, "gas"),
  displayText("Hold the hill for five minutes to win."),
]);
```

**Hyper triggers.** One line, and the whole trigger list runs every 2 frames. Player 8 is
the computer slot here, and nothing else in the script makes that player wait.

```ts
hyperTriggers(P8);
```

**Something for every player.** A helper returns the trigger, and a loop calls it. Death
counts are the game's own counters. Subtracting ten after the reward lets the trigger fire
again at the next ten, which `preserve: true` allows.

```ts
function reinforce(p: Player) {
  return trigger(p, [deaths(p, units.TerranMarine, ">=", 10)], [
    createUnit(p, units.TerranSiegeTankTankMode, 1, locations.Spawn),
    setDeaths(p, units.TerranMarine, "subtract", 10),
    displayText("Reinforcements have arrived."),
  ], { preserve: true });
}

for (const p of [P1, P2, P3, P4]) reinforce(p);
```

**A shop.** Bring a civilian to the shop with enough minerals, and four marines appear at
the spawn. The civilian is moved out first, so the trigger does not fire again on the next
pass. `price` is an ordinary constant used twice.

```ts
const price = 150;

trigger(AllPlayers, [
  bring(CurrentPlayer, units.TerranCivilian, locations.Shop, ">=", 1),
  accumulate(CurrentPlayer, ">=", price, "ore"),
], [
  moveUnit(CurrentPlayer, units.TerranCivilian, 1, locations.Shop, locations.Spawn),
  setResources(CurrentPlayer, "subtract", price, "ore"),
  createUnit(CurrentPlayer, units.TerranMarine, 4, locations.Spawn),
  displayText(`Four marines for ${price} minerals.`),
], { preserve: true });
```

**A map that already has triggers.** Open TrigScript, press **…** and choose **Import the
Map's Triggers**. Every hand-made trigger comes back as a `trigger()` call, in its order,
and applying the script replaces the whole list with what it makes. From there a repeated
trigger becomes a loop, a number used in ten places becomes a constant, and the rest stays
as it was.

## Programs

Everything inside `program(() => { … })` runs in the game:

```ts
program(() => {
  let wave = 0;
  let alarm = false;
  while (true) {
    if (bring(P1, units.AnyUnit, locations.Beacon, ">=", 1) && !alarm) {
      alarm = true;
      displayText("They are coming.");
    }
    if (alarm) {
      createUnit(P8, units.ZergZergling, 4, locations.Spawn);
      wave += 1;
    }
    if (wave >= 10) defeat();
    sleep(seconds(20));
  }
}, { owner: P1 });
```

A map with a program needs StarCraft: Remastered. The programs are built into the map when
it is saved or tested (see [Saving and building](#saving-and-building)).

> **Note.** Building a program also changes how the rest of the map runs: the game goes
> through the trigger list every frame instead of every 31 frames. A preserved trigger that
> adds a mineral then adds twenty-four a second at Fastest.

### What is worked out when the script is applied

This is the one rule to keep in mind. **Everything the program reads from outside its body
is worked out once, when the script is applied**, before the game starts: a constant, a
helper, a condition, an action. The editor underlines those parts with dots, so you can
see the boundary as you type. That is what lets a helper written outside the program
supply actions inside it.

It also means a program variable cannot reach a condition, an action or a helper. The
location and the player of an action, and the amount a condition compares with, are fixed
when the script is applied. To compare with a variable, read the quantity and compare it
yourself: `minerals(P1) >= price` (see [Reading the game](#reading-the-game)).

These parts of an action can follow a variable:

- the amount of `setResources`, `setDeaths`, `setScore` and `setCountdownTimer`;
- the unit count of `createUnit`, `killUnitAt`, `removeUnitAt` and `giveUnits`;
- an action's unit type;
- a text: `displayText` and `print`, the objectives, a leaderboard's label, a transmission
  and a unit type's name take any text the program made.

A sound's path or the next scenario's name is a text written in the script.

### How a program runs

**A program runs every frame, from where it left off.** It starts on frame 2, the game's
first pass. Its body runs until it reaches a `sleep()` or its end, all within one frame of
the game, and the next frame it carries on from there. A body that ends stops for good. So
the loop above is a game loop: it looks at the beacon, sends a wave if the alarm is up,
and sleeps twenty seconds.

**Time is `sleep`.** `sleep(seconds(15))` gives the frame back and carries on that much
later, while other programs and the map's triggers go on. `frames(n)` and `minutes(n)`
make a duration too. Something that runs on its own clock is another program: one program
for each thing that happens at the same time.

The game's own `wait()` is allowed in a program, but it is a different thing: it holds the
rest of its trigger for the time, and it uses the player's one wait slot, so any other
Wait of that player stops until the slot is free ([Waits](triggers.md#waits)). Use it for
a short pause, such as a text and then a sound, and use `sleep` to pass time.

**Two kinds of second.** A second of `sleep(seconds(n))` is 24 frames, which is one real
second at Fastest. A *game second* is 16 frames at every speed. `elapsed()`, `countdown()`
and the Elapsed Time and Countdown Timer conditions count game seconds, so at Fastest they
run about one and a half times as fast as `sleep` seconds: after `sleep(seconds(14))`,
`elapsed()` reads about 21.

**Edges.** `if (rose(bring(…)))` is true on the frame the condition becomes true, and not
again until it has been false in between. `once(…)` is true the first time only.
`random()` is a coin toss, and `random(n)` a whole number from 0 to n − 1.

### Owners and per-player programs

**A program runs for its owner**, as that player, while that player is in the game. The
owner is Player 1 unless `{ owner: … }` says otherwise.

An owner of `AllPlayers`, a force or a list of players makes a **per-player program**. The
same code runs for each of those players who is in the game, computers included.
`CurrentPlayer` is that player, and every variable is per player, each with its own copy.
That is how lives, scores and cooldowns are written once. `let total = shared(0)` is one
value that all of them share.

`{ name: "waves" }` names a program. The name appears in the Explorer, and a
[test](#tests) finds the program by it.

### Variables and numbers

Variables hold numbers, booleans, texts and units of the game.
`let p = { lives: 3, gold: 0 }` is a record, one variable per field. Variables live in the
game while the map is played and take nothing from the map: no death counters, no
switches, no triggers in the list.

Numbers are whole, as the game's are:

| Type | Range | At either end |
| --- | --- | --- |
| `number` | −2 147 483 648 to 2 147 483 647 | wraps |
| `u8` | 0 to 255 | stops |
| `u16` | 0 to 65 535 | stops |
| `u32` | 0 to 4 294 967 295 | wraps |

- A plain `number` is signed: `a - b` is below zero when `b` is larger, and a number below
  zero is shown with its minus sign.
- `u8` and `u16` (`let lives: u8 = 3`) stop at both ends, which is what lives and
  cooldowns want.
- `u32` is for bit masks and hashes. It is kept apart from a plain number in arithmetic
  unless `u32(x)` or `i32(x)` says which is meant.
- `+`, `-`, `*`, `/` and `%` work between variables, and so do `Math.min`, `Math.max`,
  `Math.abs`, `clamp()` and the bitwise `&`, `|`, `^`, `<<`, `>>` and `>>>`.
- Division is whole and rounds towards zero. Dividing by a variable that is 0 gives 0.
- Where the game takes nothing below zero (hit points, an amount, a unit count), a number
  below zero goes in as 0.

### Arrays

Arrays hold numbers, booleans, texts, units, records or other arrays.

- Make one with `let hp = [10, 20, 30]` or `new Array(12).fill(3)`.
- An index can be a constant or a variable: `hp[i] += 7`.
- `.length`, `for (const x of xs)`, `fill`, `includes` and `indexOf` work.
- An array that something pushes to grows, with no size to declare:
  `const queue: number[] = []; queue.push(x); queue.pop() ?? 0`.
- An index past the end reads 0 and stores nothing, and Simulate says where.
- An array of records hands out its records by reference, as TypeScript does:
  `let waves = [{ count: 4, delay: 2 }]`, `waves[i].count += 1`, `waves.push({ … })`. A
  record may hold a unit, a text, another record or an array of its own
  (`squads[i].members.push(u)`).
- An array of units (`const squad: Unit[] = []`, `squad.push(u)`) may be kept across a
  `sleep()`.
- An array of arrays is a grid (`grid[y][x] += 1`) or rows that each grow
  (`buckets[i].push(v)`).
- A list made outside the program, such as `const price = [50, 100, 150]` or a wave table,
  can be looked up with a variable: `price[level]`, `waves[wave].count`.

Arrays that grow share one pool of memory. Its size is set in the workspace's **Settings**
view (Ctrl+,) and kept in the map.

**The array methods that take a function** work as in TypeScript: `forEach`, `some`,
`every`, `find`, `findIndex`, `reduce`, `map`, `filter`, `sort` and `reverse`, and chains
of them. `filter` over the units of the game is how to keep some of them:

```ts
program(() => {
  while (true) {
    // The three most hurt units at the base get 20 hit points, every two seconds.
    const hurt = unitsAt(locations.Base, { owner: CurrentPlayer }).filter((u) => u.hp < u.maxHp);
    hurt.sort((a, b) => a.hp - b.hp);
    for (const u of hurt.slice(0, 3)) u.heal(20);
    sleep(seconds(2));
  }
}, { owner: AllPlayers });
```

The function sees the program's variables, but it must be written where the method takes
it: it cannot be kept in a variable. `sort` needs its function (`(a, b) => a - b`) and
runs within the frame; it is fine for dozens of items, but sorting hundreds every frame
slows the game, and the editor marks such a line *sorts in the frame*.

`slice`, `concat`, `toSorted`, `toReversed` and `Array.from` make copies. Patterns and
spread work as well: `const { x, y } = mouse(P1)`,
`for (const { count, delay } of waves)`, `[a, b] = [b, a]`, `[...xs, 7]`,
`waves.push({ ...w, count: 9 })`.

### Tables, maps and sets

**A table keyed by an id of the game** has a cell for every id, so looking up a key is one
read. The keys are unit types, players, locations, switches, weapons, upgrades or
technologies:

- `const bounty: Record<UnitType, number> = { [units.ZergZergling]: 5 }`, then
  `bounty[u.type]`;
- `new Map<UnitType, number>()` with `get` (`?? 0` for a key never set), `set`, `has`,
  `delete`, `clear` and `size`;
- `new Set<UnitType>()` with `add` and the same;
- `for (const [key, value] of lost)` goes through the keys that are set.

**A `Map` or a `Set` over any number, or over units**, is for keys that are not ids of the
game: `new Map<number, number>()` for a tile packed into one number,
`new Map<Unit, number>()` for a cooldown per unit, `new Set<Unit>()` for the units already
dealt with. They go through their keys in the order the keys were added, as JavaScript's
do. Looking up a key takes a few steps rather than one read, and the values are numbers or
booleans. A unit that died stays an entry until it is deleted; in a loop over the map it
reads as no unit, which is the moment to delete it.

### Control flow

`if`/`else`, `while`, `do`, `for`, `switch`, `break`, `continue` and `c ? a : b` all work.
Conditions go in an `if` or a `while`, and actions stand as statements.

A loop runs all its rounds at once, within the frame. A loop that never ends and never
sleeps would freeze the game, so the editor refuses one and says where to put
`sleep(frames(1))`. A `for` whose bounds are known when the script is applied is written
out round by round, and the editor says so at the end of the line.

### Reading the game

Every condition that compares a quantity is also a *read* of it when the comparison and
the amount are left out, and a read goes wherever a number goes:

```ts
program(() => {
  let price = 50;
  while (true) {
    if (minerals(CurrentPlayer) >= price * 2 && bring(CurrentPlayer, units.AnyUnit, locations.Beacon) >= 1) {
      setResources(CurrentPlayer, "subtract", price, "ore");
      createUnit(CurrentPlayer, units.TerranMarine, 1, locations.Spawn);
      price += deaths(CurrentPlayer, units.TerranMarine);
    }
    sleep(seconds(1));
  }
}, { owner: AllPlayers });
```

`deaths(p, unit)`, `kill(p, unit)`, `bring(p, unit, location)`, `command(p, unit)`,
`accumulate(p, resource)`, `score(p, kind)`, `countdownTimer()` and `elapsedTime()` all
read this way. The common ones have plainer names: `minerals(p)`, `gas(p)`,
`countUnits(p, unit, location?)`, `kills(p, unit)`, `countdown()` and `elapsed()`.

- A read means what its condition means: a force's minerals are the force's total, and
  `units.Men` counts what Bring counts.
- A read is taken when its line runs. `let ore = minerals(P1)` keeps the number, and
  `minerals(P1)` written twice reads twice.
- What to read (the player, the unit, the location) is fixed when the script is applied.

About the players themselves:

- `race(p)`, compared with `races.Zerg`, `races.Terran` or `races.Protoss`;
- `slot(p)`, compared with `slots.Human`, `slots.Computer` or `slots.Empty`;
- `isHuman(p)` and `hasLeft(p)`;
- `supply(p, "used" | "max" | "provided")`, as the top bar shows it.

### Units

The units on the map are objects. A loop runs over the ones that match, a pick finds one,
and a unit has properties and things it can be told to do:

```ts
program(() => {
  while (true) {
    // Everything Player 2 has on the hill is worn down to half health.
    for (const u of unitsAt(locations.Hill, { owner: P2 })) u.hp = u.maxHp / 2;

    // The Marine nearest the beacon is sent to the base; nobody else moves.
    const scout = nearest(units.TerranMarine, locations.Beacon, { owner: P1 });
    if (scout) scout.order("move", locations.Base);

    sleep(seconds(5));
  }
});
```

- `unitsAt(location, filter?)`, `unitsOf(player, filter?)` and `allUnits(filter?)` are
  what a `for…of` runs over.
- `first(filter?)`, `nearest(type, location, filter?)` and `randomUnit(filter?)` give one
  unit, or `null` when nothing matches. So the `if (scout)` is required, and the editor
  says so when it is missing.
- A filter is `{ type, owner, at }`. `units.Men`, `units.Buildings` and `units.Factories`
  work as a type.

A unit's hit points, shields, energy, kills, weapon cooldown, spell timers (`stim`,
`lockdown`, `stasis`, …) and `invincible` can be read and written. Its maximums, position,
owner, type and states such as `burrowed`, `cloaked`, `hallucinated` and `underAttack` can
only be read; the editor marks a write to one as you type. A unit can be told
`order("move" | "patrol" | "attack", location)`, `give(player)`, `kill()`, `remove()`,
`damage(n)` and `heal(n)` (or `{ percent: 50 }`), and `locate(location)`, which centres a
location on the unit so that ordinary actions can happen where it stands. The
[Reference](#inside-a-program) lists them all.

A variable can keep a unit across a `sleep`. Units die, and the game hands a dead unit's
place to the next unit made, so every use checks that the unit is still the same one: once
it is gone, its numbers read 0 and nothing written to it has any effect. `if (u)` asks
whether it is still there.

A loop over units runs within one frame, so a `sleep` inside one is an error. To take
units one at a time, find the next one after each sleep. Each loop and each pick looks
through all 1700 of the game's unit slots, which is nothing a few times a second but worth
a thought every frame; the editor marks such a line *scans units*.

### The game's tables

`stats()` reaches the game's own tables: what a unit type costs, what a weapon does, which
upgrades a player has.

```ts
program(() => {
  stats(units.TerranMarine).minerals = 25;
  stats(units.TerranMarine).speed = 6.5;               // pixels a frame; a Marine walks at 4
  stats(units.ZergZergling).name = "Dog";
  stats(weapons.GaussRifle).damage += 2;
  stats(P1).upgrades[upgrades.TerranInfantryWeapons] = 3;
  stats(P3).color = "teal";
});
```

A field reads as a number (or true or false) and takes `=` and `+=`. Unit types, weapons
(`weapons.`), upgrades (`upgrades.`), technologies (`techs.`) and players each have their
own fields, and the completion list after the dot is the full list: only what has been
tested in Remastered is offered. Hover over a field to see what it affects. Most unit-type
fields apply to units made after the write, a weapon's fields to every unit using it, and
a colour at once. A write lasts for the rest of the game.

### Keys, the mouse and chat

A program can read what the players do: a key, a mouse button, where the mouse is, and
what a player types.

```ts
program(() => {
  while (true) {
    if (keyPressed(CurrentPlayer, "F8")) createUnit(CurrentPlayer, units.TerranMarine, 1, locations.Anywhere);

    if (clicked(CurrentPlayer, "right")) {
      const at = mouse(CurrentPlayer);
      displayText(`You clicked at ${at.x}, ${at.y}.`);
    }

    const m = chatted(CurrentPlayer, "-spawn {n} {what:unit}");
    if (m) createUnit(CurrentPlayer, m.what, m.n, locations.Anywhere);

    underMouse(CurrentPlayer, { owner: CurrentPlayer })?.heal(10);
    sleep(frames(1));
  }
}, { owner: AllPlayers });
```

> **Reading input takes three things from the map.** One free location among the first 63
> (nine when the mouse is read), the Valkyrie unit type and Player 12 carry the input
> between the players' computers. Leave them alone in the rest of the map. The editor tells
> you when there is no free location.

- A key, a click and a typed line are true on the one frame they arrive, so look for them
  in a loop that sleeps one frame at a time. Everything reaches every player's computer a
  few frames after it happens.
- `keyPressed` is true once per press. It is not true while the key is held, or while the
  player is typing a message. F6 cannot be read: the game keeps it.
- `mouse(p)` is the place on the map under the player's cursor, in pixels (32 to a tile).
  `centerLocation(location, x, y)` moves a location there, so a unit can be created under
  the cursor. `underMouse(p)` is the unit nearest the cursor, or `null`.
- `chatted(p, pattern)` is `null` until the player sends a line that fits the pattern, and
  then holds what the pattern read out of it.

In a chat pattern, the pattern's own words are matched exactly and the whole line has to
fit. `{n}` reads a whole number, `{what:unit}` a unit type by its name (it takes the rest
of the line, so it comes last), and `{kind:ore|gas}` one of the listed words, as its place
in the list. The editor knows the names in the pattern: after `m.` it offers `n` and
`what`. Start a pattern with a word of its own, such as `-spawn`, so ordinary talk is left
alone. A single-player game has no chat, so try typed lines in a multiplayer game; hosting
one alone is enough.

### Text

A text can hold the program's numbers. Write it as a template literal:

```ts
program(() => {
  let wave = 0;
  while (true) {
    wave += 1;
    displayText(`Wave ${wave}: you have ${minerals(CurrentPlayer)} ore, ${name(CurrentPlayer)}.`);
    print(`${color(P1)}${name(P1)}\x01 leads with ${kills(P1, units.AnyUnit)} kills`, { to: AllPlayers, position: "center" });
    sleep(seconds(30));
  }
}, { owner: AllPlayers });
```

`name(p)` is the player's name and `color(p)` the colour code of their colour, both filled
in by the game. `displayText` shows the text to the current player.
`print(text, { to, position })` shows it to someone else (a player, `AllPlayers` or a
force), and with `position: "center"` on the line in the middle of the screen where the
game's own messages appear.

A text is a value. A `string` variable holds one, a function takes and returns one, a
record has one as a field, and there is no length to declare:

```ts
program(() => {
  let shown = "";
  while (true) {
    const slain = kills(P1, units.AnyUnit);
    const rank = slain >= 50 ? "Veteran" : slain >= 10 ? "Soldier" : "Recruit";
    const line = `${rank}: ${slain} kills, ${Math.max(50 - slain, 0)} to go`;
    if (line != shown) { setMissionObjectives(line); shown = line; }
    sleep(seconds(1));
  }
});
```

- Texts take `+`, `+=`, templates, the comparisons, `length`, `s[i]`, `slice`, `indexOf`,
  `includes`, `startsWith`, `endsWith`, `padStart`, `padEnd`, `repeat` and
  `for (const ch of s)`. A character counts as one, so `"저글링".length` is 3.
- The objectives, a leaderboard's label, a transmission's line and a unit type's name take
  a text the program made, up to 255 bytes.
- The screen shows the text as it was when the action ran, so run the action again when
  the text changes, as above.
- A made text holds up to 1 023 bytes. Past that it is cut off, and the game says so once
  in red.

### Functions and classes

**Functions** declared inside the program, or made with `game()` in any file, run in the
game too. Arguments pass by value. A function may return a number, a boolean, a text or a
unit (`function canAfford(price: number) { return gold >= price; }`), and it may sleep.

A function may call itself (`fib(n - 1) + fib(n - 2)`, or a flood fill over an array), as
long as it does not sleep. Each call has its own parameters and local variables, as in
TypeScript. It may go 1 024 calls deep unless the workspace's Settings view says
otherwise; a call past that stops the program, and the game says where.

**Classes** are TypeScript's, declared inside the program: fields, a constructor, methods,
`get` and `set`, `static`, `private`, `extends` with `super`.

```ts
program(() => {
  class Wave {
    left: number;
    constructor(public unit: UnitType, count: number) { this.left = count; }
    get done() { return this.left == 0; }
    send() {
      createUnit(P8, this.unit, 1, locations.Spawn);
      this.left--;
    }
  }
  const waves = [new Wave(units.ZergZergling, 12), new Wave(units.ZergHydralisk, 6)];
  for (const w of waves) {
    print(`${w.left} are on their way`, { to: AllPlayers });
    while (!w.done) { w.send(); sleep(seconds(1)); }
    sleep(seconds(30));
  }
  victory();
});
```

An instance is a record, and a method is a function that is handed the instance, so what
holds for functions holds for methods. The class of each instance is decided when the
script is applied; nothing of a class is left in the game. So an array of instances holds
one class, and a function can return an instance only when every `return` gives the same
class (`return this`, so that calls chain, or `return new Wave(…)`).

## Examples of programs

Each of these is a complete `main.ts` for a map that needs StarCraft: Remastered. Like the
[trigger examples](#examples-of-triggers), they assume locations named `Beacon`, `Spawn`,
`Base`, `Hill` and `Shop`.

**Waves from a table.** The table is ordinary data, and the program walks it: one wave
every forty-five seconds, then it waits for the last attacker to die. A `for … of` over a
list known when the script is applied is written out once per entry, so `w.unit` and `w.n`
are plain values in each copy. The program runs as Player 1, so `victory()` is Player 1's;
a team needs a `trigger()` for the others.

```ts
const waves = [
  { unit: units.ZergZergling, n: 8 },
  { unit: units.ZergHydralisk, n: 6 },
  { unit: units.ZergUltralisk, n: 2 },
];

program(() => {
  displayText("The first wave arrives in thirty seconds.");
  sleep(seconds(30));
  for (const w of waves) {
    createUnit(P8, w.unit, w.n, locations.Spawn);
    order(P8, w.unit, locations.Spawn, locations.Base, "attack");
    minimapPing(locations.Spawn);
    sleep(seconds(45));
  }
  while (command(P8, units.AnyUnit, ">=", 1)) {
    sleep(seconds(2));
  }
  displayText("The last wave is broken.");
  victory();
});
```

**Lives, per player.** One program runs for every player, and `lives` is a separate
counter for each. When the hero dies, the game's death count for it goes to 1. The program
resets that count, takes a life, and either brings the hero back or ends the game for that
player. The `sleep(frames(1))` at the end of the loop makes it look once a frame.

```ts
program(() => {
  let lives: u8 = 3;
  while (true) {
    if (deaths(CurrentPlayer, units.JimRaynorMarine, ">=", 1)) {
      setDeaths(CurrentPlayer, units.JimRaynorMarine, "set", 0);
      lives -= 1;
      if (lives == 0) {
        displayText("No lives left.");
        defeat();
      } else {
        createUnit(CurrentPlayer, units.JimRaynorMarine, 1, locations.Spawn);
        displayText("Your hero returns.");
      }
    }
    sleep(frames(1));
  }
}, { owner: AllPlayers });
```

**King of the hill.** A point a second for holding the hill alone, shown on a leaderboard,
and a win at a hundred. `points` is a program variable, and the amount of `setScore`
follows it. `players.Foes` means "anyone at war with the current player", so the check is
written once for everyone.

```ts
trigger(AllPlayers, [always()], [leaderboardPoints("Hill", "custom")]);

program(() => {
  let points: u16 = 0;
  while (true) {
    if (bring(CurrentPlayer, units.AnyUnit, locations.Hill, ">=", 1)
        && !bring(players.Foes, units.AnyUnit, locations.Hill, ">=", 1)) {
      points += 1;
      setScore(CurrentPlayer, "set", points, "custom");
      if (points >= 100) {
        displayText("The hill is yours.");
        victory();
      }
    }
    sleep(seconds(1));
  }
}, { owner: AllPlayers });
```

**Random events.** Every two minutes, a coin toss decides which of two things happens.

```ts
program(() => {
  while (true) {
    sleep(minutes(2));
    if (random()) {
      displayText("Reinforcements pour from the nydus canal.");
      createUnit(P8, units.ZergZergling, 12, locations.Spawn);
    } else {
      displayText("A supply drop: 100 minerals for everyone.");
      setResources(AllPlayers, "add", 100, "ore");
    }
  }
});
```

**A beacon that opens a gate, once.** `once()` is true only the first time its condition
holds, so this runs once however long the unit stands there. Two things happen on their
own clocks, so there are two programs.

```ts
program(() => {
  while (true) {
    if (once(bring(P1, units.AnyUnit, locations.Beacon, ">=", 1))) {
      displayText("The gate opens.");
      killUnitAt(P12, units.LeftUpperLevelDoor, "All", locations.Base);
      setSwitch(switches.Switch1, "set");
    }
    sleep(frames(1));
  }
});

program(() => {
  while (true) {
    if (switchIs(switches.Switch1, "set")) {
      createUnit(P8, units.ZergHydralisk, 2, locations.Spawn);
      sleep(seconds(30));
    } else {
      sleep(seconds(1));
    }
  }
});
```

**A heal that each Marine gets once every ten seconds.** A `Map` keyed by units keeps a
number for each of them. A unit that has died reads as no unit in the loop over the map,
which is where its entry is deleted.

```ts
program(() => {
  const wait = new Map<Unit, number>();
  while (true) {
    for (const u of unitsAt(locations.Hill, { owner: P1, type: units.TerranMarine })) {
      if (!wait.has(u)) { u.heal({ percent: 100 }); wait.set(u, 10); }
    }
    for (const [u, left] of wait) {
      if (!u || left <= 1) wait.delete(u); else wait.set(u, left - 1);
    }
    sleep(seconds(1));
  }
});
```

## Testing and Simulate

TrigScript can run a script without starting the game, in a simulator built into the
editor. **Simulate** shows what the script does in its first twenty seconds. **Tests** are
checks you write that run after every change. Neither adds anything to the map.

The simulator models death counts, switches, preserve, the order of the trigger list, the
game's arithmetic and the map's players. It has units: the ones placed on the map, then
whatever `createUnit` makes, `giveUnits` hands over, `moveUnit` moves and `killUnitAt`
kills, which `bring` and `command` count. It leaves out what it cannot know without the
game: nothing walks, nothing fights and nothing is built, so no unit dies unless the
script (or a test) kills it. Scores and the countdown read 0, and keys, clicks, the mouse
and chat read as nothing.

The simulator keeps the game's time, so the frames it lists are the frames the game would
act on: the first pass on frame 2, then one every 31 frames, or every frame in a map with
a program. A Wait holds its trigger for its time at Fastest. See [How triggers
run](triggers.md#how-triggers-run).

### Simulate

**Simulate** (Ctrl+F5 in the TrigScript window) runs the script for 480 frames, twenty
seconds of the game at Fastest. It lists, under the code, every action that ran with its
frame and its line in the script, and the final value of every program variable. Triggers
and programs run side by side, so a death count a program sets is seen by a trigger. A
program or a trigger of a force runs for each of its players, and each line says whose it
is.

![Simulate: the script's actions, each with its frame and line](images/trigscript-simulate.webp)

Simulate is a check on the logic. A script that waits for the enemy to die waits for ever
here; for the fight, write a [test](#tests) that kills the units, or play the map.

### Tests

A test is ordinary TypeScript that runs in the simulator after every change that compiles.
It never runs in the game and adds nothing to the map. If you have used Vitest or Jest,
the names are the same: `test`, `describe`, `beforeEach`, `test.only`, `test.skip`,
`test.each` and `expect`, imported from `"trigscript"`.

A test of a trigger:

```ts
import { test, expect } from "trigscript";

trigger(P1, [bring(P1, units.TerranCivilian, locations.Shop, ">=", 1)], [
  moveUnit(P1, units.TerranCivilian, 1, locations.Shop, locations.Spawn),
  createUnit(P1, units.TerranMarine, 4, locations.Spawn),
], { preserve: true });

test("a civilian at the shop buys four marines", (sim) => {
  sim.place(P1, units.TerranCivilian, locations.Shop);
  sim.seconds(3);
  expect(sim.count(P1, units.TerranMarine, locations.Spawn)).toBe(4);
});
```

A test of a program, which reads the program's variables by name:

```ts
import { test, expect } from "trigscript";

// A Marine on the beacon calls the next wave, each bigger than the last.
program(() => {
  let wave = 0;
  while (true) {
    if (countUnits(P1, units.TerranMarine, locations.Beacon) > 0) {
      wave += 1;
      createUnit(P8, units.ZergZergling, wave * 4, locations.Spawn);
      print(`Wave ${wave}`);
      killUnitAt(P1, units.TerranMarine, "All", locations.Beacon);
    }
    sleep(frames(1));
  }
}, { name: "waves" });

test("the second wave is bigger", (sim) => {
  sim.place(P1, units.TerranMarine, locations.Beacon);
  sim.until(() => sim.program("waves").wave === 1);
  sim.place(P1, units.TerranMarine, locations.Beacon);
  sim.until(() => sim.program("waves").wave === 2);
  expect(sim.count(P8, units.ZergZergling, locations.Spawn)).toBe(12);
  expect(sim).toHavePrinted("Wave 2");
});
```

Every test gets `sim`, a world of its own: the map's placed units, locations and players,
the script's programs and triggers, and the same `random()` results every run. Time in a
test is the game's: nothing runs on frame 1, the first pass is on frame 2, and
`sim.frames(3)` gives a program two runs.

| What a test does | With |
| --- | --- |
| Change the world | `sim.place(player, type, location, count?)`, `sim.kill(unit)`, `sim.remove(unit)`, `sim.give(unit, to)`, `sim.move(unit, to)` |
| Let time pass | `sim.frames(n)`, `sim.seconds(n)`, `sim.until(() => …)` |
| Act as a player | `sim.press("F2")`, `sim.click()`, `sim.type("-give 100")`, `sim.moveMouse(x, y)` |
| Read the world | `sim.count(player, type, location?)`, `sim.units(filter?)`, `sim.resources(player)`, `sim.deaths(player, type)`, `sim.switch(n)` |
| Read a program | `sim.program("waves").wave` |
| See what was shown | `sim.printed()`, `expect(sim).toHavePrinted("Wave 2")` |

- `place` gives the new units back, and `kill` stands in for a fight.
- `until` fails the test if its condition is still not true after 2400 frames, so no test
  hangs.
- What a player does is found by the program on the next frame.
- `sim.program(…)` gives a program's variables by their names in the code: numbers, texts,
  arrays, and a record as an object. Name the program in its options
  (`{ name: "waves" }`), or give its place in the script, counting from 0:
  `sim.program(0)`. For a per-player program, name the player too:
  `sim.program("lives", P2)`.

A test fails when an `expect` does not hold, when it throws, and when a program does
something that is always a mistake and that the game would pass over in silence, such as
reading past the end of an array. A test that means to check for that says
`expect(sim).toHaveFaulted()`.

Tests live beside what they test, as above, or in files whose names end in `.test.ts`, in
any folder. A test file can `import` the script's own functions and test them as plain
TypeScript. A test file is never part of the map: `main.ts` cannot import one, and a
`trigger()` or a `program()` inside one is an error.

![A failing test: the mark in the margin, what was expected at the end of the line, and the Testing view](images/trigscript-tests.webp)

In the editor, every `test(` has a mark in the margin (passed, failed or not run), and a
click on the mark runs that test. A failure is shown where it happened, as
`expected 7, got 6` at the end of the line.

- The **Testing** view, from the strip at the far left, lists the tests by folder, file
  and `describe`. It runs all of them, one of them or the ones that failed, and can show
  only the failing ones.
- The status bar keeps the count.
- **Test Results**, under the code, has the chosen test's message, what it printed and
  what happened frame by frame.

A failing test is a warning, not an error: the map still saves and builds. The **Tests**
setting in the workspace's Settings view, kept in the map, makes a failing test stop the
build instead.

## The workspace

This part covers the TrigScript window, the panel beside the map, and what happens to the
script when the map is saved.

### Opening the script

Triggers ▸ TrigScript… opens the map's script in a window laid out like VS Code, with the
same keys:

| Part | What is there |
| --- | --- |
| Explorer (left, Ctrl+B) | The script's files as a tree, and under them the programs with their variables |
| Strip at the far left | Switches the sidebar between the Explorer and **Testing** |
| Tabs (over the code) | One per open file |
| Icons right of the tabs | **Play** (F5), **Simulate** (Ctrl+F5), **Apply** (Ctrl+Shift+B), **Pick from map**, beside the map or in a window, and **…** for the rest |
| Panel (under the code, Ctrl+J) | **Problems**, **Output**, **Simulate**, **Test Results** and **Settings** (Ctrl+,) |
| Status bar | Problems, tests, whether the triggers are in the map, the last build |
| Command palette (F1) | Every command |

`main.ts` is where the script starts. *New file* and *New folder* add to it, and a row's
pencil and bin rename and remove a file. To move a file or folder, drag it onto a folder,
or rename it with a folder before its name. The `import`s that pointed at it are rewritten
to match, and the notice that says so has an **Undo**. Folders mean nothing to TrigScript
itself: `tests/` is a habit, not a rule.

Edits are saved into the map as you type, since the files are part of the map archive,
like a sound. Ctrl+S saves the map from inside the TrigScript window too.

The code is checked as you type, against the map's own names: `locations.` completes to
the locations the map has, `units.` to every unit type (and the map's custom names),
`switches.` to the switches, and `players.` to the forces. The status bar counts the
problems, and a click on the count opens **Problems**, the list of them.

![Completion on `locations.`, listing what the open map has](images/trigscript-complete.webp)

The **Settings** view holds what the map's author chose about how its programs are built,
kept in the map so it builds the same on any computer: the memory for arrays that grow,
how deep a function may call itself, and whether a failing test stops the build.

### Beside the map

The TrigScript window covers the map. To keep the map in reach, open the script *beside
the map*: use the icon right of the tabs, or Triggers ▸ TrigScript beside the map. It is a
panel over the map that blocks nothing: drag it by its title, resize it by its corner, and
keep placing units while the code sits next to them.

![The script beside the map](images/trigscript-beside.webp)

Beside the map, the names in the code and the objects on the map know about each other:

- **Ctrl+click** on `locations.Beacon` scrolls the map to the location and flashes it.
  Hovering over the name says where it is and how big.
- **Pick from map** (the target icon, or a right-click in the code): click a location or a
  unit on the map, and its name (`locations.Beacon`, `units.TerranMarine`) is typed at the
  cursor. From the window, it first moves the editor beside the map.
- When you rename a location or a switch the script mentions, a notice offers to **Update
  references** in every file. It follows the name the way the code does (an alias from
  `import { locations as L }` counts) and leaves comments, strings and anything merely
  spelled the same alone.

### Applying the script

*Applying* the script runs it and puts the triggers it recorded into the map's trigger
list as one block. The block replaces the one from the last apply, or is added at the end
the first time. There is no step to remember: **saving the map applies the script**, and
so do Test Map and anything else that writes the map out.

- **Apply** (Ctrl+Shift+B) applies the script without saving, so you can look at the
  triggers in the Trigger Editor first. A click on the status bar's trigger count does the
  same.
- **Play** (F5) applies the script, builds the map as Save would, and hands it to [Test
  Map](guide.md#test-map) to start it in the game.
- **Output**, in the panel, keeps what each of them reported.

![The Trigger Editor on an applied script: the generated rows badged, and the way back to the line that made one](images/trigscript-triggers.webp)

The Trigger Editor shows the script's triggers with a `script` badge and does not let you
edit them. *Open TrigScript* there jumps to the file and line that made a trigger. The
Text Trigger Editor fences them in comments. Hand-made triggers around the block are left
alone, and a hand-made trigger inserted before the block just moves the block along.

If the script has an error when the map is saved, the map is saved anyway, with the
triggers from the last script that worked, and a notice names the file and the line.

### Triggers edited by hand

Editing one of the script's triggers outside the script makes the block *stale*. The
editor says so the next time the script opens: how many triggers are still the script's,
and how many were changed. While the block is stale, saving the map does not apply the
script, and the notice on Save says so. The notice offers two ways out:

- **Apply** replaces the unchanged triggers and keeps the edited ones as hand-made
  triggers right after the new block, so a wave system tuned in one trigger does not come
  back twice.
- **Append instead** leaves all of them as they are and adds a fresh block after them.

**Import the Map's Triggers** (under **…**) goes the other way: it rewrites the map's
hand-made triggers as `trigger()` calls, in their order, so a map made in the Trigger
Editor can carry on as a script.

### Saving and building

A script with programs is *built* when the map is saved, tested or exported: the eudplib
plugin turns the programs into the file being written. The first time, eudplib asks to
download its runtime, about 15 MB, once; the desktop app and the container image already
have it. A notice shows while the build runs, which takes a few seconds, and its **Save
without it** button saves at once without the programs.

The file you get is the one to play and to share. It also holds the map as you see it in
the editor, which is what comes back when you open it again, so the trigger list never
fills up with what the build generated.

The script's files and a record of the last apply live in the map archive under
`trigscript\` (`main.ts`, any other files, and `build.json`), so they travel with the
`.scx`. The [Save dialog](guide.md#saving) lists them with the archive's other files, each
with a tick, so a copy for release can leave the source out. The triggers stay either way.

## Reference

### Terms

| Term | Meaning |
| --- | --- |
| Frame | One step of the game. 24 a second at Fastest. |
| Pass | One time the game goes through the trigger list: every 31 frames, every 2 with hyper triggers, every frame in a map with a program. |
| Game second | 16 frames, at every game speed. What Elapsed Time and the countdown timer count. |
| Wait slot | Each player has one. A Wait takes it, and the player's other Waits wait for it. |
| Apply | Run the script and put its triggers into the map's trigger list. |
| Block | The run of triggers in the list that the script made. |
| Build | Turn the programs into the saved map. Only a script with programs is built. |
| Per-player program | A program owned by several players, run for each with its own variables. |

### Triggers

| | |
| --- | --- |
| `trigger(players, conditions, actions, options?)` | One trigger. `players` is a player or a list; up to 16 conditions and 64 actions. |
| `{ preserve, disabled, ignoreGameEnd, ignoreDisplay, conditionsMet, paused, waitSkipDisabled, flags }` | The options: each trigger flag by name, and `flags` for raw bits. |
| `preserve()` | The same as `{ preserve: true }`, as an action. |
| `not(condition)` | The opposite condition. "Exactly n" has none, and is an error. |
| `disabled(item)` | The condition or action kept in the trigger but switched off. |
| `hyperTriggers(owner?)` | The three triggers that make the list run every 2 frames. |
| `condition(type, …)`, `action(type, …)` | A record by raw type number, for anything the tables do not know. |
| `memory(address, comparison, value)`, `setMemory(address, modifier, value)` | EUD: a value in the game's memory, through the deaths table. |

`not()` flips a comparison or a switch test, and turns `always()` into `never()`.

### Argument words

StarEdit's labels work too.

| Argument | Words |
| --- | --- |
| Comparison | `">="`, `"<="`, `"=="` |
| Modifier | `"set"`, `"add"`, `"subtract"` |
| Switch state | `"set"`, `"cleared"` |
| Switch action | `"set"`, `"clear"`, `"toggle"`, `"randomize"` |
| Resource | `"ore"`, `"gas"`, `"oreAndGas"` |
| Score | `"total"`, `"units"`, `"buildings"`, `"unitsAndBuildings"`, `"kills"`, `"razings"`, `"killsAndRazings"`, `"custom"` |
| Order | `"move"`, `"patrol"`, `"attack"` |
| Alliance | `"enemy"`, `"ally"`, `"alliedVictory"` |
| Unit state (doodads, invincibility) | `"enable"`, `"disable"`, `"toggle"` |
| Count | A number, or `"All"` |

`displayText(text)` always displays; `displayText(text, false)` follows the player's
subtitle setting.

### Names

| | |
| --- | --- |
| `P1` … `P12`, `CurrentPlayer`, `AllPlayers` | Constants. |
| `players.` | Every player group: `Force1` … `Force4` (and the force's own name), `Foes`, `Allies`, `Neutral`, `NonAlliedVictory`, and the twelve players. |
| `units.` | Every unit type by name as an identifier (`TerranMarine`) or a string (`units["Terran Marine"]`), and by the map's custom names. `AnyUnit`, `Men`, `Buildings`, `Factories`. |
| `locations.` | The map's locations by name; `Anywhere` and `NoLocation`. |
| `switches.` | `Switch1` … `Switch256`, and any name the map sets. |
| `aiScripts.` | The AI scripts by StarEdit name; a four-letter code as a string works too. |
| `weapons.`, `upgrades.`, `techs.` | The game's weapons, upgrades and technologies, for `stats()`. |
| `colors.` | The player colours. |
| A number | Accepted wherever a name is: an EUD player, an unlisted unit id. |

### Inside a program

| | |
| --- | --- |
| `program(body, options?)` | Code that runs in the game. Options: `owner` (a player, `AllPlayers`, a force or a list) and `name`. |
| `game(fn)` | A function that runs in the game, for programs to call. It can live in any file and be imported. |
| `let n = 0`, `let f = false`, `let s = ""`, `let u: Unit \| null = null`, `let p = { … }` | A number, a boolean, a text, a unit, a record. |
| `u8`, `u16`, `u32` | Number types that are never below zero. See [Variables and numbers](#variables-and-numbers). |
| `u32(x)`, `i32(x)` | The same 32 bits read the other way, where a `u32` meets a plain number. |
| `number[]`, `string[]`, `Unit[]`, `{ … }[]`, `number[][]` | Arrays. One that is pushed to grows. |
| `forEach`, `some`, `every`, `find`, `findIndex`, `reduce`, `map`, `filter`, `sort`, `reverse` | Array methods that take a function, on arrays and on units (`unitsOf(P1).filter(…)`). |
| `slice`, `concat`, `toSorted`, `toReversed`, `Array.from`, `[...xs]` | Copies. |
| `class`, `new`, `extends`, `get` / `set`, `static` | Classes, declared inside the program. |
| `Record<K, V>`, `Map<K, V>`, `Set<K>` | Tables keyed by an id of the game (`UnitType`, `Player`, `Location`, …). |
| `Map<number, V>`, `Set<number>`, `Map<Unit, V>`, `Set<Unit>` | Tables over any number, or over units. |
| `shared(value)` | In a per-player program, one value for all the players. |
| `sleep(duration)` | Pause the program. `frames(n)`, `seconds(n)`, `minutes(n)` make a duration. |
| `wait(ms)` | The game's own Wait, which uses the player's wait slot. Prefer `sleep`. |
| `rose(condition)`, `once(condition)` | True on the frame the condition becomes true; true the first time only. |
| `random()`, `random(n)` | A coin toss; a whole number from 0 to n − 1. |
| `deaths(p, unit)`, `bring(p, unit, location)`, `score(p, kind)`, … | A comparing condition without its comparison and amount reads the number. |
| `minerals(p)`, `gas(p)`, `resources(p, kind)`, `countUnits(p, unit, location?)`, `kills(p, unit)`, `countdown()`, `elapsed()` | Reads by plainer names. |
| `race(p)`, `slot(p)`, `isHuman(p)`, `hasLeft(p)`, `supply(p, of?)` | The player. |
| `unitsAt(location, filter?)`, `unitsOf(player, filter?)`, `allUnits(filter?)` | The units a `for…of` runs over. |
| `first(filter?)`, `nearest(type, location, filter?)`, `randomUnit(filter?)` | One unit, or `null`. |
| `u.hp`, `u.shields`, `u.energy`, `u.kills`, `u.cooldown`, `u.resources`, `u.stim` …, `u.invincible` | Read and written. `u.hp = 0` kills. |
| `u.maxHp`, `u.maxShields`, `u.owner`, `u.type`, `u.x`, `u.y`, `u.orderId`, `u.burrowed`, `u.cloaked`, `u.hallucinated`, `u.underAttack` | Read only. |
| `u.order(kind, location)`, `u.give(player)`, `u.kill()`, `u.remove()`, `u.damage(n)`, `u.heal(n)`, `u.locate(location)` | What a unit can be told. `damage` and `heal` also take `{ percent }`. |
| `stats(unitType)`, `stats(weapon)`, `stats(upgrade)`, `stats(tech)`, `stats(player)` | The game's tables. |
| `keyPressed(p, key)`, `clicked(p, button?)` | True on the frame a press arrives. |
| `mouse(p)`, `underMouse(p, filter?)`, `centerLocation(location, x, y)` | The cursor's place on the map; the unit nearest it, or `null`; a location moved onto a point. |
| `chatted(p, pattern)` | `null`, or the values read out of a typed line. |
| `` displayText(`… ${n} …`) ``, `name(p)`, `color(p)` | A text with numbers, a player's name and colour in it, for the current player. |
| `print(text, { to?, position? })` | The same for others, in the `"chat"` area or on the `"center"` line. |
| `clamp(x, lo, hi)`, `Math.min`, `Math.max`, `Math.abs`, the bitwise operators | Work on variables. |

Keys for `keyPressed` are letters, digits, `"F1"` … `"F12"` except `"F6"`, `"Space"`,
`"Enter"`, `"Escape"`, the arrows and the rest of the list the editor offers. Buttons are
`"left"`, `"right"` and `"middle"`. `underMouse` looks within 48 pixels of the cursor, or
the filter's `within`. `Math.floor` and the other rounding functions are accepted around a
division and change nothing, since division is already whole.

### TrigScript beside TypeScript

Outside `program()` the script is all of TypeScript: it runs when it is applied, with the
whole language and its standard library. Inside a program, what is written has to become
something the game can do. Most of the language works as in TypeScript: types and
annotations, `let` and `const`, the operators, `if`, `while`, `for`, `switch`, functions
with default and rest parameters, classes, destructuring and spread, and `import` between
the script's files.

These differ:

- **Numbers** are whole numbers of 32 bits, with no fractions, `NaN` or `bigint`. `/` is
  whole division.
- **`==` and `===`** are the same thing, since nothing is converted.
- **`null`** belongs to units only. A number, a boolean or a text is never `null` or
  `undefined`, so where JavaScript would give `undefined` (`pop()`, `find()`, `get()`),
  say what it is then: `xs.pop() ?? 0`.
- **A loop** runs all its rounds within one frame, so a loop that never ends must
  `sleep()` on every path, including a `while (true)` that is only left by a `break`.
- **An arrow function** sees every variable in reach, but it is written only where a
  method takes it, as in `xs.map((x) => x + bonus)`.
- **A function declared inside another** sees the program's variables, not the outer
  function's.
- **An object literal** is a record with a fixed shape.
- **`print()`** stands in for `console.log`, and `random(n)` for `Math.random()`.

Everything else that is not there is refused with a message as you type, never passed over
in silence:

| Not there | Write instead |
| --- | --- |
| Fractions, `**`, `Math.sqrt` and the rest of `Math` on a variable | Work in smaller units (pixels, frames, hundredths), or look the value up in a list the script worked out |
| A variable with no first value (`let n;`) | `let n = 0` |
| `\|\|=` and `&&=` | `flag = flag \|\| other` |
| Optional fields and parameters (`y?: number`) | A default: `y = 1` |
| A function kept in a variable, an array, a field or a return value | `function f() { … }`, or the arrow where the method takes it |
| A function that returns a record or an array it made | Hand it the record or array to fill in; an instance of a class is the exception |
| A function that calls itself and sleeps | Sleep outside it |
| A function more than 1 024 calls deep | Raise the limit in the Settings view, or loop instead |
| A `for` written out more than 256 times | A `while` loop |
| `try`, `catch`, `throw` | Return a number that says what happened |
| `async`, `await`, generators, timers | `sleep()`, and another `program()` for another clock |
| `for…in`, labels, `typeof`, `in`, `delete` | — |
| `p[key]` with a key that varies, `Object.keys`, methods on a literal | An array, or a class |
| On an array: `shift`, `unshift`, `splice`, `at`, `flat`, `lastIndexOf`, `join` of numbers | `push` and `pop`, `xs[xs.length - 1]`, a template in a loop |
| `map` into texts or records | `push` in a `for…of` |
| `const b = a` as a second name for an array | Use `a` |
| On a text: `split`, `replace`, `trim`, `toUpperCase`, `lastIndexOf`, `parseInt`, regular expressions | Keep the number beside the text you made from it |
| A boolean in a text (`${alive}`) | `${alive ? "yes" : "no"}` |
| A `Map` with texts or records as values, or texts as keys | The place of a row of an array of records |
| An array of instances of different classes, a class written as a value, a class with type parameters, decorators | One class per array |
| An `enum` declared inside the program | Declare it above the program |
| `JSON`, `Date`, `Object.*` | — |
| A key held down | `keyPressed`, which is true once per press |
| Writing a unit's position, cloaking it, or one unit's speed | `order()` or the Move Unit action; `stats(type).speed` for a whole type |
| Playing on the classic game | `trigger()` only |

The language, its compiler and the commands it offers other plugins are described in full
in the plugin's own README at
[scm-js/plugin-trigscript](https://github.com/scm-js/plugin-trigscript).

## Troubleshooting

**The TrigScript window stays on "Loading the editor…".** The first time it opens, it
downloads the code editor and TypeScript from jsDelivr, so it needs an internet connection
once. After that the browser keeps them.

**The status bar shows a red problem count.** Click it to open **Problems**, and click a
problem to go to its line. While the script has an error, saving still works: the map
keeps the triggers from the last script that worked, and a notice names the file and line.

**The status bar says "Not applied yet" or "Changes not applied".** The script's triggers
in the map are older than the script. Saving or testing the map applies it, or press
**Apply** (Ctrl+Shift+B).

**The status bar says "Triggers edited outside the script".** Someone edited the script's
triggers in the Trigger Editor or the Text Trigger Editor, and saving does not apply the
script until that is settled. Click the item and choose **Apply** or **Append instead**;
see [Triggers edited by hand](#triggers-edited-by-hand).

**A notice says the map renamed something the script names.** A location or switch was
renamed on the map. **Update references** changes the script to match.

**The programs are not built.** Look at the status bar of the TrigScript window:

- *eudplib plugin not running*: turn the eudplib plugin on in Plugins ▸ Manage Plugins….
- *runtime downloads on the first save*: the next save asks to download eudplib's runtime
  (about 15 MB). If you cancel, nothing is built, and the next save asks again. Edit ▸
  Preferences ▸ Plugins ▸ eudplib installs and removes the runtime. Without a connection,
  a browser cannot download it; the desktop app has it built in.
- *Build failed* or *Saved without its programs*: the map was saved with the script in it,
  but its programs do not run in the game. **Show the log** on the notice, or the
  **Output** panel, says why. Fix the error and save again.

**A map with a program does not start in the game.** Programs need StarCraft: Remastered.
For the classic game (1.16.1), use only `trigger()`.

**Nothing happens in the game.** Check that the game type is *Use Map Settings*: melee
games ignore the map's triggers. Check that the trigger's players are in the game, and see
the [trigger reference](triggers.md#who-a-trigger-runs-for) for owners the game never
runs. The Trigger Map plugin shows which triggers can never run.

**A typed line does nothing.** A single-player game has no chat. Host a multiplayer game,
alone if you like.

**Simulate or a test never sees an enemy die.** The simulator does not fight. In a test,
kill the units with `sim.kill(unit)`.

**A test fails with "still not true after 2400 frames".** The condition given to
`sim.until()` never became true. Give `until` a larger limit as its second argument, or
check the script with Simulate.
