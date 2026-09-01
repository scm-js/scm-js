# Trigger scripting

The Script Editor (Triggers ▸ Script Editor) holds one TypeScript file per map and
turns it into a block of ordinary triggers. There is no EUD trickery involved: what
it produces runs on any version of the game.

The editor is Monaco with a `.d.ts` generated from the open map, so `Locations.`,
`Switches.`, `Units.` and `Players.` complete to what your map actually has, and a
location passed where a unit belongs is a type error before you build.

## Two levels

**Raw** is a typed spelling of the trigger list: one `trigger()` call per trigger,
with the same argument order as the text trigger editor.

```ts
const beacon = Bring(CurrentPlayer, Units.AnyUnit, Locations["Beacon Alpha"], "At least", 1);

trigger([P1, Players.Force2], [beacon, Switch(Switches.DoorOpen, "set")], [
  DisplayText("Always Display", "You found it!"),
  SetDeaths(P1, Units.TerranMarine, "Add", 5),
  disabled(SetSwitch(Switches.DoorOpen, "toggle")),
  PreserveTrigger(),
], ["Preserve"]);
```

**Structured** is everything else at the top level: variables, `if`, loops,
functions. It compiles to a state machine built out of death counters.

```ts
program({ owner: P8, hyperTriggers: true });   // optional; defaults: P1, no hyper triggers

let wave = 0;
let alarm = false;

function spawn(count: number) {
  CreateUnit(P2, Units.ZergZergling, count, Locations.Spawn);
  wave += 1;
}

while (true) {
  if (Bring(P1, Units.AnyUnit, Locations.Beacon, ">=", 1) && !alarm) {
    alarm = true;
    DisplayText("Always Display", "They are coming.");
  }
  if (alarm) spawn(4);
  if (wave >= 10 || Deaths(P1, Units.TerranMarine, ">=", 50)) { Defeat(); }
  Wait(2000);
}
```

Raw triggers are emitted first, then the program's, then hyper triggers if you asked
for them.

## What the values are

Every argument must be a compile-time constant: a literal, a `const`, arithmetic on
constants, a template string, an array spread. Raw numbers are accepted wherever a
name is, which is how you reach EUD players and out-of-range unit ids. Types the
tables do not know can be written as `Condition(type, …)` or `Action(type, …)`.

Names come from the map. `identifier()` derives an identifier from each display name
(`Terran Marine` becomes `Units.TerranMarine`), and the display name itself still
works as an index (`Units["Terran Marine"]`), as do custom names the map sets.

The generated declarations are `noLib`: there is no `Math`, no `Array.prototype`,
nothing but the trigger vocabulary and a dozen types TypeScript insists on.

## How the structured level works

**Variables are death counters.** A `let n = 0` takes a death counter on a unit that
can never die (the "(Unused)" entries of units.dat, Cantina first), twelve players per
unit, so there are hundreds available. A `let f = false` takes a switch. Values are
unsigned 32-bit and `-=` saturates at 0.

Cost matters here. `n += 5`, `n = 3` and `n++` are one action each. An operation
between two variables (`a += b`, `a = b`, `a < b`) is the classic binary
decomposition and costs about 64 triggers, so keep those out of hot loops. There is
no multiplication or division between variables, because the game has no instruction
for it; `*`, `/` and `%` work on constants.

**Control flow is a program counter.** Each basic block is a run of preserved
triggers testing `pc == S`, in list order, so straight-line code runs inside a single
trigger cycle and only a loop's back edge waits for the next one. `while (true) { … }`
is therefore a game loop running once per cycle: roughly every 2 s at Normal speed,
or every frame with `hyperTriggers: true`.

`if`/`else`, `while`, `do`, `for`, `break` and `continue` all work. `&&`, `||` and `!`
are lowered to disjunctive normal form, one trigger per product, with negation folded
into the comparison where the game can express it (`!Bring(…, ">=", 1)` becomes "at
most 0") and a skip trigger where it cannot (`!CommandTheMost(…)`).

**Functions are inlined** at every call site. A parameter binds to a constant, or, if
the argument is a variable, to that variable by reference. `return` works; return
*values* do not. Locals get their own storage per call site.

**The program is one thread running as one player**, the `owner`. It runs only while
that player is in the game, and `CurrentPlayer` means that player. Trigger conditions
(`Bring`, `Switch`, …) can be used in `if` and `while` directly. `random()` is a
randomized switch.

Every generated trigger carries a `Comment` naming its source line (`L18: cycles++`),
which is what the classic Trigger Editor shows as the trigger's title. Pass
`comments: false` to drop them. The allocator avoids every death counter and switch
the map's hand-made triggers touch, and the toolbar's program summary lists where each
variable lives.

For EUD work the raw level offers `Memory(address, comparison, value)` and
`SetMemory(address, modifier, value)`, the standard `Deaths`-at-`EPD(address)` forms.

## Build, and living beside hand-made triggers

**Build** compiles the script and installs its triggers as one contiguous block of the
map's trigger list, replacing the previous block or appending the first one.

The classic Trigger Editor shows those triggers with a `script` badge and will not
edit them; "Open Script Editor" jumps to the source line. The text editor fences them
in comments. Hand-made triggers around the block are left alone, and inserting one
before the block just moves it, since the block is found by content rather than
position.

Editing a generated trigger from outside makes the block *stale*: it reverts to
ordinary triggers, and the next Build appends a fresh block. **Import map triggers**
goes the other way, rewriting the hand-made triggers as script in their existing order
around the block, so the whole list becomes script-generated.

The source and a build manifest live in the map archive itself, as `scmjs\triggers.ts`
and `scmjs\triggers.json` next to `staredit\scenario.chk`, so they travel with the
`.scx`. Edits are saved as you type; only Build changes triggers.

## Simulate

**Simulate** runs the compiled triggers for thirty cycles in a built-in trigger-cycle
interpreter and lists every action that ran, with its cycle and source line, plus each
variable's final value.

It models the things the compiler relies on: death counters, switches, preserve, list
order, wrapping addition and saturating subtraction. Unit conditions answer "false".
The same interpreter is what the test suite uses to prove programs behave.

## Implementation

`src/script/` holds the whole thing: `names.ts` and `declarations.ts` generate the
`.d.ts`, `compiler.ts` walks the script's AST against a real `ts.createProgram`,
`structured.ts` walks statements into `lower.ts`'s state machine, `simulate.ts` is the
interpreter and `print.ts` is the inverse for raw records. `src/editor/script.ts`
handles the archive members and the block manifest. `monaco.ts` is loaded on demand,
and compilation happens in a worker.
