# The TrigScript language

This is the language of a TrigScript program: what the code inside `program(() => { … })`
can say, and what it does in the game. Start with the [TrigScript guide](trigscript.md) if
you have not written a script yet. It has the quick start, `trigger()`, the workspace and
testing. Come here when a program needs something the guide only mentions, or when you
know TypeScript and want to know where a program is different.

A script has two halves. Outside `program()`, the script *is* TypeScript: it runs when the
script is applied, with all of the language and its standard library, and what it records
is ordinary triggers. Inside `program()`, every line has to become something the game can
do while the map is played. Most of TypeScript comes through unchanged. These pages say
what each part does, and what to write instead of the few parts that are not there.

| Page | What is on it |
| --- | --- |
| [TrigScript beside TypeScript](#trigscript-beside-typescript) | The whole comparison in one table |
| [The script and the program](#the-script-and-the-program) | What is worked out when the script is applied, and what runs in the game |
| [Variables and numbers](#variables-and-numbers) | Numbers, booleans, records, `undefined`; `u8`, `u16`, `u32`; fractions and `Math` |
| [Arrays](#arrays) | Fixed and growing arrays; arrays of records, units, texts and arrays; the methods; patterns and spread |
| [Tables, maps and sets](#tables-maps-and-sets) | Lists the script made, tables keyed by an id of the game, `Map` and `Set` |
| [Control flow](#control-flow) | Loops within the frame, unrolled loops, labels, `switch` |
| [Functions](#functions) | Inlined and called functions, functions that call themselves, `game()`, functions as values and closures |
| [Classes](#classes) | Fields, methods, `extends`, and how an instance is kept |
| [Errors](#errors) | `try`, `catch`, `finally`, `throw` and classes of error |
| [Waiting and tasks](#waiting-and-tasks) | `sleep`, `async` and `await`, tasks, `Promise.all` and `race`, generators, edges |
| [Owners and per-player programs](#owners-and-per-player-programs) | One program for every player, and `shared()` |
| [Reading the game](#reading-the-game) | Every condition's quantity as a number; facts about the players |
| [Units](#units) | Loops over units, picks, a unit's fields and what it can be told |
| [Events](#events) | `on.created`, `on.died`, `on.killed`, `on.morphed`, `on.order` |
| [The game's tables and memory](#the-games-tables-and-memory) | `stats()` for costs, weapons, upgrades and colours; `memory` |
| [Keys, the mouse and chat](#keys-the-mouse-and-chat) | Presses, clicks, the cursor, typed lines; `local` and `sync()` |
| [Text](#text) | Texts with values, `string` variables and their methods, lines of JSX |
| [Sounds and imported files](#sounds-and-imported-files) | Clips made when the script is built; videos, pictures, sounds and MIDI the script imports |
| [Libraries](#libraries) | The standard library's nine modules, and libraries other plugins provide |
| [What a program does not have](#what-a-program-does-not-have) | What is refused, and what to write instead |

Every example on these pages compiles as it is written. A line that ends with a comment
such as `// 80` prints that when the example runs. Examples that name locations assume the
map has them: `Beacon`, `Spawn`, `Base`, `Pen`, `Gate`, `Exit` and `Cursor`.

## TrigScript beside TypeScript

The table is about the inside of a program. **Same** means it is written and behaves as in
TypeScript. Where it differs, the table says how. Anything that is missing is refused with
a message as you type, never passed over in silence.

| TypeScript | In a program | What is different |
| --- | --- | --- |
| Types: annotations, `interface`, `type`, unions of literals, tuples, generics, `as`, `!`, `satisfies` | Same | Erased, as in TypeScript. Some also decide things: `u8`, `u16` and `u32` are widths, `fixed` is a number with a fraction, and `Map<UnitType, V>` is kept differently from `Map<number, V>`. |
| `let`, `const`, `var` | Same | A variable needs a first value (`let n = 0`). A `const` whose value the script already knows is worked out when the script is applied and costs the map nothing. |
| `number` | Different | A whole number of 32 bits, signed, that wraps at its ends as `x \| 0` does. It holds a fraction once one is stored into it. No `NaN`, `Infinity` or `bigint`. `/` of whole numbers is whole division, and dividing by 0 gives 0. |
| `boolean` | Same | Assigned with `=` only: no `\|\|=` or `&&=`. |
| `string` | Mostly | `length`, `s[i]` and `slice` count characters, where JavaScript counts UTF-16 units; they differ only past U+FFFF. A made text holds 1 023 bytes. `replace` and `split` take a text, not a regular expression. |
| `null`, `undefined` | Mostly | A unit or an instance may be none (`if (u)`, `u?.kill()`). A number or a boolean may be `undefined` where TypeScript says so, as what `find` gives when nothing fits, and `??`, `!== undefined` and `!` read it. |
| Operators | Same | `==` and `===` are one thing, since nothing is converted. A shift by 32 or more leaves nothing. `**` wants a power known when the script is built. Missing: `delete`. |
| `if`, `while`, `do`, `for`, `for…of`, `switch`, `break`, `continue`, labels | Same | A loop runs all its rounds within one frame, so one that never ends must `sleep()` on every path. A `for` over bounds the script knows is written out round by round. No `for…in`. |
| Functions: parameters, defaults, optional and rest parameters, recursion, generics | Same | The compiler writes a function out where it is used or calls it; the meaning is the same. One that calls itself cannot wait, and has a depth limit. |
| Arrow functions, closures, functions as values | Mostly | A function can be kept in a variable, an array, a field or a `Map`, and returned. An `async` function or a generator is not kept as a value. |
| Object literals | Records | A variable per field: nested, passed by reference, spread, taken apart by patterns. No methods or getters on a literal; a class has them. |
| Destructuring and spread | Same | `f(...xs)` wants a length the script knows, as TypeScript itself does. |
| Arrays | Mostly | Fixed or growing, of numbers, booleans, texts, units, records, instances, functions and arrays, with nearly all their methods. Missing: `flat`, and `map` into texts or records. An index past the end reads 0. `const b = a` copies the array. |
| Classes: fields, constructors, methods, `get` / `set`, `static`, `private` / `#x`, `readonly`, `extends`, `super`, `abstract`, `implements`, `instanceof`, type parameters | Same | Declared in the program or at the top of any file. No static blocks. |
| `Map`, `Set` | Mostly | Keys are numbers, units, ids of the game, or a few texts the script knows. Values are numbers, booleans or instances. |
| `enum`, `const enum`, `namespace` | Same | Their members are constants known when the script is built. |
| `try` / `catch` / `finally` / `throw` | Mostly | `throw` takes an `Error` or a class that extends one. An error nothing catches is shown in the game in red, and the program stops. |
| `async` / `await`, promises, generators | Mostly | `await` of `sleep()`, `until()`, an async call, a task, `Promise.all`, `race` and `any`; `function*` and `for await`. A race's losers stop where they are. No `setTimeout`: the timers library has `after` and `every`. |
| Modules | Same | `import` between the script's files, from `"trigscript"`, from the standard library and from other plugins' libraries, and of videos, pictures, sounds and MIDI the script imported. Nothing from npm. |
| The standard library | Some | Most of `Math`, `String(n)`, `parseInt`, `Array.from`. `print()` for `console.log`, `random(n)` for `Math.random()`. No `JSON`, `Date` or `RegExp`. |
| — | Added | What TypeScript has no word for: `sleep`, `rose` and `once`; reads of the game; units and loops over them; events; `stats()` and `memory`; keys, the mouse and chat; per-player programs. |

## The script and the program

A program sits inside a script, and the two run at different times. The script runs once,
in the editor, when it is applied. The program runs in the game. **Everything the program
reads from outside its body, with nothing of the program in it, is worked out when the
script is applied**: a constant, a helper called with known values, a condition, an
action. The editor underlines those parts with dots, so you can see the line between the
two halves as you type, and hovering a variable says which half it belongs to.

```ts
const spawnAt = locations.Spawn;
function burst(n: number) {
  return [createUnit(P2, units.ZergZergling, n, spawnAt), displayText(`Wave of ${n}`)];
}

program(() => {
  let wave = 0;
  while (wave < 10) {
    burst(4);
    wave += 1;
    sleep(seconds(20));
  }
});
```

`burst` is ordinary TypeScript. It runs when the script is applied and returns two
actions, and the program runs those actions in the game. A helper that throws while the
script is applied is reported at the line that called it.

**A `const` is what it can be.** `const limit = waves.length` is worked out when the
script is applied. `const next = wave + 1` needs a variable of the program, so it is one,
which TypeScript keeps you from assigning again. A constant inside a branch that is never
built, such as `if (false) …`, is never worked out at all.

**The one rule to keep in mind**: the player and the location of an action, and the amount
a condition compares with, are known when the script is applied. A variable of the program
cannot reach them. A parameter of a function given a known value does reach them, so
`function spawn(p: Player, n: number) { createUnit(p, units.ZergZergling, n, spawnAt); }`
works with `spawn(P2, 4)`.

These parts of an action can follow a variable:

- the amount of `setResources`, `setDeaths`, `setScore` and `setCountdownTimer`;
- the count of `createUnit`, `killUnitAt`, `removeUnitAt` and `giveUnits`;
- an action's unit type;
- the text of `displayText` and `print`, the objectives, a leaderboard's label, a
  transmission and a unit type's name.

To compare a condition's amount with a variable, read the quantity and compare it
yourself: `minerals(P1) >= price` ([Reading the game](#reading-the-game)).

## Variables and numbers

### Variables and records

Variables hold numbers, booleans, texts, units and players.
`let p = { lives: 3, gold: 0, alive: true }` is a **record**: a variable per field
(`p.lives -= 1`, `if (p.alive)`), nested records included. A declared type
(`let p: { n: u8 } = { n: 0 }`, an `interface`, a `type`) is honoured. A record handed to
a function reaches it by reference, and `p = { lives: 3, gold: 0, alive: true }` sets
every field at once. Variables live in the game's memory while the map is played. They
take nothing from the map: no death counters, no switches, no triggers in the list.

A number or a boolean may be `undefined` where TypeScript says so: what `find` gives when
nothing fits, an optional parameter left out, `let n: number | undefined`. `??`,
`!== undefined` and `!` read it. A player in a variable can be changed and compared, but
the player of an action is still one the script knows.

```ts
program(() => {
  const hp = [30, 80, 55];
  const strong = hp.find((h) => h > 50);        // a number, or undefined
  if (strong !== undefined) print(`${strong}`); // 80
  let leader: Player = P1;
  if (hp[0] < 50) leader = P2;
  if (leader == P2) print("Player 2 leads");    // Player 2 leads
});
```

### Whole numbers

A `number` is whole unless a fraction is stored into it. A whole `number` is TypeScript's
as far as 32 bits go: signed, from −2 147 483 648 to 2 147 483 647. `a - b` is below zero
when `b` is larger, `Math.abs`, `Math.min`, `Math.max` and `clamp(x, lo, hi)` mean what
they say, and a number below zero is printed with its minus sign. The one difference is at
the ends: a `number` wraps there, as `x | 0` does, where TypeScript's would go on.

Three more types hold a number that is never below zero:

| Type | Holds | At its ends |
| --- | --- | --- |
| `number` | −2 147 483 648 … 2 147 483 647 | wraps, as `x \| 0` |
| `u32` | 0 … 4 294 967 295 | wraps, as `x >>> 0` |
| `u16` | 0 … 65 535 | stops: below zero is 0, above is 65 535 |
| `u8` | 0 … 255 | stops: below zero is 0, above is 255 |

`let lives: u8 = 3` stops at its ends after the whole sum, never between its parts, which
is what lives and cooldowns want. A `u32` is for bit masks, hashes and counts past two
thousand million. Everything the game is asked (`minerals()`, `deaths()`, `u.hp`) is a
`number`. A constant its variable cannot hold is an error: `let mask = 0xffffffff` wants
`let mask: u32`.

**A `number` and a `u32` do not mix in arithmetic** without saying which is meant. `h + n`
is an error that names the two ways out, `u32(n)` and `i32(h)`, which read the same 32
bits the other way and cost nothing. A constant that fits is either, so `h * 31 + 7` needs
nothing. A comparison between the two is exact.

**Where the game takes nothing below zero** (a `u8` or `u16`, a unit's hit points, an
action's amount or count, `random(n)`'s bound, a place on the map), a number below zero
goes in as 0. `u.hp -= 1000` kills, and `createUnit(p, unit, n, at)` with `n` at −3 makes
none.

**Arithmetic.** `+ − * / %` between variables and constants, the compound assignments,
`++` and `--`, and the bitwise `& | ^ ~ << >> >>>` over the 32 bits. `>>` keeps the sign
of a `number` and `>>>` never does, as in JavaScript. `/` of two whole numbers rounds
towards zero (`-7 / 2` is −3), and `%` takes the sign of what is divided (`-7 % 2` is −1).
`Math.floor` and the other rounding functions around a whole division change nothing.
Dividing by a variable that is 0 in the game gives 0; dividing by a constant 0 is an
error. `a ** 2` and `Math.pow(a, 3)` take a power known when the script is built, and
`Math.sign(n)` and `Math.log2(n)` (rounded down) work on whole numbers.

### Numbers with a fraction

**A number holds a fraction once one is stored into it**: `let speed = 1.5`, `x += 0.25`,
`const d = Math.cos(a)`. It is then a `fixed` number, with about four decimal places, from
about −32 768 to 32 767. `fixed(n)` makes a whole number one, and a parameter or variable
typed `fixed` is one from the start. `u8`, `u16` and `u32` stay whole, and a fraction
stored into one is an error.

- Whole numbers still divide as whole numbers: `7 / 2` is 3, and `7 / fixed(2)` is 3.5.
- Where only a whole number goes (an index, a count, a place, a unit's field), a fixed
  number is an error that names `Math.floor`, `Math.round` and `Math.trunc`. `x | 0` is
  `Math.trunc(x)`.
- `Math.sqrt`, `Math.hypot`, `Math.sin`, `Math.cos`, `Math.tan`, `Math.atan` and
  `Math.atan2` give fixed numbers. Angles are radians, as in JavaScript. The build adds
  the tables `sin`, `cos` and `atan2` read to the map.
- A fixed number in a text is printed as a decimal of up to four places.

```ts
program(() => {
  let speed = 1.5;                              // a fraction stored into it: a fixed number
  speed += 0.25;
  const across = Math.hypot(30, 40);
  const half = 7 / fixed(2);                    // 7 / 2 alone is 3, as whole numbers divide
  print(`${speed} ${across} ${half} ${Math.floor(speed * 10)}`);   // 1.75 50 3.5 17
});
```

`trigscript/math` adds `lerp`, easing curves, `distance`, `angleTo` and `Vec`, a point of
two fixed numbers ([Math](trigscript-library.md#math)).

## Arrays

Arrays hold numbers, booleans, texts, units, records, instances of a class, functions or
other arrays. `let hp = [10, 20, 30]`, `let xs = [a, a * 2, 0]`,
`let lives: u8[] = new Array(12).fill(3)`. An index is a constant or a variable
(`hp[i] += 7`). `.length`, `for (const x of xs)` with `break` and `continue`, `fill`,
`includes`, `indexOf` and `lastIndexOf` (−1 when there is none), `at(i)` (from the end
when `i` is below zero) and `join(", ")` all run within the frame. Cells keep their type:
a `u8[]` stops at both ends. An array handed to a function is the same array.

Two things are not JavaScript's:

- **An index past the end reads 0 and stores nothing.** A constant index past the end is
  an error. A variable one is passed over in the game without a word, and Simulate says
  where it happened, since it is always a mistake.
- **`const b = a` is a copy**, where JavaScript would give the same array a second name.

In a program of every player, each player has their own copy of an array;
`shared([0, 0, 0])` is one for everybody.

### Arrays that grow

**An array that something pushes to grows**, with no size to declare.
`const queue: number[] = []`, `queue.push(x)`, `queue.pop()`, `queue.length = 0`,
`shift()`, `unshift(v)` and `splice(i, n, …)` all work. `pop()` of an empty array is 0
here, where TypeScript says `undefined`, so write `?? 0` or `!` after it. An empty array
wants its type said: `let xs: number[] = []`.

```ts
program(() => {
  const hp = [10, 20, 30];                  // three cells, for good
  const queue: number[] = [];               // starts empty and grows as it is pushed to
  let total = 0;
  for (const h of hp) total += h;
  for (let i = 0; i < hp.length; i++) if (hp[i] > 15) queue.push(i);
  while (queue.length > 0) {
    const i = queue.pop()!;
    hp[i] -= 5;
    print(`cell ${i} is now ${hp[i]} of ${total}`);
  }
});
```

```ts
program(() => {
  const queue = [5, 6, 7];
  queue.unshift(4);
  const head = queue.shift() ?? 0;
  queue.splice(1, 1, 60, 61);
  print(`${head} ${queue.join(",")} ${queue.at(-1) ?? 0} ${queue.lastIndexOf(61)}`);   // 4 5,60,61,7 7 2
});
```

The cells of every growing array come from one pool that the map's programs share: 16 384
cells, unless the workspace's **Settings** view (Ctrl+,) says otherwise. An array that
fills its block is moved to one twice the size, and a block given back serves the next
array that wants that size. An array declared again, in a loop or in a function called
again, first gives back the block it held, so a scratch array made every round holds one
block at a time. A single array can reach between a quarter and a half of the pool. When
the pool has no block left, nothing more is pushed and the game says so once, in red.
Simulate counts blocks as the game does, so it runs out at the same push.

### Arrays of records, units and texts

**An array of records** is an array per field, all growing together:
`let waves = [{ count: 4, delay: 2 }]`, `waves[i].count += 1`,
`waves.push({ count: 6, delay: 1 })`. A record taken out of one (`const w = waves[i]`, the
variable of a `for…of`, a record handed to a function) is the array's own, as an object in
a TypeScript array is a reference: `w.delay = 9` writes the array. A field is a number, a
boolean, a unit, a text, an array of numbers, booleans or units, or a record of the same:
`squads[i].seen.push(4)`, `squads[i].name += "!"`. The hint at the end of the line says
how many cells a row comes to.

**An array of units** keeps the units themselves: `const squad: Unit[] = []`,
`squad.push(u)`, `squad[i].hp = 10`, `squad.pop()?.kill()`. Unlike a loop over the game's
units, it may be kept across a `sleep()`. A unit in it that has died since reads 0, takes
no order, and is false in an `if`.

**An array of texts** is `const names: string[] = []`, with `push`, `pop()` (`?? ""`),
`names[i]` read, written and added to, `length`, `for…of`, `forEach`, `includes`,
`indexOf` and `join`.

```ts
program(() => {
  const log: string[] = [];
  let wave = 3;
  log.push(`wave ${wave} began`);
  log.push("boss down");
  print(log.join(" / "));                   // wave 3 began / boss down
});
```

### The methods that take a function

`forEach`, `some`, `every`, `find`, `findLast`, `findIndex`, `findLastIndex`, `reduce`,
`map`, `filter`, `sort` and `reverse` work on every kind of array, and chains of them do
too. The function is written as in TypeScript and is handed the item, its place and the
array. An arrow written there is copied into the loop the method becomes, so it costs
nothing to write one, and it sees the program's variables.

```ts
program(() => {
  const scores = [12, 7, 30, 7];
  let bonus = 5;
  const raised = scores.map((s) => s + bonus);
  const best = raised.reduce((m, s) => Math.max(m, s), 0);
  const below = raised.filter((s) => s < best);
  below.sort((a, b) => b - a);
  print(`best ${best}, ${below.length} below it, the next is ${below[0]}`);   // best 35, 3 below it, the next is 17
});
```

- `map` makes an array of numbers or booleans. `filter` makes one that grows, of whatever
  it ran over: records stay whole, units stay units. Neither can stand in a loop's
  condition, which is worked out again every round: make the array before the loop.
- `find` gives a unit or `null` from an array of units, and a number or `undefined` from
  an array of numbers. For records, take the place with `findIndex` and read `waves[i]`.
- `reduce` wants the value it starts from.
- `sort` wants its function: without one, JavaScript sorts numbers as text, 10 before 9.
  It sorts in place, within the frame, and keeps equal items in order. Dozens of items
  cost nothing. Hundreds every frame will be felt, and the line's hint says *sorts in the
  frame*.
- A function handed to a method cannot `sleep()`: the method is one loop within the frame.
  A `for…of` over the same array can sleep between its rounds.

The game's units take these methods too: `unitsOf(P1).forEach((u) => u.heal(10))`, `some`,
`every`, `reduce`, `map`, `find` and `filter`. `filter` is how to keep some of them, as an
array that can be sorted and kept across a `sleep()`:

```ts
program(() => {
  const squad = unitsOf(P1, { type: units.TerranMarine }).filter((u) => u.hp < 20);
  squad.sort((a, b) => a.hp - b.hp);
  for (const u of squad) { u.heal(10); sleep(frames(4)); }    // the weakest first, one every four frames
});
```

A list the script made takes them as well. With a variable of the program in the function,
`prices.map((p) => p + bonus)` is an array of the program. With nothing of the program in
it, `[1, 2, 3].map((x) => x * 2)` is the script's own arithmetic, done when the script is
built.

### Patterns and spread

Destructuring and spread are TypeScript's: `const { x, y } = mouse(P1)`,
`const [first, , third = 0, ...tail] = xs`, `for (const { count, delay } of waves)`, and
in a function's parameters. A name in a pattern holds a copy of a number, so changing `x`
does not change `p.x`. A record or an array inside what is taken apart stays itself.
Assigned, a pattern is a swap: `[a, b] = [b, a]`, `[hp[i], hp[j]] = [hp[j], hp[i]]`.
`[...xs, v]` and `{ ...p, y: 9 }` copy into a new array or record.
`function sum(...ns: number[])` takes the rest of a call's arguments as an array.

```ts
program(() => {
  const waves = [{ count: 4, delay: 2 }, { count: 6, delay: 1 }];
  let a = 1;
  let b = 2;
  [a, b] = [b, a];
  for (const { count, delay } of waves) print(`${count} every ${delay}`);
  const xs = [a, b, 3];
  const [head, ...rest] = xs;
  waves.push({ ...waves[0], count: 9 });
  print(`${head}, then ${rest.length} more; ${waves.length} waves`);   // 2, then 2 more; 3 waves
});
```

### Arrays inside arrays

`let grid = [[0, 0, 0], [0, 0, 0]]`,
`new Array(8).fill(0).map(() => new Array(8).fill(0))` or
`Array.from({ length: h }, () => …)` make a grid: `grid[y][x] += 1`, `grid[y].length`,
`for (const row of grid)`. A row is an array like any other, and `const row = grid[y]` is
the grid's own cells, as in TypeScript. An array inside a record works the same way:
`p.path[i]`, `p.seen.push(v)`.

The compiler chooses how to keep it, and the line's hint says which:

- **Every row the same length, and no row growing**, is one flat array, no slower to read
  than a plain one. A row past its own end reads 0 and never reaches into the next row.
  The outer array may still grow by whole rows.
- **Rows of different lengths, or a row something pushes to** (`buckets[i].push(v)`), are
  rows that grow, each a block of the pool. A row that goes gives its block back, so
  nothing leaks. Two levels deep; not three.

One thing is not JavaScript's: a row of rows that grow, kept in a `const`, is that *place*
in the outer array, not the array that was there. After
`const last = buckets[2]; buckets.pop(); buckets.push([7])`, `last` reads `[7]`. And
`filter` of rows gives copies, so a change through the rows it made does not reach the
rows it took them from.

### Copies

`xs.slice(1)`, `xs.concat(ys, 7)`, `xs.toSorted(f)`, `xs.toReversed()` and
`Array.from(xs)` give a new array that grows. `[...m.keys()]` and `[...set]` give a
`Map`'s or a `Set`'s as one. `f(...xs)` spreads an array into a call when the script knows
how many there are: a list it has, or a tuple
(`let box: [number, number, number] = [1, 1, 1]`).

## Tables, maps and sets

### Lists the script made

**A list the script made is a table a program can look things up in.**
`const price = [50, 100, 150]` above the program and `price[level]` inside it is in the
map once, however often it is read, and cannot be written. A list of records is a table
per field, which is how a wave table works:

```ts
const waves = [
  { unit: units.ZergZergling, count: 4 },
  { unit: units.ZergHydralisk, count: 3 },
];

program(() => {
  let wave = 0;
  while (wave < waves.length) {
    createUnit(P2, waves[wave].unit, waves[wave].count, locations.Spawn);
    wave += 1;
    sleep(seconds(30));
  }
});
```

### Tables keyed by an id of the game

A table keyed by a unit type, a player, a location, a switch, a weapon, an upgrade or a
technology has a cell for every id, so looking up a key is one read:

```ts
const bounty: Record<UnitType, number> = { [units.ZergZergling]: 5, [units.ZergHydralisk]: 15 };

program(() => {
  const score: Record<Player, number> = { [P1]: 0 };
  const lost = new Map<UnitType, number>();
  const seen = new Set<UnitType>();
  for (const u of unitsOf(P2)) {
    if (u.hp < 10) {
      score[u.owner] += bounty[u.type];
      lost.set(u.type, (lost.get(u.type) ?? 0) + 1);
      seen.add(u.type);
      u.kill();
    }
  }
});
```

A `Record` is read and written by its keys and reads 0 where nothing was stored. A `Map`
has `get` (`?? d` for a key never set), `set`, `has`, `delete`, `clear` and `size`; a
`Set` has `add`, `has`, `delete`, `clear` and `size`. `for (const [key, value] of lost)`,
`lost.keys()` and `lost.values()` go through the keys that are there, in the order of the
ids. A table made inside the program can be written while the map is played. One made
outside it belongs to the script, and a program only reads it. A `Map` keyed by a few
texts the script knows, `new Map<"red" | "blue", number>()`, is kept the same way.

### A `Map` and a `Set` over any number

For keys that are no id of the game (a tile packed into one number, a score), use
`new Map<number, number>()`, `new Map<number, boolean>()` or `new Set<number>()`, empty or
with what they start with: `new Map([[1, 10], [k, 20]])`.

```ts
program(() => {
  const owner = new Map<number, number>();            // a tile, as x + y * 256, to who holds it
  const claimed = new Set<number>();
  for (const u of unitsOf(P1, { type: units.TerranMarine })) {
    const tile = (u.x >> 5) + (u.y >> 5) * 256;
    if (!claimed.has(tile)) { claimed.add(tile); owner.set(tile, 1); }
  }
  for (const [tile, who] of owner) if (who == 1) print(`tile ${tile % 256}, ${tile >> 8}`);
});
```

They go through their keys **in the order the keys went in**, as JavaScript's do: a key
set again stays where it was, and one deleted and set again goes to the end. Finding a key
takes a few steps, where a table keyed by ids of the game is one read, so when the keys
are ids of the game, say so (`Map<UnitType, number>`). The table lives in the pool the
growing arrays share: it starts at eight slots and doubles as it fills. Values are
numbers, booleans or instances of a class. For a text or a record, keep the place of a row
of an array of records.

### Keyed by units

`new Map<Unit, number>()` and `new Set<Unit>()` work the same way: a cooldown per unit, or
the units already dealt with. A unit made where a dead one was is *not* the dead one's
key. A unit that died stays an entry until it is deleted. In a loop over the table it
reads as no unit, which is the moment to delete it.

## Control flow

`if`/`else`, `while`, `do`, `for`, `switch`, `break`, `continue`, labels and `c ? a : b`
all work. `switch` over a number or a text tests its cases in order and falls through
without `break`, as in TypeScript. `&&`, `||` and `!` stop as soon as the answer is known.
A condition of the game goes wherever a boolean does:
`if (bring(P1, units.AnyUnit, locations.Beacon, ">=", 1) && !alarm)`. `random()` is a coin
toss and `random(n)` a whole number from 0 to n − 1. The game's own randomness seeds them,
so two games differ.

**A loop runs to the end within the frame.** `while (i < 10) { …; i++; }` does all ten
rounds at once. So a loop that never ends and never sleeps would never give the frame
back, and the game would freeze. The editor refuses such a loop and says where to put a
`sleep(frames(1))`, including a `while (true)` that is only left by a `break`.

A `for` whose start, bound and step are known when the script is applied, such as
`for (let i = 0; i < 3; i++)`, is **written out round by round**, with `i` a plain value
in each copy, so `createUnit(P2, unit, i + 1, at)` is an ordinary action. The line's hint
says *unrolled ×3*. A `for` over a variable bound is a loop in the game. One written out
more than 256 times is an error that says how to write it as a `while` instead.

A `for…of` over a list known when the script is applied is written out once per entry, so
a wave table is ordinary data:

```ts
const waves = [{ unit: units.ZergZergling, n: 6 }, { unit: units.ZergHydralisk, n: 4 }];
program(() => {
  for (const w of waves) {
    createUnit(P2, w.unit, w.n, locations.Spawn);
    sleep(seconds(20));
  }
  victory();
});
```

A label lets `break` and `continue` reach past the loop they are in:

```ts
program(() => {
  const hp = [40, 0, 25, 0, 60, 10];
  let row = 0;
  let found = -1;
  rows: while (row < 2) {
    let col = 0;
    while (col < 3) {
      if (hp[row * 3 + col] > 50) { found = row * 3 + col; break rows; }
      col += 1;
    }
    row += 1;
  }
  print(`${found}`);                            // 4
});
```

## Functions

Arguments pass by value, as in TypeScript. A function may return a number, a boolean, a
text, a unit, a record, a tuple or an array, and an instance under the rule in
[Classes](#classes). Parameters take defaults (`step = 1`) and may be optional
(`extra?: number`). Local variables start afresh at every call, and a function declared
inside another sees the outer one's parameters and locals.

```ts
function split(n: number) {
  return { big: n > 4, half: n >> 1 };
}
function around(n: number) {
  return [n - 1, n + 1] as const;
}
function advance(n: number, extra?: number) {
  return extra !== undefined ? n + extra : n + 1;
}

program(() => {
  let n = 7;
  const { big, half } = split(n);
  const [lo, hi] = around(n);
  print(`${big} ${half} ${lo}-${hi} ${advance(n)} ${advance(n, 10)}`);   // true 3 6-8 8 17
});
```

### Written out or called

A function used once is **written out** where the call stands. A function used more than
once is **called** when it can be: one copy of its body in the map, which keeps the map
smaller. The meaning is the same either way, and the hint at the end of the function's
line says which it got: *called ×3*, or *inlined ×3* with the reason when you hover it.
Three things keep a function written out:

- **It waits.** The program has to wake up inside it, which only a written-out body can
  do.
- **A parameter reaches something only a known value can fill.**
  `function pay(p: Player, n: number) { setResources(p, "add", n, "ore"); }` needs its
  player when the map is built, so `pay(P2, 4)` is written out. The amount could be a
  variable; the player cannot.
- **It uses `rose()` or `once()`**, which remember what they saw at each place they are
  written.

An array reaches a function as itself, and which array is settled when the script is
built. So a function that takes an array is one copy for each array it is passed:
`total(hp)` and `total(shields)` are two copies. The hint counts them: *called ×5, 2
copies*.

### A function that calls itself

A function may call itself, directly or through another: `fib(n - 1) + fib(n - 2)`, a
flood fill over a grid, two functions that call each other. Each run has its own
parameters and locals, as in TypeScript. Three things are different from a JavaScript
engine:

- **It cannot wait.** No `sleep()` or `await` inside it; the error says so.
- **It has a depth limit**: 1 024 calls deep, unless the workspace's **Settings** view
  says otherwise (16 to 65 536, kept in the map). A call past the limit is a `RangeError`
  that a `catch` can take. Uncaught, it stops the program, and the game says where: *stack
  overflow in fill, line 12*. Simulate stops at the same call.
- **It costs what it keeps.** Around each call, the function's variables are saved and
  restored. That is nothing for a flood fill a thousand deep, and a visible pause for tens
  of thousands of calls in one frame. The fewer variables, the cheaper the call.

```ts
program(() => {
  const grid = [
    [0, 0, 1, 0],
    [0, 1, 1, 0],
    [0, 0, 0, 0],
  ];
  function fill(x: number, y: number): number {
    if (x < 0 || y < 0 || y >= grid.length || x >= grid[0].length) return 0;
    if (grid[y][x] != 0) return 0;
    grid[y][x] = 2;
    return 1 + fill(x + 1, y) + fill(x - 1, y) + fill(x, y + 1) + fill(x, y - 1);
  }
  let x = 0;
  print(`${fill(x, 0)} cells filled`);      // 9 cells filled
});
```

A loop over units cannot hold such a call. Collect what it finds into an array, and call
the function from a loop over that.

### Functions in other files

A function declared at the top of any of the script's files runs in the game when a
program calls it with values of the program. `game()` marks one that only the game runs:

```ts
// shop.ts
export const award = game((p: Player, n: number) => { setResources(p, "add", n, "ore"); });
export const canAfford = game((have: number, price: number) => have >= price);

// main.ts
import { award, canAfford } from "./shop";
program(() => {
  let gold: u8 = 10;
  if (canAfford(gold, 5)) { gold -= 5; award(P2, 3); }
});
```

A `game()` function follows a program's rules, and what it does is shown at its own file
and line. It sees its parameters and what any file sees, not the calling program's
variables. Calling one outside a program is an error.

### Functions as values

**A function can be kept** in a variable, an array, a field or a `Map`, and returned by
another function. A call through what holds it calls whichever function is there when the
line runs. A closure keeps what it captured, as in JavaScript: `counter()` below gives a
function with a count of its own.

```ts
function heal(hp: number) { return hp + 10; }
function hurt(hp: number) { return hp - 10; }
function counter() {
  let n = 0;
  return () => { n += 1; return n; };
}

program(() => {
  const effects = [heal, hurt, (hp: number) => hp * 2];
  const next = counter();
  let hp = 40;
  let i = 0;
  while (i < effects.length) { hp = effects[i](hp); i = next(); }
  print(`${hp}`);                               // 80
});
```

A function handed to a method or a parameter costs nothing extra: it is copied in where it
is called. A kept one is a number in the map, and a call through it picks among the
functions that could be there, one test each. An `async` function or a generator is not
kept as a value: call it where it is written, or `start()` it.

## Classes

Classes are TypeScript's, declared inside the program or at the top of any of the script's
files. A method is a function that is handed the instance, so everything on
[Functions](#functions) holds for methods too.

```ts
program(() => {
  class Wave {
    static made = 0;
    left: number;
    constructor(public unit: UnitType, public count: number) { this.left = count; Wave.made++; }
    spawn(at: Location) { if (this.left > 0) { createUnit(P2, this.unit, 1, at); this.left--; } }
    get done() { return this.left == 0; }
  }
  class Boss extends Wave {
    constructor(unit: UnitType) { super(unit, 1); }
    spawn(at: Location) { super.spawn(at); displayText("The boss is here"); }
  }
  const waves = [new Wave(units.ZergZergling, 12), new Wave(units.ZergHydralisk, 6)];
  const boss = new Boss(units.ZergUltralisk);
  while (!waves.every((w) => w.done)) {
    for (const w of waves) w.spawn(locations.Gate);
    sleep(seconds(1));
  }
  boss.spawn(locations.Gate);
});
```

Fields with their first values, constructors and `constructor(public x: number)`, methods,
`get` and `set`, `static`, `readonly`, `private`, `protected` and `#x`, `extends` with
`super`, `abstract`, `implements` and type parameters all work. A field holds what a
record's does, and also another instance (`pos = new Vec(0, 0)`). `this.members = []`
starts an array over.

### How an instance is kept

The compiler keeps an instance one of two ways:

- **As its fields' variables**, when the build knows which instance each name holds.
  Nothing of the class is left in the map: the right method is found by what the instance
  is, `x instanceof Boss` is answered by the compiler, and the branch that is false is not
  built. This costs nothing beyond the fields.
- **By reference**, when the program needs it: an array or a variable that may hold
  several classes, or none (`let target: Enemy | null`); a variable given another
  instance; an instance in a `Map`. These instances are rows of one table of 1 023 rows. A
  field read through none is 0, and a write through none does nothing, where JavaScript
  would throw. A row that nothing holds any more is given back at the next wait.

```ts
class Enemy {
  constructor(public hp: number) {}
  worth() { return 1; }
}
class Boss extends Enemy {
  worth() { return 10; }
}

program(() => {
  const foes: Enemy[] = [new Enemy(5), new Boss(50), new Enemy(5)];
  let target: Enemy | null = null;
  let score = 0;
  for (const f of foes) {
    score += f.worth();
    if (!target || f.hp > target.hp) target = f;
  }
  print(`${score} ${target?.hp ?? 0}`);         // 12 50
});
```

Two limits:

- **A function may give back an instance when every `return` gives the same one**:
  `return this`, so that `v.add(w).scale(2)` chains; `return new Wave(n, 10)`; or one it
  was handed. `pick(a, b)` that returns one or the other is refused. For that, keep the
  instances in an array and return the place.
- **No static blocks.** Give a static field its value where it is declared.

## Errors

`try`, `catch`, `finally` and `throw` work as in TypeScript. `throw` takes a
`new Error(…)`, a `RangeError`, a `TypeError`, a class that extends one of them, or what a
`catch` took (`throw e`). A class of error has a `message`, a `name` and fields of its
own, and `e instanceof OutOfGold` tells the classes apart.

```ts
class OutOfGold extends Error {
  constructor(public need: number) { super(`need ${need} more`); }
}

program(() => {
  let gold = 30;
  function buy(cost: number) {
    if (cost > gold) throw new OutOfGold(cost - gold);
    gold -= cost;
  }
  try {
    buy(20);
    buy(50);
  } catch (e) {
    if (e instanceof OutOfGold) print(`${e.message} (${e.need})`);   // need 40 more (40)
    else throw e;
  } finally {
    print(`${gold} left`);                      // 10 left
  }
});
```

- An error goes up through the functions to the nearest `catch`. `finally` runs however
  the `try` is left: a `return`, a `break`, or an error on its way out.
- **An error nothing catches is shown in the game in red**, with its line ("TrigScript:
  uncaught OutOfGold: need 20 more, line 12."), and Simulate lists it at the `throw`. The
  program or task stops there. A handler of an [event](#events) gives up that one turn and
  goes on listening.
- A `try` may span `sleep` and `await`. An error in one branch of `Promise.all` or
  `Promise.race` leaves the statement, and the other branches stop where they are.
- A caught error cannot be kept in a variable, an array or a field. Copy what you need out
  of it in the `catch`, or put it in a field of your own class.
- An index past an array's end and a full pool are not errors: the game passes over them,
  and Simulate and the tests say where.

## Waiting and tasks

### `sleep`

**A program runs every frame, from where it left off.** Its body runs until it reaches a
`sleep()`, an `await` or its end, all within one frame, and carries on from there later.
`sleep(seconds(15))` gives the frame back and resumes that much later, while other
programs and the map's triggers go on. `frames(n)` is the game's own clock, `seconds(n)`
is twenty-four frames (one second at Fastest), and `minutes(n)` sixty of those.

`wait()` inside a program is allowed, but it is the game's own Wait: it holds the rest of
its trigger, and it takes the player's one wait slot, so the player's other Waits stop
until it is free ([Waits](triggers.md#waits)). Use it for a short pause, such as a text
and then a sound, and use `sleep` to pass time.

### `async` and `await`

In a program written `program(async () => …)`, `await sleep(…)` is the same pause, and
`await nextFrame()` waits one frame. An `async` function may wait anywhere in its body,
and `await f()` goes on when it returns, with its result. `await until(() => n >= 3)`
checks at once, then once a frame, and goes on in the frame the answer is true;
`until(bring(…))` takes a condition of the game as it is.

### Tasks

**A task runs beside the program.** `start(f())` starts an async call and goes on at once.
The program can `await` the task later, ask `t.running`, or stop it with `t.cancel()`. A
task may outlive the program that started it and may start tasks of its own.
`start(wave(n), { max: 4 })` lets at most four of that start's tasks run at once.

`Promise.all([…])` waits for every branch, `Promise.race([…])` for the first, and
`Promise.any` is a race. **A race's losers stop where they are**, where JavaScript lets
them run on. `.then((v) => …)` passes on what a promise gives, so
`sleep(frames(3)).then(() => 0)` in a race is a time limit with a value.

```ts
async function wave(n: number) {
  createUnit(P2, units.ZergZergling, n * 4, locations.Spawn);
  await sleep(frames(n * 5));
  return n;
}

program(async () => {
  let ticks = 0;
  const clock = start(async () => {
    while (true) { await sleep(frames(1)); ticks += 1; }
  });
  const first = await Promise.race([wave(1), wave(3)]);
  print(`wave ${first} ended first`);           // wave 1 ended first
  await until(() => ticks >= 10);
  clock.cancel();
  print(`${ticks} ticks, running: ${clock.running}`);   // 10 ticks, running: false
});
```

A task that ends on an error throws it where it is awaited. One that fails while nothing
awaits it is shown in red, and the program goes on. Something that keeps its own time is a
task, or another program. A `sleep` or an `await` cannot stand inside a loop over units, a
`for…of` over a text, or a function that calls itself.

### Generators

A `function*` walked by `for…of` puts the loop's body where each `yield` is, `yield*`
hands on another generator, and `break` leaves both. A class can be walked with
`*[Symbol.iterator]()`. An `async function*` is walked by `for await` and may wait between
its values.

```ts
function* lanes(n: number) {
  let i = 0;
  while (i < n) { yield i * 32; i += 1; }
}

program(() => {
  let total = 0;
  for (const x of lanes(4)) total += x;
  print(`${total}`);                            // 192
});
```

### Edges

`if (rose(bring(P1, units.AnyUnit, locations.Beacon, ">=", 1)))` is true on the frame the
condition becomes true, and not again until it has been false in between. `once(…)` is
true the first time only.

## Owners and per-player programs

**A program runs for its owner**, Player 1 unless `{ owner: … }` says otherwise, as a
trigger would: as that player, and only while that player is in the game. `CurrentPlayer`
means that player.

An owner of `AllPlayers`, a force (`players.Force1`) or a list of players (`[P1, P2, P3]`)
makes a **per-player program**. It runs every frame for each human or computer player
among them who is in the game. `CurrentPlayer` is that player, and every variable, array
and task is per player, each with its own copy. `let total = shared(0)` is one value they
all share. That is how lives, scores and cooldowns are written once:

```ts
program(() => {
  let lives: u8 = 3;
  while (true) {
    if (rose(deaths(CurrentPlayer, units.TerranMarine, ">=", 1))) {
      lives -= 1;
      setDeaths(CurrentPlayer, units.TerranMarine, "set", 0);
      if (lives == 0) defeat();
    }
    sleep(frames(1));
  }
}, { owner: AllPlayers });
```

A script may have several programs, each with its own variables. `{ name: "waves" }` names
one, so the Explorer shows it and a [test](trigscript.md#tests) can find it. The simulator
runs a per-player program one player at a time.

## Reading the game

**Every quantity a condition compares is also a value.** Leave the comparison and the
amount out of the call, and it is a read, a number like any other:

```ts
program(() => {
  let price = 50;
  // a condition, as ever:
  if (deaths(P1, units.TerranMarine, ">=", 10)) print("ten lost");
  let lost = deaths(P1, units.TerranMarine);             // a read
  if (minerals(CurrentPlayer) > price * 2) price += lost; // compared with a variable
  setResources(P2, "set", minerals(P1) / 2, "ore");      // as an action's amount
  let here = bring(P2, units.ZergZergling, locations.Pen);
  print(`${here} in the pen`);
});
```

That works for `deaths`, `kill`, `bring`, `command`, `accumulate`, `score`, `opponents`,
`countdownTimer` and `elapsedTime`. The common ones have plainer names: `minerals(p)`,
`gas(p)`, `resources(p, "oreAndGas")`, `countUnits(p, unit, location?)`, `kills(p, unit)`,
`countdown()` and `elapsed()`.

- A read means what its condition means: a force's minerals are the force's total, and
  `units.Men` counts what Bring counts.
- A read is taken when its line runs. `let ore = minerals(P1)` keeps the number, and
  `minerals(P1)` written twice reads twice.
- What to read (the player, the unit, the location) is fixed when the script is applied.
- `countdown()` and `elapsed()` count the game's own seconds, sixteen frames each, so at
  Fastest they run about one and a half times as fast as `sleep(seconds())`: after
  fourteen seconds of sleeping, `elapsed()` reads 21.

**About the players:** `race(p)` compared with `races.Zerg`, `.Terran` or `.Protoss`;
`slot(p)` compared with `slots.Human`, `.Computer`, `.Empty`, `.Rescuable` or `.Neutral`;
`isHuman(p)`; `hasLeft(p)`, for a player whose slot was taken and who is gone (a slot
nobody took counts too, and a computer never leaves); and
`supply(p, "used" | "max" | "provided", race?)`, as the top bar shows it.

## Units

**The units on the map are objects.** A `Unit` is one of the game's units as it is right
now. The entries of `units.` are `UnitType`s, and `u.type` is one.

```ts
program(() => {
  for (const u of unitsAt(locations.Pen, { owner: P2 })) u.hp = u.maxHp / 2;

  const target = nearest(units.TerranMarine, locations.Beacon, { owner: P1 });
  if (target) target.order("move", locations.Exit);
});
```

- `unitsAt(location, filter?)`, `unitsOf(player, filter?)` and `allUnits(filter?)` are
  what a `for…of` runs over.
- `first(filter?)`, `nearest(type, location, filter?)` and `randomUnit(filter?)` give one
  unit, or `null`. TypeScript wants the `if (target)` before the unit is used, or
  `target?.kill()`.
- A filter is `{ type, owner, at }`, every part known when the script is applied.
  `units.Men`, `units.Buildings` and `units.Factories` work as a type, and `CurrentPlayer`
  as an owner.
- Units come oldest first. A unit made in the place of one that died can come where the
  dead one did. A dying unit is passed over, so `first()` after a `kill()` is the next
  one.

### A unit's fields

These can be **read and written**: `hp`, `shields` and `energy` in whole points; `kills`;
`cooldown` (both weapons and spells at once); `resources` (a mineral field's); `buildTime`
(frames left of its making); `rank`; `matrix` (frames of defensive matrix: a write gives
250 points of it, and 0 takes it away); the timers `stim`, `ensnare`, `plague`,
`lockdown`, `maelstrom`, `irradiate` and `stasis`; and `invincible`, `hallucinated` and
`speedUpgrade`. `u.hp = 0` kills.

These can **only be read**: `maxHp` and `maxShields`, `owner`, `type`, `x`, `y`,
`orderId`, `speed` (how fast it is moving now), `cloaked`, `burrowed`, `underAttack` (the
game raised its under-attack alert for the unit within the last second or so, which it
does for a hit out of the player's view), `hasTarget` (its order is aimed at a unit) and
`inTransport`. The game keeps these to itself: writing a position ends the game with "EUD
not supported", and a cloak write shows nothing. The editor marks such a write as you
type.

A building finished early by writing `buildTime` keeps the hit points it had reached, and
a Terran building under a third burns, so heal it after.

### What a unit can be told

- `order("move" | "patrol" | "attack", location)`, the game's own Order, reaching this
  unit alone;
- `give(player)`, `kill()`, `remove()`;
- `damage(n)` and `heal(n)`, or `{ percent: 50 }` of the type's maximum;
- `locate(location)`, which centres a location on the unit so that `createUnit` and the
  other actions can happen where it stands.

`select(player, unit)` or `select(player, [a, b])` makes those units the player's
selection, as if they had clicked them. Functions take and return units
(`function weakest(): Unit | null`), and `a == b` says whether two are the same unit.

### Units kept across a wait

A variable can keep a unit across a `sleep()`. The game gives a dead unit's place to the
next unit made, so every use checks that the unit is still the one that was kept. Once it
is gone, its numbers read 0, its booleans false, and writing to it or telling it something
does nothing. `if (u)` asks whether it is still there.

A loop over units runs within one frame, so a `sleep()` or an `await` inside one is an
error. To deal with one unit at a time, find the next one after each sleep:

```ts
program(() => {
  let u = first({ owner: P2, at: locations.Pen });
  while (u) { u.kill(); sleep(seconds(1)); u = first({ owner: P2, at: locations.Pen }); }
});
```

Each loop and each pick looks through the game's units when its line runs, and in a
per-player program once for each player. Once or a few times a second is nothing. The
editor notes it at the end of the line, *scans units*, so that a scan in a loop that runs
every frame is a choice and not an accident.

## Events

**`on.*` runs a function each time something happens to a unit**, from the frame it is
written on. `const t = on.died(…)` gives back a [task](#tasks), and `t.cancel()` stops
listening. An `async` function is started as a task each time, so it may wait.

- `on.created(fn)`: every unit that comes onto the map, handed over on the next frame.
- `on.died(fn)`: every unit that dies or is removed, handed over as it was.
- `on.killed((u, by) => …)`: every unit killed in a fight, with the player whose attack
  killed it.
- `on.morphed((u, was) => …)`: a unit that turns into another type and stays the same
  unit, with the type it was.
- `on.order((u, order, was) => …)`: a unit that takes up a new order, with the one it had.
  This compares every unit's order with the last frame's, so it costs a look through the
  units every frame.

Each takes a unit type or a filter first: `on.created(units.ZergZergling, …)`,
`on.died({ owner: P8 }, …)`, `on.killed({ owner: P8, by: P1 }, …)`. A listener written at
the top of a file, outside any program, listens from the start of the game. `on.key` and
`on.chat` do the same for keys and typed lines ([Keys, the mouse and
chat](#keys-the-mouse-and-chat)).

```ts
program(async () => {
  let lost = 0;
  on.died({ owner: P1 }, (u) => {
    lost += 1;
    if (u.type == units.TerranMarine) print(`${lost} lost`);
  });
  on.killed((u, by) => { if (by == P1) setResources(P1, "add", 5, "ore"); });
  on.created(units.ZergZergling, (u) => { u.hp = u.maxHp / 2; });
  on.died({ owner: P8 }, async (u) => {
    await sleep(seconds(2));
    createUnit(P8, u.type, 1, locations.Spawn);
  });
});
```

## The game's tables and memory

**`stats()` reaches the game's own tables**: what a unit type costs, what a weapon does, a
player's upgrades. A field reads as a number (or true or false) and takes `=` and `+=`.

```ts
program(() => {
  stats(units.TerranMarine).minerals = 25;
  stats(units.TerranMarine).speed = 6.5;            // pixels a frame: a fraction is fine when it is known when the script is built
  stats(units.ZergZergling).name = "Dog";
  stats(weapons.GaussRifle).damage += 2;
  stats(upgrades.TerranInfantryArmor).minerals = 50;
  stats(units.TerranGhost).permanentCloak = true;
  stats(P3).color = "teal";                         // or colors.teal
  stats(P1).upgrades[upgrades.TerranInfantryWeapons] = 3;
  stats(P1).researched[techs.Lockdown] = true;
  if (stats(units.TerranMarine).minerals > minerals(CurrentPlayer)) print("too dear");
});
```

| Of | Fields |
| --- | --- |
| A unit type | `maxHp`, `maxShields`, `armor`, `minerals`, `gas`, `buildTime` (seconds on the game's clock), `supplyUsed`, `supplyProvided`, `sight`, `groundWeapon`, `airWeapon`, `size`, `speed`, `name`, and the flags `detector`, `permanentCloak`, `cloakable`, `burrowable`, `regenerates`, `invincible`, `hero`, `organic`, `mechanical`, `robotic` |
| A weapon (`weapons.`) | `damage`, `bonus`, `cooldown`, `factor`, `range`, `minRange` |
| An upgrade (`upgrades.`) | `minerals`, `gas`, `time`, and `maxLevel` to read |
| A technology (`techs.`) | `minerals`, `gas`, `time`, `energy` |
| A player | `color`, `upgrades[…]`, `researched[…]` |

Only what has been played and seen working in StarCraft: Remastered is there, and hovering
a field says what it affects. Most unit-type fields apply to units made after the write,
and a weapon's to every unit using it at once. `speed` and `name` can be set but not read.
A write lasts for the rest of the game.

**`memory` is the game's other values** that have no word of their own, each with a hover
that says what Remastered does with it: `memory.game.frame` (frames since the game began),
`memory.map.width` and `memory.map.height` (in tiles), and `memory.vision.countdown` (set
to 1, the next frame puts every tile back in fog, and each unit reveals what it sees
again).

```ts
program(() => {
  if (memory.game.frame % 24 == 0) print(`${memory.map.width} by ${memory.map.height}`);
  memory.vision.countdown = 1;
});
```

`memory(address, comparison, value)` and `setMemory(address, modifier, value)` reach any
value of the game's memory by its address (EUD), in a trigger or a program.

## Keys, the mouse and chat

**What the players do is `keyPressed`, `keyHeld`, `clicked`, `mouse` and `chatted`.** A
press, a click and a typed line are true on the one frame they arrive, so a program looks
for them in a loop that runs every frame, or listens with `on.key` and `on.chat`:

```ts
program(() => {
  while (true) {
    if (keyPressed(CurrentPlayer, "F8")) createUnit(CurrentPlayer, units.TerranMarine, 1, locations.Base);

    if (clicked(CurrentPlayer, "right")) {
      const at = mouse(CurrentPlayer);                       // map pixels, kept as they are now
      centerLocation(locations.Cursor, at.x, at.y);
      createUnit(CurrentPlayer, units.TerranMarine, 1, locations.Cursor);
    }

    const m = chatted(CurrentPlayer, "-spawn {n} {what:unit}");
    if (m) createUnit(CurrentPlayer, m.what, m.n, locations.Base);

    underMouse(CurrentPlayer, { owner: CurrentPlayer })?.heal(10);
    sleep(frames(1));
  }
}, { owner: AllPlayers });
```

The player is one of `P1` … `P8` or `CurrentPlayer`; in a per-player program, each
player's own keys, mouse and lines. All of it reaches every player's computer together, a
few frames after it happens. That is the trip between computers, and it is the same in a
game played alone.

### Keys and buttons

- `keyPressed(player, key)` is true once per press, on the frame the press arrives, and
  not while the player is typing a message. `keyHeld(player, key)` is true on every frame
  the key is down.
- Keys are the letters and digits, `"F1"`, `"F7"` … `"F12"`, `"Space"`, `"Enter"`,
  `"Escape"`, `"Tab"`, `"Shift"`, `"Ctrl"`, `"Alt"`, the arrows (`"Left"` …),
  `"Backspace"`, `"Delete"`, `"Insert"`, `"Home"`, `"End"`, `"PageUp"`, `"PageDown"` and
  `"Numpad0"` … `"Numpad9"`. The game keeps F2 to F6 to itself and reports no press of
  them, so asking for one is an error. The game's own use of a key still happens.
- `clicked(player, "left" | "right" | "middle")` is the same as `keyPressed` for a mouse
  button.
- `on.key("F7", (p) => …)` runs a function each time a player presses the key
  (`{ from: P1 }` for one player's).

### The mouse and locations

- `mouse(player)` is where the player's cursor is on the map, `x` and `y` in pixels (32 to
  a tile). `const at = mouse(p)` keeps the place.
- `centerLocation(location, x, y)` moves a location there with its size kept, or
  `centerLocation(location, x, y, width, height)`, so that `createUnit` and the other
  actions can happen under the cursor.
- `bounds(location)` is where a location is now: `left`, `top`, `right` and `bottom` in
  pixels, read in the game, so a location that was moved is read where it went. It is
  written one edge at a time:
  `const b = bounds(locations.Pen); b.left += 32; b.right += 32;` slides it a tile to the
  right.
- `underMouse(player, filter?)` is the unit nearest the cursor and no farther than
  `within` pixels from it (48 unless the filter says otherwise), or `null`.

### Chat

`chatted(player, pattern)` is `null`, or what the pattern read out of the line the player
sent. `on.chat("-give {n}", (p, { n }) => …)` runs each time a player sends a line that
fits.

- The pattern's own words are matched exactly, and the whole line has to fit.
- `{n}` reads a whole number, up to 1 048 575.
- `{what:unit}` reads a unit type by its name (`Terran Marine` or `TerranMarine`, or the
  map's custom name). It takes the rest of the line, so it comes last.
- `{kind:ore|gas}` reads one of the listed words, as its place in the list (0, 1, …).
- Names and words match whatever their capitals, and a pattern reads up to three values.
- The values are typed from the pattern: after `m.` the editor offers `n` and `what`, and
  `m.what` is a `UnitType` an action takes at once.

Start a pattern with a word of its own, such as `-spawn`, so ordinary talk is never taken
for it. A single-player game has no chat, so try typed lines in a multiplayer game;
hosting one alone is enough.

### What input takes from the map

Only a program that reads input takes anything for it, and nothing is a death counter, a
switch or a string: one unit-properties slot; one unit type the map does not use (the
Valkyrie, unless the map uses it); the location the build already keeps for orders; and
hidden units of Player 12 at the map's top-left corner, six for each human player and six
more when the mouse is read. Outside a program these functions are an error, where
`if (keyPressed(…))` would otherwise quietly be true. Simulate presses no keys, so there
they read as nothing; a [test](trigscript.md#tests) can press them.

### What only one computer knows

`local` is what this computer alone knows: `local.player` (the player at this computer),
`local.camera.x` and `.y` (where its screen is on the map), `local.mouse.x` and `.y` (the
cursor on the screen), `local.selected` and `local.selectionCount`.

A local value may choose what is shown on this computer. It may not change the game, since
every computer would change it differently and the game would split, and the editor
refuses that. `await sync(player, value)` sends that player's value to every computer and
gives it back a few frames later, the same everywhere. `select(P1, local.selected!)` makes
this computer's selection the player's selection on every computer.

```ts
program(async () => {
  let x = 0;
  while (true) {
    if (keyHeld(P1, "D")) x += 4;
    if (local.player == P1) print(`screen at ${local.camera.x}`);
    const cam = await sync(P1, local.camera.x);
    if (cam > x) x = cam;
    await nextFrame();
  }
});
```

## Text

### Texts with values

`displayText` and `print` take a template literal, or texts joined with `+`, with the
program's numbers in it, `name(p)` and `color(p)`:

```ts
program(() => {
  let wave = 3;
  displayText(`${color(P2)}${name(P2)}\x01 has ${minerals(P2)} ore — wave ${wave + 1}`);
  print(`Wave ${wave}`, { to: AllPlayers, position: "center" });
});
```

`name(p)` is the player's name and `color(p)` the colour code of their colour, both filled
in by the game; the ordinary colour codes work as ever. `displayText` shows the text to
the current player. `print(text, { to, position })` shows it to someone else (a player,
`AllPlayers` or a force), or, with `position: "center"`, on the line in the middle of the
screen where the game's own messages appear. A boolean in a text is `true` or `false`. A
program's texts never take a string of the map you edit: the build gives them strings of
their own.

### A text is a value

`string` is a type of a program as `number` is. A variable holds one, a function takes and
returns one, a record has one as a field, and there is no length to declare.

```ts
program(() => {
  let wave = 3, left = 12, shown = "";
  let title = wave > 10 ? "Late game" : "Early game";   // texts written in the script
  let line = `Wave ${wave}: ${left} left`;                // a text made in the game
  line += "!";
  if (line != shown) { print(line); shown = line; }
  setMissionObjectives(`${title} - ${line}`);
});
```

The editor keeps a text one of two ways and says which at the end of its line. A variable
that only ever receives texts written in the script (`"Boss"`, `titles[level]` out of a
list the script has) holds the number of a string, and costs what a number does. A text
that is *made* (a template with values in it, `a + b`, a method's result) keeps its
characters in the pool the growing arrays share, and holds up to 1 023 bytes. Past that it
is cut off, and the game says so once in red.

Texts take `+`, `+=`, templates, the comparisons, `if (s)` (not empty), `switch (s)`,
`length`, `s[i]`, `at()`, `charAt()`, `charCodeAt()`, `codePointAt()`, `slice()`,
`substring()`, `indexOf()`, `includes()`, `startsWith()`, `endsWith()`, `padStart()`,
`padEnd()`, `repeat()`, `concat()`, `trim()`, `trimStart()`, `trimEnd()`, `toUpperCase()`
and `toLowerCase()` (A to Z only), `replace()` and `replaceAll()` of a text, `split()` at
a text, `parseInt()`, `isNaN()`, `String(n)`, `n.toString()` and `for (const ch of s)`.

```ts
program(() => {
  let wave = 3;
  const line = ` Wave ${wave}: zerglings, hydras `;
  const parts = line.trim().split(": ");
  print(parts[1].toUpperCase().replaceAll(", ", " + "));       // ZERGLINGS + HYDRAS
  print(`${parseInt("12 ore") + wave} ${line.includes("hydra")} ${"A".charCodeAt(0)}`);   // 15 true 65
});
```

### Characters

A character counts as one, as JavaScript counts it, so `"저글링".length` is 3 and `"저글링"[1]`
is `글`. The one difference is a character past U+FFFF, such as an emoji: a program counts
one where JavaScript counts two, and the game draws a dark square in its place. `s[i]` and
`slice()` walk the text from its start, so over a long text, `for (const ch of s)` is
quicker. That loop runs within the frame and cannot sleep. A loop over the places can,
which is how a text is typed out one character at a time:

```ts
program(() => {
  let wave = 3;
  let line = `Wave ${wave} is here`;
  let typed = "";
  for (let i = 0; i < line.length; i++) { typed += line[i]; print(typed); sleep(frames(2)); }
});
```

The game's font is proportional and a colour code has no width, so `padStart` does not
line columns up.

### Texts outside the chat area

The objectives, a leaderboard's label, a transmission's line and a unit type's name
(`stats(units.TerranMarine).name = …`) take a made text, up to 255 bytes. The game shows
the text as it was when the action ran, so when the text changes, run the action again. In
a program of every player, each player sees their own. Any other action's text, such as
`setNextScenario` or a sound's path, has to be written in the script.

### Lines of JSX

In a `.tsx` file, `<line>…</line>` is a line of text that may hold the program's values,
`<bar value={hp} max={100} width={10} />` is a bar of squares, and `<cell color={c} />` is
a square of one of the game's text colours. `print` takes a line, and
`ui.lines(player, () => …)` keeps the lines in a player's text area and draws them again
when the values in them change. The [`trigscript/ui`](trigscript-library.md#ui) library
builds panels, meters, menus and dialogs from them.

```tsx
program(async () => {
  let hp = 0;
  ui.lines(P1, () => (
    <line>
      Base <bar value={hp} max={100} width={10} /> {hp}
    </line>
  ));
  while (hp < 100) {
    hp += 25;
    await sleep(seconds(1));
  }
  print(<line>Wave {hp / 25}</line>);
});
```

## Sounds and imported files

### Sounds

`playWav(sound, 0)` plays a sound: one of the game's own files by its path, one of the
map's sounds by its name (`sounds.Name`, from the Sound Editor's list), or a clip the
script makes when it is built. `tone()`, `noise()`, `pluck()`, `fm()` and `silence()` make
clips; `.fade()`, `.filter()`, `.delay()`, `.reverb()` and `.limit()` change them;
`mixdown()` lays clips over one another, and `together()` turns down clips the game will
play at once.

```ts
const beep = tone("A5", 0.1, { wave: "square", volume: 0.3 });
const zap = tone("A3", 0.4, { wave: "saw" }).filter("lowpass", [[0, 300], [0.4, 3000]]).reverb({ decay: 0.3 });

program(() => {
  playWav(beep, 0);
  if (random()) playWav(zap, 0);
  playWav("sound\\glue\\mousedown2.wav", 0);
});
```

The build puts each clip the script plays into the map once, and a `trigger()` and a
transmission can take one too. Which clip plays may follow a variable of the program. The
game plays 32 sounds at once and adds copies up with no limiter, so keep a clip's peak
under 1 where copies overlap. Music played note by note is `trigscript/music`
([Music](trigscript-library.md#music)).

### Files the script imports

**Import Video…** in the Explorer turns a file into one the script can import. It takes a
picture, a sound or a MIDI file as well as a video, and keeps the result in the map with
the script:

- a video becomes a `.video` file (`import film from "./film.video"`): its frames, a tile
  a pixel, ink or not, for `fog.play` or `fog.light`;
- a picture becomes an `.image` file: its pixels at the size chosen, which `scale`,
  `crop`, `threshold`, `tones` and `halftone` turn into rows for `fog.picture`;
- a sound file becomes a `.sound` file: a clip for `playWav` and the music library;
- a MIDI file becomes a `.notes` file: each track's notes, which `music.midi` plays.

All of it is worked out when the script is built, and what reaches the game is what the
script makes of it. `cover(picture, shapes)` gives the brushes of your own shapes that
draw a picture's ink, for a renderer of your own; `fog.picture` is the same with the
game's sight ranges. The [Bad Apple!!](trigscript.md#bad-apple) showcase uses a video this
way.

## Libraries

### The standard library

TrigScript comes with nine modules written for programs, imported as
`"trigscript/<name>"`. The [TrigScript library](trigscript-library.md) guide has a page
for each, with an example and everything it holds.

| Module | What it is for |
| --- | --- |
| [`trigscript/math`](trigscript-library.md#math) | Easing, distances, angles, and `Vec` |
| [`trigscript/random`](trigscript-library.md#random) | `chance`, `range`, `pick`, `weighted`, `shuffle`, and a seeded `Random` |
| [`trigscript/timers`](trigscript-library.md#timers) | `every`, `after`, `Cooldown`, `Countdown`, `Stopwatch`, and loops spread over frames |
| [`trigscript/signals`](trigscript-library.md#signals) | `Signal`, events of your own |
| [`trigscript/ui`](trigscript-library.md#ui) | Meters, panels, menus and dialogs in the text area |
| [`trigscript/cutscene`](trigscript-library.md#cutscenes) | A camera, units walking to their marks, portraits speaking |
| [`trigscript/fog`](trigscript-library.md#fog) | Pictures and videos drawn in the fog of war |
| [`trigscript/screen`](trigscript-library.md#screen) | A grid of pixels on the map and the minimap |
| [`trigscript/music`](trigscript-library.md#music) | Instruments, patterns and songs |

`fog`, `screen` and `cutscene` each take one of the map's first 63 locations that the map
does not use, with `reserveLocation(why)`. A script of your own can call it too: the
location is chosen when the script is built, and the reason shows with the map's
requirements.

### Libraries from other plugins

A plugin can provide a library of its own, which a script imports by the library's name:
`import { spawnWave } from "waves"`. The map keeps a copy of each library it imports, so
it still builds where the plugin is missing or at another version. See [Libraries from
other plugins](trigscript-library.md#libraries-from-other-plugins).

## What a program does not have

Outside `program()` the script is all of TypeScript, since it simply runs. Inside one,
these cannot become something the game does. Each is refused with a message as you type:

| Not there | Write instead |
| --- | --- |
| `**` or `Math.pow` by a power that changes while the game runs | Multiply in a loop |
| A fraction in a `u8`, `u16` or `u32`, or a fixed number where only a whole one goes (an index, a count) | `Math.floor`, `Math.round` or `Math.trunc` around it |
| `\|\|=` and `&&=` | `flag = flag \|\| other` |
| A variable with no first value (`let n;`) | `let n = 0` |
| `for…in` | `for…of`, or a loop over a list the script knows |
| `delete` | A field that says the value is gone (`hp = 0`), or a `Map` |
| `typeof x` or `"key" in x` as a test while the game runs | A variable of one type, or a number kept beside it to `switch` on |
| A function that calls itself and waits | A loop that waits: `while (n > 0) { …; await sleep(…); n--; }` |
| An `async` function or a generator kept as a value | Call it where it is written, or `start()` it |
| A function that may return one instance or another it did not make | Keep the instances in an array and return the place |
| `throw` of something that is not an error; a caught error kept in a variable | `throw new Error(…)` or a class that extends it; copy what you need out of it in the `catch` |
| What `splice` takes out, as a value | Read it first: `xs.slice(start, end)` |
| `flat`; `map` into texts or records | `push` in a `for…of` |
| Regular expressions, and `replace` with a function, on a made text | `replace`, `replaceAll` or `split` with a text |
| A `Map` whose values are texts or records, or whose keys are texts other than a union the script knows | The place of a row of an array of records as the value |
| Methods or getters on an object literal | A class |
| A static block in a class | The static field's value where it is declared |
| A `for` written out more than 256 times | A `while` loop |
| `Math.random()`, `Date`, `JSON`, `setTimeout`, `bigint` | `random(n)`; `elapsed()` or `memory.game.frame`; `trigscript/timers` |
| A local value (`local.*`) that changes the game | `await sync(player, value)` first |
| Writing a unit's position or cloak | The game refuses these itself ([Units](#units)) |
| Playing on the classic game (1.16.1) | `trigger()` only |
