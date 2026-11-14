# The TrigScript library

TrigScript comes with twelve modules written for programs: motion and maths, chance,
timers, events of your own, menus and dialogs in the text area, cutscenes, pictures drawn
in the fog of war, pixel screens on the minimap, music, workers that go to work on their
own, Medics that restore on their own, and right-clicks on the command card. A script
imports what it needs:

```ts
import { chance, range } from "trigscript/random";
import { every, SECOND } from "trigscript/timers";

program(async () => {
  every(10 * SECOND, (n) => createUnit(P8, units.ZergZergling, range(n, n + 3), locations.Spawn));
  while (true) {
    if (keyPressed(P1, "Space") && chance(25)) print("A lucky shot.");
    await nextFrame();
  }
});
```

Each module is TrigScript, written the way your own files are, and only the modules a
script imports go into the map. In the editor, hovering a name shows its documentation.
These pages show what each module is for, with an example to start from and a table of
what it has. The language the examples are written in is the subject of the [TrigScript
language](trigscript-language.md) guide.

| Module | What it is for |
| --- | --- |
| [`trigscript/math`](#math) | Easing, distances, angles, and `Vec`, a point of two fixed numbers |
| [`trigscript/random`](#random) | `chance`, `range`, `pick`, `weighted`, `shuffle`, and a seeded `Random` |
| [`trigscript/timers`](#timers) | `every`, `after`, `Cooldown`, `Countdown`, `Stopwatch`, and loops spread over frames |
| [`trigscript/signals`](#signals) | `Signal`, an event of your own that several parts of a map listen to |
| [`trigscript/ui`](#ui) | Meters, panels, menus and dialogs in a player's text area |
| [`trigscript/cutscene`](#cutscenes) | A camera that pans and follows, units that walk to a mark, lines spoken by a portrait |
| [`trigscript/fog`](#fog) | The fog of war as a picture: discs, rectangles, pictures, columns, videos |
| [`trigscript/screen`](#screen) | A grid of pixels shown on the map and the minimap as units |
| [`trigscript/music`](#music) | Instruments, patterns and songs, played note by note or mixed when the script is built |
| [`trigscript/workers`](#workers) | New workers rallied to minerals or gas start gathering as they come out |
| [`trigscript/spells`](#spells) | Medics that cast Restoration on their own |
| [`trigscript/card`](#command-card) | A right-click on a command card button, for single-player maps |

Other plugins can provide libraries of their own; see [Libraries from other
plugins](#libraries-from-other-plugins).

Some modules need something from the map, and they say so on their pages. `fog`, `screen`,
`cutscene` and `card` each take one of the map's first 63 locations that the map does not
use. The reason each location was taken shows with the map's requirements. `fog` uses
eleven flying hero unit types as its brushes, and `screen` needs players set up for its
colours.

**With a mod.** While the editor draws from a mod's data set, the examples' unit names are
the mod's: `units.Terran_Mason` rather than `units.TerranSCV` (see [With a
mod](trigscript-language.md#with-a-mod)). The modules name the units they make by the
game's own ids: `fog`'s eleven heroes, and `screen`'s Overlords, Pylons and Map Revealers.
So they build the same with any data set, and in a mod each of those ids is whatever unit
the mod keeps there. Like any program, they are made for the game's own data.

Every example on these pages compiles as it is written, against a map with the locations
`Beacon`, `Spawn` and `Base`. A line that ends with a comment such as `// 50` prints that
when the example runs.

## Math

`trigscript/math` is for things that move: a value that follows another, a glide from one
place to another that slows at the end, the distance and the angle between two points.

```ts
import { Vec, distance, approach, wrap, lerp, easeOutQuad } from "trigscript/math";

program(() => {
  print(`${distance(0, 0, 30, 40)}`);                          // 50
  print(`${approach(10, 50, 15)} ${approach(45, 50, 15)}`);    // 25 50
  print(`${wrap(-1, 10)} ${wrap(12, 10)}`);                    // 9 2
  print(`${lerp(fixed(0), fixed(100), easeOutQuad(fixed(0.5)))}`);   // 75
  const v = new Vec(fixed(3), fixed(4));
  print(`${v.length()} ${v.add(new Vec(fixed(1), fixed(1))).x}`);    // 5 4
});
```

A location that drifts towards a Marine, eight pixels a frame:

```ts
import { approach } from "trigscript/math";

program(async () => {
  let x = 0;
  let y = 0;
  while (true) {
    const m = first({ owner: P1, type: units.TerranMarine });
    if (m) {
      x = approach(x, m.x, 8);
      y = approach(y, m.y, 8);
      centerLocation(locations.Beacon, x, y);
    }
    await nextFrame();
  }
});
```

Fractions are the language's `fixed` numbers, about four decimal places from about −32 768
to 32 767 ([Numbers with a fraction](trigscript-language.md#numbers-with-a-fraction)).
Angles are radians, 0 to the right and π / 2 down, since y grows down the map. The
functions that can stay whole (`approach`, `wrap`, `sign`, `distanceSq`, `manhattan`) do,
and cost less.

| Name | What it gives |
| --- | --- |
| `PI`, `TAU` | π, and a whole turn (2π). |
| `lerp(a, b, t)` | From `a` to `b` by `t`: `a` at 0, `b` at 1. |
| `inverseLerp(a, b, v)` | Where `v` is between `a` and `b`, as `lerp`'s `t`. |
| `remap(v, a1, b1, a2, b2)` | `v` from the range `a1` … `b1` into `a2` … `b2`. |
| `clamp01(t)` | `t` kept inside 0 … 1. |
| `approach(current, target, step)` | From `current` towards `target` by at most `step`, never past it. |
| `wrap(n, size)` | `n` into 0 … `size` − 1, going round: `wrap(-1, 10)` is 9. |
| `sign(n)` | −1, 0 or 1. |
| `distance(x1, y1, x2, y2)` | The distance as the crow flies. |
| `distanceSq(x1, y1, x2, y2)` | The distance squared, whole and cheaper: compare it with a range squared. |
| `manhattan(x1, y1, x2, y2)` | The distance along the axes, which is what the game's own "nearest" goes by. |
| `angleTo(x1, y1, x2, y2)` | The angle from one point to the other, −π to π. |
| `radians(degrees)`, `degrees(radians)` | One unit of angle as the other. |
| `easeInQuad`, `easeOutQuad`, `easeInOutQuad`, `easeInCubic`, `easeOutCubic`, `easeOutBack`, `smoothstep` | Easing curves: `t` from 0 to 1 in, how far along the motion is out. `easeOutBack` goes a little past the end and comes back. |
| `new Vec(x, y)` | A point, or a direction with a length. `add`, `sub`, `scale`, `dot`, `length`, `normalized`, `angle`, `rotate`, `distanceTo` and `lerp` each give a new `Vec`; `Vec.fromAngle(angle, length)` makes one from an angle. |

## Random

`trigscript/random` is chance in the words a map maker uses: one time in four, a number
from 1 to 3, one of a list.

```ts
import { chance, range, pick, weighted } from "trigscript/random";

const BOSSES = [units.ZergUltralisk, units.ZergDefiler, units.ZergQueen];

program(async () => {
  let wave = 1;
  while (wave <= 10) {
    createUnit(P8, units.ZergZergling, range(4, 8), locations.Spawn);
    if (chance(25)) createUnit(P8, pick(BOSSES), 1, locations.Spawn);
    const tier = weighted([70, 25, 5]);              // 0 most of the time, 2 rarely
    setResources(P1, "add", 50 * (tier + 1), "ore");
    wave += 1;
    await sleep(seconds(30));
  }
});
```

The functions draw on the game's own random numbers, which every player's game draws
alike, so a game of several players never goes out of step. `Random` is a generator of
your own, seeded: the same seed gives the same numbers in every game. That is what a level
made from a seed, or a code a player types to get the same map again, needs.

```ts
import { Random } from "trigscript/random";

program(() => {
  const rng = new Random(1234);
  const lanes = [0, 1, 2, 3];
  rng.shuffle(lanes);
  print(`Lanes in order: ${lanes.join(", ")}, first gap at ${rng.range(5, 20)}`);
});
```

| Name | What it gives |
| --- | --- |
| `chance(percent)` | True `percent` times in a hundred. |
| `range(min, max)` | A whole number from `min` to `max`, both included. |
| `dice(count, sides)` | The total of `count` dice of `sides` sides: `dice(3, 6)` is 3 to 18. |
| `pick(items)` | One of a list, any one alike. |
| `weighted(weights)` | The place of one of the weights, each as likely as its share: `[70, 25, 5]` gives 0 most of the time. |
| `shuffle(items)` | An array of the program in a random order, in place. |
| `new Random(seed)` | A seeded generator with `next()`, `int(n)`, `range(min, max)`, `chance(percent)`, `pick(items)` and `shuffle(items)`. |

## Timers

`trigscript/timers` is time without a loop of your own: something every ten seconds, once
in three, a cooldown, a round's clock.

```ts
import { every, after, Cooldown, Countdown, SECOND } from "trigscript/timers";

program(async () => {
  const round = new Countdown(90 * SECOND);
  const waves = every(10 * SECOND, (n) => createUnit(P8, units.ZergZergling, n, locations.Spawn));
  after(3 * SECOND, () => print("Go!", { to: AllPlayers, position: "center" }));
  const stim = new Cooldown(5 * SECOND);
  while (!round.done()) {
    if (keyPressed(P1, "T") && stim.use()) {
      for (const u of unitsOf(P1, { type: units.TerranMarine })) u.stim = 37;
    }
    await nextFrame();
  }
  waves.cancel();
  victory();
});
```

Time is counted in frames, 24 a second at Fastest (`SECOND`). `every` and `after` run
their function in a [task](trigscript-language.md#tasks) beside the program, so the
program goes on at once; the task they give back stops with `cancel()`. Their function
runs to its end within the frame. Sixteen of one `every` or `after` can run at once.
`Cooldown`, `Countdown` and `Stopwatch` only read the game's frame counter, so there is
nothing to stop.

**Work spread over frames.** A loop runs all its rounds within one frame. `over` and
`spread` hand out a few rounds a frame instead, so that a thousand bullets or a whole
map's cells cost what fifty do:

```ts
import { over } from "trigscript/timers";

program(async () => {
  const bullets: { x: number; dx: number }[] = [];
  for (let i = 0; i < 200; i++) bullets.push({ x: 0, dx: (i % 5) + 1 });
  while (true) {
    for await (const b of over(bullets, { per: 50 })) b.x += b.dx;   // fifty a frame: four frames a pass
    await nextFrame();
  }
});
```

| Name | What it is |
| --- | --- |
| `SECOND` | 24: frames in a second at Fastest. |
| `now()` | Frames since the game began. |
| `every(period, fn, times?)` | Run `fn` every `period` frames, forever or `times` times; `fn` is handed how many times it has run. Gives a task. |
| `after(delay, fn)` | Run `fn` once, `delay` frames from now. Gives a task; `cancel()` before then and it never runs. |
| `over(list, { per })` | The elements of `list`, `per` of them a frame, for `for await`. |
| `spread(count, { per })` | 0 … `count` − 1, `per` of them a frame. |
| `new Cooldown(period)` | `use()` is true when it is ready and starts it again; `ready()`, `left()` and `reset()`. |
| `new Countdown(length)` | `left()`, `done()`, `restart(length)` and `add(frames)`. |
| `new Stopwatch()` | `elapsed()` since it was made, and `reset()`. |

## Signals

A `Signal` is an event of your own. One part of a map says that something happened, such
as a wave cleared, without knowing who listens: the shop, the score and the music each add
a handler, and the wave code only emits.

```ts
import { Signal } from "trigscript/signals";

program(() => {
  const waveCleared = new Signal<number>();
  waveCleared.on((wave) => { setResources(P1, "add", 100 * wave, "ore"); });
  waveCleared.once(() => print("First wave down!"));            // First wave down!
  const id = waveCleared.on((wave) => print(`Wave ${wave} cleared`));   // Wave 1 cleared
  waveCleared.emit(1);
  waveCleared.off(id);
  waveCleared.emit(2);
});
```

A signal carries one value of the type it is made with: a number, a boolean, a text or a
unit (`new Signal<Unit>()`). Its handlers are [functions kept as
values](trigscript-language.md#functions-as-values), and they run one after another, in
the order they were added, within the frame. A handler that runs an action is written with
braces, `(wave) => { setResources(…); }`, since a kept function cannot give back an
action. Make the signal inside the program that uses it.

| Name | What it does |
| --- | --- |
| `new Signal<T>()` | A signal carrying a `T`. |
| `on(handler)` | Add a handler for every `emit`. Gives its number, for `off`. |
| `once(handler)` | Add a handler for the next `emit` only. |
| `off(id)` | Take a handler off. |
| `emit(value)` | Run every handler with `value`. |
| `count()`, `clear()` | How many handlers it has; take them all off. |

## UI

`trigscript/ui` builds a player's text area out of pieces: a panel with a title, a meter,
a menu chosen with the keyboard, a dialog typed out a character at a time. It is written
in [lines of JSX](trigscript-language.md#lines-of-jsx), so a script that uses it is a
`.tsx` file.

```tsx
import { Meter, Panel, MenuList, DialogBox, choose, say, clock } from "trigscript/ui";

const ITEMS = ["Marine (50)", "Medic (75)", "Leave"];

program(async () => {
  const shop = { selected: 0, open: false };
  const talk = { speaker: "", text: "", open: false };
  ui.lines(P1, () => (
    <>
      <Panel title={`Defence ${clock(memory.game.frame)}`}>
        <Meter label="Marines" value={countUnits(P1, units.TerranMarine)} max={20} />
      </Panel>
      {shop.open && <MenuList items={ITEMS} selected={shop.selected} />}
      <DialogBox box={talk} />
    </>
  ));
  await say(P1, talk, "Raynor", "Hold the bridge until dawn. Press B to buy.");
  while (true) {
    if (keyPressed(P1, "B")) {
      const pick = await choose(P1, ITEMS.length, shop);
      if (pick == 0 && minerals(P1) >= 50) {
        setResources(P1, "subtract", 50, "ore");
        createUnit(P1, units.TerranMarine, 1, locations.Base);
      }
      if (pick == 1 && minerals(P1) >= 75) {
        setResources(P1, "subtract", 75, "ore");
        createUnit(P1, units.TerranMedic, 1, locations.Base);
      }
    }
    await nextFrame();
  }
});
```

Give a player one `ui.lines` and put every piece in it, as the example does. The pieces
show records of yours (`shop`, `talk`), and `choose` and `say` change those records, so
the view follows. A view is drawn again only when something it reads changes, and
otherwise once a second, unchanged, so a menu, a dialog and a meter cost nothing while
nothing changes.

`choose` moves the selection with W and S (or Up and Down) and picks with Space. It does
not use Enter, which opens the chat in a game of several players. The text area has eleven
lines. A colour code takes no width, and after grey on a line every later colour code is
ignored, so put grey last.

| Name | What it is |
| --- | --- |
| `<Panel title color?>` | A title, `-- Wave 3 --`, over the lines inside it. |
| `<Meter label value max width?>` | A labelled bar, green above half, yellow above a quarter, red below. |
| `<MenuList items selected color?>` | A menu's lines, the selected one marked. |
| `choose(player, count, menu)` | Open the menu, let the player choose, and give the place chosen. |
| `<DialogBox box>` | A dialog's lines while it is open: the speaker, the words, and (Space). |
| `say(player, box, speaker, text)` | Open the dialog, type the words in, and close it when the player presses Space. |
| `typewriter(into, text, every?)` | Put `text` into `into.text` a character every `every` frames. |
| `log(lines, text, keep?)`, `<LogLines lines color?>` | A log that keeps its last `keep` lines, and its lines. |
| `clock(frames)` | `"1:05"`: frames as minutes and seconds. |
| `thousands(n)` | `"12,345"`. |

## Cutscenes

`trigscript/cutscene` acts out a scene: the camera looks, pans, follows a unit and shakes,
units walk to their marks, and a portrait speaks a line. A player can skip it.

```ts
import { Camera, walk, line, play, SECOND } from "trigscript/cutscene";

async function intro(raider: Unit) {
  const cam = new Camera(raider.x, raider.y);
  await line(units.JimRaynorMarine, "Something's moving out there.", 3 * SECOND);
  const there = start(walk(raider, 1200, 640));      // the walk goes on while the camera follows
  await cam.follow(raider, 2 * SECOND);
  await there;
  await cam.pan(1600, 400, 2 * SECOND);
  await cam.shake(12);
}

program(async () => {
  const raider = first(unitsAt(locations.Base, { owner: P1, type: units.TerranMarine }));
  if (!raider) return;
  const skipped = await play(P1, start(intro(raider)));   // Escape skips the rest of it
  if (skipped) print("Skipped.");
});
```

Everything here is something a trigger can do, done a frame at a time. The camera is
Center View on a location the module keeps for itself, moved to where the camera should
look. A walk is a Move order to another location. A line is the speaker's portrait talking
and the words in the middle of the screen. Places are pixels (32 a tile) from the map's
top left, and times are frames. The camera is that of the player the program runs as.

When a scene is skipped it stops where it was, so put things where it would have left them
when `play` gives true.

| Name | What it does |
| --- | --- |
| `new Camera(x, y)` | A camera, looking at (x, y) at once. |
| `cam.look(x, y)` | Look at a point now. |
| `cam.pan(x, y, time, ease?)` | Glide there over `time` frames; `ease` is `"linear"`, `"in"`, `"out"`, `"inOut"` (the default) or `"back"`. |
| `cam.follow(unit, time)` | Keep a unit in the middle of the screen for `time` frames, or until it is gone. |
| `cam.shake(time, size?)` | Shake for `time` frames, `size` pixels each way (8). |
| `walk(unit, x, y, near?, limit?)` | Send a unit to a point and wait until it is within `near` pixels (48), gone, or `limit` frames (30 seconds) have passed. Gives whether it got there. |
| `charge(unit, x, y, near?, limit?)` | The same with an Attack order: it fights what it meets. |
| `walkAll(group, x, y, near?, limit?)` | A group together. Gives how many got there. |
| `line(speaker, text, time?)` | The speaker's portrait talks and the words show for `time` frames (3 seconds). |
| `play(player, scene, key?)` | Play a scene started as a task, until it ends or the player presses `key` (Escape). Gives whether it was skipped. |

## Fog

`trigscript/fog` draws pictures in the fog of war. The fog is a canvas that starts every
frame dark: what a program lights this frame is what shows this frame. Watch it on the
minimap, where a tile is a pixel. The [Bad Apple!!](trigscript.md#bad-apple) showcase is a
video played this way.

```ts
import { fog } from "trigscript/fog";

const heart = fog.picture([".##.##.", "#######", ".#####.", "..###.."]);

program(async () => {
  fog.reveal(P1);                    // the whole map lit once: from now on, dark is fog and not black
  while (true) {
    const m = first({ owner: P1, type: units.TerranMarine });
    if (m) fog.light(P1, m.x >> 5, m.y >> 5, 3 + ((memory.game.frame >> 3) % 6));   // a disc that pulses round the Marine
    fog.light(P1, 60, 40, heart);    // a picture, its top left on tile (60, 40)
    await nextFrame();
  }
});
```

**How it draws.** A brush is a flying unit made on a tile and taken away in the same
frame; the tiles its sight revealed stay lit through that frame. Its size is the unit's
sight range, so there are eleven brushes, sizes 1 (3 tiles across) to 11 (23 across), each
a flying hero that ordinary maps do not place: Kukulza's Mutalisk and Guardian,
Yggdrasill, the Magellan, Gantrithor, the Hyperion, the Norad II, Tom Kazansky, Danimoth,
Mojo and Artanis. A map that places one of them will see odd sight from it. The game makes
about 800 brushes a frame at most. Tiles count from the map's top left, (0, 0).

There is no dark brush, since the game's sight only ever reveals. To draw dark shapes,
light around them: a picture with `{ ink: "dark" }`. Dark ink is also the sharper one: a
lit part is at least a brush wide, while a dark line one tile wide stays one tile wide.

**What it looks like.** With Classic graphics (Options ▸ Graphics), a tile is one pixel of
the minimap, sharp; Remastered graphics blurs it a few tiles wide. The tiles under the
picture decide how far apart lit and fog look. On Remastered's minimap, plain snow of the
Ice tileset is the brightest board.

| Name | What it does |
| --- | --- |
| `fog.reveal(player)` | Light the whole map once, so dark shows as fog (grey) rather than as never seen (black). Takes a frame. |
| `fog.light(player, x, y, size)` | A disc of `size` 1 to 11, centred on tile (x, y), this frame. |
| `fog.light(player, x, y, picture)` | A picture, its top left on tile (x, y). |
| `fog.light(player, x, y, video, frame)` | Frame `frame` of a video the script imports. |
| `fog.picture(rows, { ink? })` | A picture from rows of text, `#` the ink, made when the script is built. Takes an image's `halftone()` too. |
| `fog.rect(player, x, y, width, height)` | A lit rectangle, all five of which may change every frame: a wall, a bar of a chart. |
| `fog.columns(player, x, y, layout, heights, faces?)` | Columns side by side, each as tall as the program says: the walls of a raycaster, a bar chart. |
| `fog.play(player, video, x?, y?)` | Play a video, a frame of it every frame; resolves at its end. |
| `fog.show(n)` | Keep this frame's picture for `n` frames and wait them out: a picture drawn every other frame at half the cost. |
| `fog.SHAPES` | Each brush's shape, as rows of text. |

The module adds a program of its own, which clears the board every frame, and it takes one
of the map's free locations. Pictures and videos come from files the script imports
([Files the script imports](trigscript-language.md#files-the-script-imports)).

## Screen

`trigscript/screen` is a grid of pixels shown on the map as units, so the minimap shows
the picture: a game of Snake or Tetris played on the minimap, a score in big digits.

```ts
import { Screen, sprite } from "trigscript/screen";

const SHIP = sprite([".1.", "111", "1.1"]);

program(async () => {
  const screen = new Screen(4, 4, 24, 16);   // 24 × 16 pixels, its top left on tile (4, 4)
  screen.reveal(P1);
  let x = 10;
  let score = 0;
  while (true) {
    if (keyHeld(P1, "Left")) x = Math.max(x - 1, 0);
    if (keyHeld(P1, "Right")) x = Math.min(x + 1, 21);
    screen.clear();
    screen.rect(0, 15, 24, 1, 5);            // the ground, in colour 5
    screen.blit(SHIP, x, 12);
    screen.number(score, 1, 1, 2);           // digits 3 × 5 pixels, in colour 2
    screen.present();
    score += 1;
    await nextFrame();
  }
});
```

A pixel is 0 (empty) or a colour from 1 to 7. Drawing changes the grid, and `present()`
shows it: each pixel is a unit on the map, two tiles across, owned by the player whose
colour it is. Only the pixels that changed since the last `present()` are made or taken
away, so a still picture costs nothing to show. Draw through the methods; a pixel written
into the grid directly is not seen.

**What the map needs.**

- The players who own the pixels are, for colours 1 to 7, Players 3, 4, 5, 1, 6, 7 and 8.
  Give each the colour the screen should show (cyan, yellow, purple, green, red, blue,
  orange), and make none of them a computer, since a computer moves its own units.
- StarCraft: Remastered will not start a game without a computer, so make Player 2 a
  computer. It owns no pixel.
- A pixel is an Overlord unless the screen is made with `"solid"`. An Overlord flies, so
  the screen can be over any ground, Space included; the minimap draws each as a dot with
  a gap round it. A `"solid"` pixel is a Pylon, which the minimap draws as its whole
  two-tile footprint, so pixels side by side join into one block; a Pylon needs buildable
  ground and none of the map's own units in the way.
- A player sees the pixels only where they have vision, so call `screen.reveal(player)`
  once, before the first `present()`.

| Name | What it does |
| --- | --- |
| `new Screen(x, y, width, height, look?)` | A screen of `width` × `height` pixels (2 048 at most), its top left on tile (x, y). `look` is `"dots"` (the default) or `"solid"`. |
| `clear(color?)`, `set(x, y, color)`, `get(x, y)` | Fill it, set one pixel, read one. |
| `rect(x, y, width, height, color)`, `line(x0, y0, x1, y1, color)` | A filled rectangle; a line, both ends drawn. |
| `sprite(rows)`, `blit(sprite, x, y)` | A picture from rows of text (`"1"` … `"7"`, anything else see-through), and drawing it. |
| `number(n, x, y, color)` | A whole number's digits, 3 × 5 pixels each. |
| `reveal(player)` | Let a player see the screen. |
| `present()` | Show what was drawn. |
| `<ScreenView screen width height />` | The same grid in a player's text area, one square per pixel, for a `ui.lines` view. |

## Music

`trigscript/music` plays music written as patterns: a note's name per step, held with `-`,
rests with `.`. Everything is made when the script is built. Each note an instrument plays
becomes a sound once, and a song becomes a table of which sound starts on which frame.

```ts
import { music } from "trigscript/music";

const lead = music.presets.chip();
const bass = music.presets.bass();
const drums = music.drums();

const song = music.song({ bpm: 120 },
  music.track(lead, "C5 - E5 - G5 - - . | A5 - G5 - E5 - - ."),
  music.track(bass, "C3 - - - - - - - | F3 - - - - - - -"),
  music.track(drums, "kh h sh h kh h sh h | kh h sh h kh kh sh h"),
);

program(async () => {
  start(music.loop(song));                // the song again and again, beside the program
  playWav(lead.note("C6", 0.1), 0);       // an instrument's note on its own, as a sound effect
});
```

**Patterns.** A step is a word, a quarter of a beat unless the song says otherwise. A
note's name starts a note (`C4`, `F#5`, `Bb2`); notes joined by `+` sound together
(`C4+E4+G4`); `-` holds what sounds a step longer; `.` is a rest; `|` is only for the eye.
`@` after a step's notes says how loud (`C4@0.5`). A drum kit's step is its sounds'
letters: `kh` is the kick and the hat together.

**Instruments.** `music.synth` makes notes from waves, `music.fmSynth` by FM, and
`music.strings` plucks them; `music.sampler` plays a recording of one note at every pitch,
from a sound file the script imports. `music.presets` has instruments to start from:
`supersaw`, `pad`, `bass`, `acid`, `lead`, `chip`, `keys`, `bell` and `pluck`.
`music.drums()` is a kit made from nothing, a letter a drum: k kick, s snare, c clap, h
closed hat, o open hat, t tom, r rim and x crash. `music.kit` makes one from clips of your
own.

**Longer songs** are written in sections. Parts are named once, and each section says what
they play in it; a pattern shorter than its section plays again until the section is full.
Chords are written by name, with a template that says how their notes are played:

```ts
import { music } from "trigscript/music";

const parts = {
  keys: music.part(music.presets.keys()),
  bass: music.part(music.presets.bass()),
  drums: music.part(music.drums()),
};
const verse = music.section(4, {
  keys: music.chords("Am F C G", "1+2+3 - . 1+2+3 . . 1+2+3 -", { octave: 4 }),
  bass: music.chords("Am F C G", "1 - . 1 . 1 3 -", { octave: 2 }),
  drums: music.beat({ k: [0, 3, 4], s: [2, 6], h: [0, 1, 2, 3, 4, 5, 6, 7] }, 8),
}, { name: "verse" });
const song = music.arrange({ bpm: 120, steps: 2 }, parts, verse, verse.with({ keys: null }));

program(async () => {
  await music.play(song);
  print("The song is over.");
});
```

**Music that follows the game.** `music.stems` cuts a song of sections into a sound for
each bar of each layer, and `music.conduct` plays them as a `Band` says: which section,
which layers, and a stinger on the next beat.

```ts
import { music, Band } from "trigscript/music";

const parts = { keys: music.part(music.presets.keys()), drums: music.part(music.drums()) };
const calm = music.section(2, { keys: music.chords("Am F", "1+2+3 - - -", { octave: 4 }) }, { name: "calm" });
const fight = music.section(2, {
  keys: music.chords("Am F", "1+2+3 . 1+2+3 .", { octave: 4 }),
  drums: music.beat({ k: [0, 4], s: [2, 6], h: [0, 1, 2, 3, 4, 5, 6, 7] }, 8),
}, { name: "fight" });
const cut = music.stems(music.arrange({ bpm: 120, steps: 2 }, parts, calm, fight), {
  layers: { drums: ["drums"], keys: ["keys"] },
});

program(async () => {
  const band = new Band();
  band.loop = true;                                 // a section plays again until told otherwise
  start(music.conduct(cut, band));
  await until(bring(P8, units.AnyUnit, locations.Base, ">=", 1));
  band.go(cut.section("fight"));                    // from the next bar
});
```

**What the game does with it.** A bar lasts a whole number of frames (42 ms each at
Fastest), so the tempo is the nearest that fits, and `song.bpm` says which. A sound starts
within 21 ms of its frame. The game plays 32 sounds at once, and a song that would need
more is refused. Notes that overlap add up with no limiter, so keep volumes down.
`music.render(song)` mixes a song into one sound when the script is built instead: every
note exactly in time and only one sound playing, but nothing can change while it plays. A
program plays to its own player; a per-player program plays to each.

**Played music.** `music.perform` plays music as a person plays it rather than on a grid:
each part written as a score has it, with its own note lengths, dynamics and the sustain
pedal, at a tempo that can move. A note is its name and octave, then its length after `/`
(`E5/16` a sixteenth, `A4/8.` a dotted eighth, `16t` a triplet's), the last length when
left out. `pp` to `ff` set how hard what follows is struck and `<` and `>` move there
evenly; `r` is a rest; `ped` puts the pedal down and `*` lifts it; `|` is a bar line, and
a bar too long or too short is refused. A list of texts is a text a bar. `tempo` is
`[bar, bpm]` points the tempo moves between, and `humanize` adds a player's unevenness,
the same on every build.

```ts
import { music } from "trigscript/music";

const take = music.perform({ meter: "3/8", bpm: 132, pickup: "1/8", tempo: [[1, 132], [2, 112]] }, {
  right: { instrument: music.presets.keys(), notes: ["pp E5/16 D#5", "E5 D#5 E5 B4 D5 C5", "A4/8 r/16 C4 E4 A4"] },
  left: { instrument: music.presets.keys(), notes: ["r/8", "r/4.", "A2/16 E3 A3 r/16 r/8"] },
});
const piece = music.render(take, { reverb: { decay: 0.85 }, loudness: -16 });

program(async () => {
  playWav(piece, 0);
});
```

What `perform` gives back also says when each note is struck, how hard, by which part and
on which frame (`take.notes`), and where each bar begins (`take.bars`): what a picture
that follows the music needs. `music.excerpt(take, from, to)` is a span of bars as a
performance of its own, to render a long piece a section at a time.
`music.render(take, { parts: [...] })` mixes only some parts, so a melody can be mixed
apart from what is under it and the rest ducked under it with `Clip.duck`.

**Recordings as instruments.** `music.sampled` plays an instrument made of recordings:
each note from the recording made nearest its key, and of those, the one made at the
note's strength, so a soft note is a soft recording and not a loud one turned down. A note
let go dies away and the instrument's release sound plays; in a performance the sustain
pedal holds notes and makes its own sound, and with `resonance` the strings ring with the
pedal down. In a pattern, `@` picks the strength. The recordings come from a `.samples`
file the script imports (`import piano from "./piano.samples"`), made from an SFZ
instrument by `scripts/make-samples.mts` in the [TrigScript
repository](https://github.com/scm-js/plugin-trigscript), or from clips the script already
has with `samples()`, one zone a clip at the key it was recorded at:

```ts
import { music } from "trigscript/music";

// Three clips of a bell, recorded at C3, C4 and C5: each note is played by the nearest.
const bell = (key: string) => music.presets.bell().note(key, 2);
const bells = music.sampled(samples([
  { clip: bell("C3"), key: "C3" },
  { clip: bell("C4"), key: "C4" },
  { clip: bell("C5"), key: "C5" },
]));
const tune = music.song({ bpm: 100 }, music.track(bells, "C4 - E4 - G4 - C5@0.5 - - -"));

program(async () => {
  await music.play(tune);
});
```

A whole sampled piano is far too large for a map: the Salamander Grand Piano used by the
[Für Elise](trigscript.md#für-elise) showcase is 140 MB of recordings. Only the notes the
script plays reach the map, mixed into the sounds it makes.

| Name | What it is |
| --- | --- |
| `synth(options)`, `fmSynth(options)`, `strings(options)`, `sampler(clip, root?)` | Instruments. `instrument.note(name, seconds)` is one note as a sound. |
| `sampled(samples, options?)`, `samples(zones)` | An instrument of recordings, from a `.samples` file or from clips. Options: `volume`, `release`, `releases`, `resonance`, `ring`, `transpose`, `velocity`. |
| `hits(clips)` | An instrument of one-shots, a clip a key, for percussion and effects in a performance. |
| `presets.supersaw()` … `presets.pluck()` | Instruments to start from, each taking the options of what it is made with: also `trance`, `arp`, `stab`, `pulse`, `sub` and `braam`. |
| `drums(options?)`, `kit(hits)` | Drum kits: one made from nothing, or one from a clip per letter. |
| `track(instrument, pattern, options?)`, `song(options, ...tracks)` | A pattern for an instrument, and tracks played together. Options: `pan`, `volume`, `fx`, `reverb`; `bpm`, `steps`, `beats`, `swing`. |
| `part(instrument, options?)`, `section(bars, parts, options?)`, `arrange(options, parts, ...sections)` | A song in sections. `section.with({ … })` is a section with some parts changed, `null` resting one. |
| `chord(symbol, octave?)`, `chords(progression, template, options?)`, `over(notes, template)` | Chords by name, and a template that plays them. |
| `beat(hits, steps?)` | A drum bar from the steps each letter plays on. |
| `transpose(p, semitones)`, `stretch(p, by)`, `repeat(p, n)` | Patterns changed. |
| `midi(notes, parts, options?)` | A song from a MIDI file the script imports. |
| `perform(options, parts)`, `excerpt(performance, from, to?)` | Music played as written in a score, and a span of its bars. |
| `riser(seconds)`, `sweep(seconds, options?)`, `impact()`, `pump(beat)` | A rise into a drop, a filtered noise sweep up or down, a boom to land on, and a pumping effect. |
| `render(song, options?)` | A song or a performance mixed into one sound when the script is built. Options: `reverb`, `master`, `limit`, `loudness`, `parts`. |
| `play(song)`, `loop(song)` | Play a song note by note, once or again and again. |
| `stems(song, options)`, `new Band()`, `conduct(stems, band)` | Music that follows the game: `band.go`, `queue`, `mute`, `unmute`, `sting`, `stop`. |

## Workers

`trigscript/workers` puts new workers to work. A worker rallied to a mineral field
normally walks to it and stands there; with this module it starts mining as soon as it
comes out.

```ts
import { buildAutoMiningProgram } from "trigscript/workers";

buildAutoMiningProgram();   // at the top of the script: on for the whole game
```

For every human player, a newly trained SCV or Probe, or a Drone hatched from a Larva,
looks at where its producer's rally point is:

- On a mineral field, it mines that field.
- On a finished Refinery, Extractor or Assimilator of its own player, it gathers gas from
  it.
- Anywhere else, it walks to the rally point as it always has: the ground, a bare geyser,
  a gas building still being made, or another player's.

It acts once, as the worker comes out, so an order the player gives afterward stands.
Computer players' workers and units made by Create Unit are left alone. A field or a gas
building that is already busy is the game's to sort out, as it is when the player
right-clicks it.

**Where the call goes.** `buildAutoMiningProgram()` makes a program, and programs are made
when the map is built, so the call goes at the top of a script, outside `program()`.
Inside `program()` or a listener, the script does not build. Once is enough: a second
call, in the same file or another, adds nothing.

The order it gives is `u.gather(target)`, which a program of your own can give too ([What
a unit can be told](trigscript-language.md#what-a-unit-can-be-told)).

| Name | What it does |
| --- | --- |
| `buildAutoMiningProgram()` | Turn auto-mining on for the whole game. At the top of a script only. |

## Spells

`trigscript/spells` lets a Medic cast Restoration on its own. A unit hit by Lockdown or
Plague near an idle Medic is restored without the player clicking anything.

```ts
import { buildAutoRestoreProgram } from "trigscript/spells";

buildAutoRestoreProgram({ keepEnergy: 25 });   // at the top of the script: on for the whole game
```

A human player's Medic that stands idle, or is healing on its own after standing idle,
casts Restoration on a unit within the spell's range that has Lockdown, Irradiate, Plague,
Ensnare, Maelstrom, Acid Spores or Optical Flare. The unit is its owner's or belongs to a
player its owner is allied with.

- **It is a real cast.** The owner must have researched Restoration, and the Medic must
  have the spell's energy, plus `keepEnergy` more when that is given. The cast looks and
  costs what a player's does.
- **One Medic to a unit.** The nearest Medic goes to the nearest afflicted unit. A Medic
  never walks to reach one: if the unit moves out of range before the cast starts, the
  Medic stops.
- **The player's orders come first.** A Medic that is moving, attack-moving, holding,
  patrolling or casting because the player told it to is never used.
- **Left alone:** a unit with only Parasite, a unit in stasis or invincible, a
  hallucination (Restoration would kill it), and the Medic itself. Computer players'
  Medics are left to the computer, which casts Restoration itself.

**Tied to a switch.** With `switch`, auto-restore runs only while that switch of the map
is set, so a campaign map can give it to the player partway through:

```ts
import { buildAutoRestoreProgram } from "trigscript/spells";

buildAutoRestoreProgram({ switch: "Switch 1" });
```

**Letting the player turn it off.** With `allowPlayersToTurnOffAutoCast: true`, the player
turns auto-restore off and on again by right-clicking the Restore button on a Medic's
command card, as auto-cast works in StarCraft II. The player is told "Auto-restore off" or
"Auto-restore on". It starts on, and one setting covers all of that player's Medics,
including ones trained later. While the map's switch is cleared, a right-click on Restore
does nothing and the setting is kept for when the switch is set again.

```ts
import { buildAutoRestoreProgram } from "trigscript/spells";

buildAutoRestoreProgram({ switch: "Switch 1", allowPlayersToTurnOffAutoCast: true });
```

This option is for single-player maps. The right-click is read with
[`trigscript/card`](#command-card), so what that module asks of the map applies: it takes
one of the map's free locations, and the view moves to the middle of the map and back once
in the first second of the game.

**Where the call goes.** `buildAutoRestoreProgram()` makes a program, and programs are
made when the map is built, so the call goes at the top of a script, outside `program()`.
Once is enough: a second call, in the same file or another, adds nothing.

| Name | What it does |
| --- | --- |
| `buildAutoRestoreProgram(options?)` | Turn auto-restore on. Options: `switch` (a switch's name; it runs only while that switch is set), `keepEnergy` (energy a Medic keeps after casting, 0 when left out) and `allowPlayersToTurnOffAutoCast` (a single-player map's player turns it off and on by right-clicking Restore). At the top of a script only. |

## Command card

`trigscript/card` tells a program when the player right-clicks a button on the command
card. In the game, a right-click on a card button does nothing, so a map can give it a
meaning of its own, such as turning an ability's auto-cast off and on.

```ts
import { CardButton, cardSlots } from "trigscript/card";

program(async () => {
  if (!isHuman(CurrentPlayer)) return;
  const restore = new CardButton(techs.Restoration, cardSlots.Restoration);
  await restore.begin();
  let on = true;
  while (true) {
    if (await restore.rightClicked()) {
      on = !on;
      print(on ? "Restore: on" : "Restore: off", { to: CurrentPlayer });
    }
    await nextFrame();
  }
}, { owner: AllPlayers });
```

**Single-player maps only.** Make the button in a program run for the human player, as
above. Call `begin()` once before the program's loop, and `rightClicked()` once on every
pass of it. `rightClicked()` is true on one pass for each right-click on the button.

**What counts as a right-click on the button.** The game keeps no record of which button a
right-click landed on, so the module checks where the mouse was when the right button went
down against where the button is drawn. It counts only while the card shows the buttons of
the units that have the ability: for Restoration, one Medic or several Medics selected on
their own. With a Marine in the selection the card shows another set of buttons, and while
a targeting cursor is up it shows Cancel, so a right-click then does not count.

The ability says which card to look for and the slot says where its button is. `cardSlots`
names the nine places on the card, `topLeft` to `bottomRight`, and each ability's own
place: `cardSlots.Restoration` is `bottomMiddle`. Restoration is the only ability the
module knows the card for so far; a button made for any other never counts.

**Classic or Remastered graphics.** The card sits against the right edge of the game
screen, and where that edge is depends on the graphics. Classic graphics draws the game
640 pixels wide; Remastered graphics draws it as wide as the shape of the display. No
value in the game says which graphics are on, so `begin()` finds out by moving the view:
at the start of the game the view centers on the middle of the map, the module reads where
the camera stopped, and the view goes back to where it was. The player sees this as a
quick move to the middle of the map and back. Nothing else should move the view while it
happens. After that, a click on the minimap and the camera going further right than
Remastered graphics allows keep it current when the player changes graphics in the middle
of a game. On a map smaller than 32 × 32 tiles the view is not moved and the graphics stay
unknown. While they are unknown, a right-click on the button's place in either layout
counts.

**An opening scene.** `cardSetup` goes at the top of the script, before any `CardButton`
is made. With `afterCalibration`, the view is not sent back once the measuring is done:
the function runs instead, which is where an opening cinematic can start.
`showMeasurements: true` prints each step of the measuring, and each right-click the
button checks, as numbered `#1 card: …` lines, for finding out why a click did not count.

```ts
import { CardButton, cardSetup, cardSlots } from "trigscript/card";

cardSetup({ afterCalibration: () => print("The briefing starts here."), showMeasurements: true });

program(async () => {
  if (!isHuman(CurrentPlayer)) return;
  const restore = new CardButton(techs.Restoration, cardSlots.Restoration);
  await restore.begin();
  while (true) {
    if (await restore.rightClicked()) print("Restore was right-clicked.", { to: CurrentPlayer });
    await nextFrame();
  }
}, { owner: AllPlayers });
```

**What the map needs.** The module takes one of the map's first 63 locations that the map
does not use, to center the view on.

| Name | What it does |
| --- | --- |
| `new CardButton(tech, slot)` | A button of the command card, watched for a right-click: the ability whose card it is on, and its place on the card. |
| `await button.begin()` | Before the program's loop: records where the view starts and begins measuring the screen. |
| `await button.rightClicked()` | On every pass of the loop: whether the player right-clicked the button since the last time it said so. |
| `cardSlots` | The nine places on the card (`topLeft`, `topMiddle`, `topRight`, `middleLeft`, `center`, `middleRight`, `bottomLeft`, `bottomMiddle`, `bottomRight`), and `Restoration`, Restore's own place. |
| `cardSetup(options)` | At the top of the script: `afterCalibration` runs once the measuring is done, in place of sending the view back; `showMeasurements` prints each step. |

## Libraries from other plugins

A plugin can provide a library of its own: TrigScript modules a script imports by the
library's name, as it imports the standard library by `trigscript/…`.
`import { spawnWave } from "waves/spawn"` is the module `spawn` of the library `waves`,
and `import { spawnWave } from "waves"` is its `index`. While the plugin is on, the editor
completes the library's names, and hovering one shows the library's own source and
comments.

```ts
import { announce, spawnWave } from "waves";

program(() => {
  for (let wave = 1; wave <= 5; wave++) {
    announce(`Wave ${wave}`);
    spawnWave(P2, units.ZergZergling, wave, locations.Spawn);
    sleep(seconds(20));
  }
});
```

**The map keeps its own copy.** When the script is applied, which saving does, each
library the script imports is copied into the map beside the script's files, and from then
on the map builds with that copy. So a map opened where the plugin is not installed still
builds, and so does a map shared with someone who has another version of the plugin. A
library the script stops importing leaves the map at the next apply.

**A newer version is offered, not taken.** When the installed plugin has a different
version of a library from the map's copy, the editor says so and offers *Update*, which
replaces the copy. *Keep the map's copy* leaves it as it is.

A library is TrigScript, like the script's own files, and runs with the same rights: a
library in someone else's map is no different from that map's own script. A module joins
the build only when something imports it.

**Making a library** for your own maps means writing a plugin that provides the modules.
The [TrigScript plugin's
README](https://github.com/scm-js/plugin-trigscript#providing-a-library) explains how, and
[Plugins](plugins.md) covers writing a plugin.
