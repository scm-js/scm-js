# Triggers

### Triggers (`src/formats/chk/sections/triggers.ts`, `src/data/triggerDefs.ts`, `src/formats/triggers/text.ts`, `src/editor/triggers.ts`)

`scenario.triggers` is TRIG and `scenario.briefing` MBRF — the same 2400-byte record (16 × 20-byte
conditions, 64 × 32-byte actions, flags, 27 player-group bytes, the game's current-action byte),
differing only in what the type bytes mean. Records stay close to the bytes: every field is a
number and `triggerDefs.ts` says which field holds which argument for each type (`ArgDef { kind,
field, label }`, argument order = SCMDraft's TrigEdit). Everything that shows a trigger — the Classic
editor's widgets, the text printer/parser, later the script API's typings — reads that table; the
codec knows no types. Decoding drops only *trailing* empty condition/action slots, so anything after
a type-0 entry survives; encoding pads back to 16/64. `switchNames` is SWNM (null when absent).
`UnitClass` — the unit ids past units.dat — is Any unit 229, Men 230, Buildings 231, Factories 232; 228 is the
game's "None". One too low is an easy mistake that only reading a Blizzard map's stock triggers shows ("commands at
most 0 Factories" is the tell); a test on a real map's melee triggers is the guard.

`BRIEFING_ACTION_DEFS` puts the portrait slot in `player` (the first group): Blizzard's own maps
say so — `fixtures/maps/(6)Ground Zero.scm` and `(4)Spring Thaw.scx` (gitignored copies from the
install's Maps folder) carry briefings, and `tests/briefing.test.ts` decodes, round-trips through
the text format and re-encodes them; StarEdit sets hint bits (0x04 and the unit-type hints) on every
briefing action that text cannot carry, so that test masks them. `editor/triggers.ts#actionStrings`
is the one walker over an action's text / WAV arguments (the String Editor's usage list, the Sound
Editor and Find all read it). The Text Trigger Editor is the **TrigEdit plugin** (`github.com/scm-js/plugin-trigedit`, a
default that starts off, pinned in `defaults.ts`; Ctrl+Shift+T is its, so the hotkey is dead until it is
ticked on, while Import / Export Triggers are the editor's and are not) over `api.triggers.text` / `tx.triggers.fromText({ replace })`; it
is a plugin because the growth it wants — highlighting, completion, Monaco — is exactly what the editor does not bundle,
and the format is here because Import / Export, the plugin API and the AI all read it. Its Briefing mode edits MBRF in
the same syntax. `api.triggers.claims(list?)` is what it fences the generated runs with, and its dialog offers the
`"trigedit.text"` slot (`DialogSpec.slot`); the scmjs.dev plugin's Explain / Write / Ask buttons register there.
`DialogId` has no `textTriggerEditor` — taking it out was the one non-additive change to the typings, with no consumer
outside the organisation.
The Classic editor's player pick carries an EPD box (`epdOf` / `addressOfEpd` over
`DEATHS_TABLE_ADDRESS`) for EUD work.

`docs/triggers.md` is the trigger reference (a docs-site guide, one page per condition and action).
Its tables — each entry's number, text form and argument byte offsets, the player groups, the
argument values, the record layout — are blocks between `<!-- generated: KEY -->` markers that
`scripts/lib/trigger-reference.mjs` writes from this file's tables (`npm run docs:reference`; the
script loads the `.ts` in plain Node through `scripts/lib/load-ts.mjs`, two resolve hooks for
extensionless and JSON imports). `tests/triggerReference.test.ts` fails when a block is stale, when
a def has no page, when an offset in the generator's `CONDITION_FIELDS` / `ACTION_FIELDS` is not
where the codec writes the field, and when a ```` ```trigedit ```` example does not parse. So a
change to `triggerDefs.ts` means `npm run docs:reference`, and a new condition or action means a
page. The prose is hand-written and states only what is settled: the melee triggers are from
Blizzard's maps, Set Deaths' wrap/saturate is TrigScript's tested number contract, and details
nobody here has verified (Remove Unit and death counts, Move Location with no unit, command-the-most
ties) are deliberately left out rather than guessed.

The text format (`formats/triggers/text.ts`) resolves names through a `TriggerNames` context
(`triggerNames(scn)` in `editor/triggers.ts`) so it is testable without a scenario; unknown names
print as bare numbers and parse back, unknown types print as `Condition N(...)` / `Action N(...)`.
The one thing text cannot carry is the `UnitTypeUsed` hint bit (0x10) — Blizzard's own maps disagree
about it — so `tests/trigger.test.ts` masks the hint bits in its fixture round trip. The parser
calls `intern` as it reads each text / WAV argument, and `triggerNames(scn).intern` appends to the
map's string table there and then. That is not harmless: a text
with a mistake on a later line has already added the strings of the lines before it, and Import
Triggers parses when the file is picked, before Import is pressed — either way the strings stay,
marked dirty (so saved), with no entry on the undo stack until some later table commit sweeps them
into its own. **Nothing parses text through `triggerNames`**: `parseTriggerText(scn, text,
briefing, drafts)` (`editor/triggers.ts`) parses through the draft names below and
`resolveDraftStrings` adds the strings once the triggers are going in. `triggersFromText` /
`readTriggerFile` (`editor/exchange.ts`) resolve at once unless handed a `drafts` (the dialog hands
one, and resolves in `apply`); `tx.triggers.fromText` resolves inside `withStrings`; and
`api.triggers.text.parse` still answers real indices on success — TrigEdit, Magenta and the scmjs.dev
tools apply what it returns — but adds nothing when it throws. `tests/exchange.test.ts`,
`tests/plugins.test.ts` ("adds no string…").
The Classic editor and Mission Briefing intern at every keystroke of a text, WAV or comment field, so
they edit through `draftTriggerNames` (`editor/triggers.ts`): a string the map lacks gets a *negative*
draft index held in the dialog (`StringDrafts`), and `resolveDraftStrings` interns the ones the list
still refers to on OK / Apply, handing the resolved list back as the working copy. Through
`triggerNames` every prefix typed would be appended to the map's STR for good, Cancel or not. A working copy can therefore hold negative `text` / `wav` values; nothing else may
read one as a string index without those names. `tests/triggerDrafts.test.ts`. Trigger dialogs are settings-style
transactions: `useScenarioForm(scenario, readTriggers)` → `applyTriggers` (marks `TRIG` only on a
real change) → `commitTriggersAtom` (`triggersRevisionAtom`), which records the OK as one history entry
(`clipboard.md`, "Dialog undo"); the working copy inside an open dialog is not in the undo model.
`newCondition` / `newAction` seed StarEdit-like defaults.
**The list on a big map.** Every keystroke in a comment or argument renders `TriggerListEditor`,
so calling `summarizeTrigger` for every row on every render formats 3,000 triggers per key. `useSummaries` keeps each summary in a `WeakMap` by record (an edit replaces the
one trigger it touches; `list.map` leaves the rest the same objects), dropped whenever `names`
changes, and the row is a `memo` component (`TriggerRow`) given the summary and plain strings, so
an untouched row is not rendered again; the filter box reads the same cache (`search`). The String
Editor's rows are `StringRow`, memoised likewise — each parses its text for colour codes. Measured
in headless Chrome on a dev build, 3,000 triggers and 6,000 strings: a key in the comment field
33 ms (84 uncached), a key in a string 33 ms (167 unmemoised), the floor of that measurement being about a frame.
Every row is still in the DOM (opening is ~0.5 s at that size); windowing is the next step if
that matters, and the trigger rows' variable height is what makes it more than a few lines.
**Caching the serialised map is not worth it**: `serializeScenario` with TRIG,
STR, UNIT, MTXM, TILE and ISOM all dirty on a 256×256 map with 3,000 triggers takes 2.6 ms, and
the callers are the save plan and the recovery pass — nothing to win, and a stale cache there is
a lost edit.

### Trigger claims, and the TrigScript plugin

The trigger scripting language — its compiler, simulator and Monaco dialog — is the **TrigScript**
plugin (`github.com/scm-js/plugin-trigscript`, a default that ships on, pinned in `defaults.ts`), not the
editor, so the editor does not bundle Monaco and a second TypeScript (~14 MB of the desktop download;
those chunks weigh 18 MB). The script is ordinary TypeScript that *runs* when built (files, imports,
helpers, the standard library), recording one trigger per `trigger()` call, and only `program(() => …)`
bodies are compiled — into an IR that TrigScript's own build writes into the saved map
(Remastered only). Its README documents the
language and its internals. What stays here is generic:

- `api.triggers.claim(spec)` (`host.ts`, `pluginTriggerClaimsAtom`, `plugins/claims.ts`): a plugin
  names a run of the trigger list it generates, found by *content* — `spec.locate(list)` is asked
  with whatever list an editor holds, since the Classic editor works on a working copy with local
  inserts — and `TriggerListEditor` badges and locks those rows (`claimBadge`, `claimDescription`,
  `spec.open` as the button), inserts after the run rather than into it, `textOf` in the Text
  Trigger Editor fences every located run in comments, and Import Triggers' replace hint lists
  them. `commitTriggersAtom` relocates nothing: the plugin listens to `"triggers"` and
  rewrites its manifest itself. `tests/plugins.test.ts` covers locate/clamp/throw/refresh/dispose.
- The `"commands"` event (`EVENT_ATOMS.commands` = `pluginCommandsAtom`) is how a plugin that calls
  another's commands by id (the scmjs.dev plugin's AI → `trigscript.compile` / `.build` / `.declarations` /
  `.state` / `.print` / `.simulate` / `.triggerAt` / `.open`) learns they arrived — there is
  deliberately no plugin ordering, so `commands.has` at call time is the contract.
- `api.services` (`pluginServicesAtom`, `host.ts`, the `"services"` event) is the stateful counterpart
  of commands: a plugin `provide`s one live object under a namespaced name (`qualifyCommand` rules)
  and consumers `get` / `has` / `watch` it — `watch` fires at once with what is there and on every
  change of provider, so activation order does not matter, as with `"commands"`. The editor never
  reads the object; its shape is a `contract.d.ts` in the provider's repository. The scmjs.dev plugin
  (`github.com/scm-js/plugin-scmjs-dev`) provides `scmjs-dev.account`; the AI features live in that plugin,
  so nothing in the organisation consumes it, and it stays provided for a third party's plugin. A plugin item whose top menu does not exist gets a top-level menu of its own before Help
  (`withPluginItems`; `MenuPath` accepts any string for it).
- `DialogSpec.keepOpenOnEscape(target)` lets a plugin dialog keep Escape for something inside it
  (Monaco's popups); `PluginDialog` routes it to `DialogFrame.onEscapeKeyDown`.
- `editor/save.ts` keeps `SCRIPT_FOLDER` / `SCRIPT_MEMBER` / `MANIFEST_MEMBER` (`trigscript\\`, its
  `main.ts` and `build.json`) so the Save dialog can say what leaving the plugin's members out means
  (`extraKind` → "script" for anything under the folder) and so `referencedMembers` can probe a
  listfile-less archive for the entry file and manifest; `scriptMembersFromManifest` reads the
  manifest's `files` list and `readMembers`' second pass (`more`) probes those too — the one thing the
  editor reads out of the plugin's members.
- `data/triggerDefs.ts#DEATHS_TABLE_ADDRESS` is the EPD base the Classic editor's player pick uses
  (the plugin's compiler carries its own copy). `editor/triggers.ts` holds `epdOf` / `addressOfEpd`
  (the Classic editor re-exports them), `fingerprintTrigger` (FNV-1a over the numbers, bookkeeping
  bits masked) and `triggerUsage` (every cell and switch a list touches, `playerSlotsOf` expanding
  the groups the way TrigScript's `reserve` does); `api.triggers.epd / addressOf / fingerprint /
  usage` and `consts.triggers.maskedRecord` (0x4353, Remastered's masked-record word) expose them,
  for the Magenta plugin (`github.com/scm-js/plugin-magenta`), which carries
  its own pure copies so its tests run without the editor. An EPD formula with `+ 0x2000` is
  wrong; `epdOf` does not add it.
- TypeScript stays a runtime dependency for one job: `plugins/transpile.worker.ts` +
  `transpileClient.ts` turn a `.ts` plugin into JavaScript for the loader (idle-terminated after
  `WORKER_IDLE_MS`, main-thread fallback when the worker cannot start). A plugin cannot transpile the
  plugins loaded before it, so this cannot move out.

### Trigger references (`src/editor/triggerRefs.ts`, `api.triggers.references` / `resolvePlayers`)

For the Trigger Map plugin (`github.com/scm-js/plugin-trigger-map`). `triggerUsage` answers
"which counters are taken"; `triggerReferences(list, forces, briefing)` answers "who talks to whom": per trigger,
its resolved owners, `inert` (Disabled flag or no owner), and one `TriggerRef { kind, access, part, slot, type, id,
players, group?, approximate?, address?, mask?, disabled? }` per thing a condition reads or an action writes/uses.
Decisions worth keeping:

- Player groups resolve more precisely than `playerSlotsOf` (which is deliberately conservative, all 12, because a
  counter allocator must not collide): *All Players* = slots 0–11 in a record (conditions and unit actions reach
  P9–12, measured `extended-players`), 0–7 as an owner and through Create Unit/CUWP/Set Deaths/Set Resources/Set
  Score (`EIGHT_ONLY`, they refuse P9–12), *Force N* = FORC's members, *Current Player* = the
  owners. *Foes / Allies / Non Allied Victory* = 0–7 and *Neutral* = 0–11, flagged `approximate` — the game settles
  them at run time. Blizzard's melee Victory trigger is exactly this case (`tests/triggerRefs.test.ts`, Ice Floes).
- Deaths: unit < 228 unmasked = a `deaths` cell; 228–232 unmasked = a class sum, reported as a `units` *read* (a
  write to a class is meaningless and dropped); a masked record (mask word 0x4353) or unit > 232 or player ≥ 27 = a
  `memory` ref with `addressOfEpd(slot or raw player, unit)` and the mask bits.
- Locations come off the defs table (every `location` arg); conditions read, actions use, Move Location's `target`
  field alone writes. Strings / WAVs / AI scripts / CUWP slots likewise from the arg kinds; MBRF only yields those two.
- Units: Bring/Command read with players, Command the Most/Least read with `players: []` (every player compared);
  Create/Kill/Remove/Move/Give write; Order/Modify…/Set Invincibility/Doodad State/Move Location use. Kill / Most
  Kills / Opponents / Elapsed Time are not references (game state nobody's trigger writes).
- `view.goTo({ kind: "trigger", index, briefing? })` opens the Trigger Editor (or Mission Briefing) on the row —
  the dialogs take `payload.index` (Find's trigger results use it too).

### What the game does: the trigger reference from 1.16.1

`docs/triggers.md`'s game facts come from StarCraft 1.16.1's own trigger engine:
read statically (private ledger `~/github/scm-sim-reader/trig-ledger/`: LOOP, CONDITIONS,
ACTIONS, DIFF, PROBES) and checked by running 28 probe maps plus variants through the
lifted game (`trig-run/`, RESULTS.md; harness taps the condition/action jump tables and
logs every call per frame). All predictions held; nothing on the page rests on reading
alone except what says so. Widely held claims that are wrong (8 of the 128 an earlier page
made; 30 more were partly wrong): hyper triggers "every frame", flag 0x02 "ignore defeat",
Create Unit count 0 = all, Draw ends the game, Kill Unit adds deaths, Wait in game time, Debug
Mode does nothing, and the usual account of the melee maps' victory trigger. The page describes behaviour only — no addresses or code.

The facts that shape the page: a pass every 31 frames (first on frame 2), brought to the
next frame by a wait running out or the countdown reaching 0, so hyper triggers give one
every 2 frames; players 1→8, lists top to bottom, conditions stop at the first false; one
wait slot per player (Wait, a person's Transmission, single-player Center View); Wait ms
are game-speed ms (`⌈ms / msPerFrame⌉` frames, at least 1, plus one); Command counts are a
per-pass snapshot (dropped only by Kill/Remove ± At, Move Unit, Move Location or a Bring);
At most counts every unit that exists, At least/Exactly finished ones (Bring adds cargo,
hangar, carried powerups for those); only real deaths count, class Deaths read the
lost-counters; Victory/Draw defeat everyone else without a result in that pass; EUD is
read-only (Set Deaths refuses player ≥ 8 and unit > 232).

Pictures: `trig-cycle.svg`, `trig-wait.svg`, `trig-bring.svg`, drawn in
`scripts/lib/chk-diagrams.mjs` beside the trigger record. Check Map's hyper-trigger
messages follow the same facts: the cycle numbers, and a preserved Wait is
reported only when it shares a player with hyper triggers, as "above" (holds them up) or
"below" (starved) them.

Found on the way, not fixed here: scm-sim's multiplayer engine never sets the game's
multiplayer byte (0x57F0B4), so its two-person games run trigger code on the single-player
branches (Pause Game works, Transmission and Center View hold until a portrait/scroll
timer that never comes, results keep trigger lists).

Owners and units the game honours (audit T1/T3/T4; runs EA01–EA03):
- `TRIGGER_OWNERS` (editor/triggers.ts): the game copies a trigger only to P1–8, All Players and
  Force 1–4. The Players tab shows only those (others only while ticked, with a note);
  `resolvePlayers(CurrentPlayer, owners)` in triggerRefs skips the rest, so such a trigger is
  `inert` for plugins.
- `newAction` seeds Create Unit, CUWP and Set Deaths with unit 0 (Terran Marine): Create Unit of a
  class makes nothing, Set Deaths(Any unit) writes nothing, Men/Buildings/Factories write the real
  "lost" counters. Conditions keep Any unit.
- `triggerCanCreate`: Create Unit refuses id ≥ 228 and every type without units.dat availability
  0x02 (`PALETTE_AVAILABILITY`; 168 of 228 have it, measured on the real 1.16.1 too). The two
  creating actions' unit list is filtered by it when unit assets are loaded (`peekUnitAssets`).
- Remastered's Create Unit, read from its Ghidra project, applies the same rules (P9–12 refused,
  palette bit); probe R5b played it (no P12 Overlord).
- Flag 0x02 prints as "Defeat Others" (still reads "Ignore Game End"); `TriggerFlag.IgnoreGameEnd`
  keeps its name for plugins. Check Map warns on it.
- Set Countdown Timer's time is a plain number (seconds), not a ms duration. Mission Briefing is
  not offered as a TRIG condition (never true there). A Create Unit count of 0 hints "one".
- The text format writes a Create Unit / CUWP count of 0 as `0`, not `All` (it makes one); `All` still parses to 0.
- Check Map: Create Unit / CUWP of a class or a non-palette type (`triggerCanCreate`, needs units.dat for the
  palette half); Run AI Script owned only by Human/Rescuable/Neutral slots outside `HUMAN_AI_SCRIPTS` (Neutral
  also runs Rscu, ledger A15).

### Unit names under a data set (C7 audit)

Reading StarEdit's `UNIT_NAMES` first and the loaded names second does not work: with Cosmonarchy 14 of the mod's
names resolve to *other* ids (332 "Terran Civilian" → 15, 338 "Zerg Overmind" → 148, 471–475, 486–488, 613 …) and
Titan Stealer's `Kill("Terran Civilian")` becomes unit 15 on TrigEdit's Compile, no word. `triggerNames(scn).unitByName`
reads class labels/aliases, then `Unit #N`, then the loaded names (`unitNameIndex()`: `unitName(id)` lower-cased
→ ids, classes 229–232 left out, built once per `currentLoadedNames()`/`unitTypeCount()` identity — a mod's table is
3,000 rows and Diplomacy asks 1,202 triggers' worth), then StarEdit's names (old text keeps reading), then UNIx custom
names. `unit(id)` prints `Unit #id` when the name belongs to two ids (Floor Hatch 204/385, Terran Lodestone 384/387) or
is a class's. Vanilla: `UNIT_NAMES` has no duplicates, so nothing prints differently (`tests/trigger-dataset-names`
checks all 228 both ways). Proof: `tests/datasets-cosmonarchy.test.ts` "under its own names" round-trips all 442
trigger lists of the 404 CMBW maps (unit arguments only — a record's `unitId` under a type that takes no unit, e.g.
Waterwar and vt01, is not in the text); with StarEdit's names first it fails on Titan Stealer alone. Headless with the set installed:
Titan Stealer's 43 summary lines are identical across a Compile, the Civilian row stays 332.
The Classic editor's unit pick (`TriggerDialogs.tsx` case `"unit"`) is `shownUnitGroups(dataSet)` as `<optgroup>`s
(`ChoiceSelect`'s `groups`), 228–232 filtered out of the groups (`CLASS_IDS`), the classes first unless creating;
a value no group lists (an unnamed type of the set) is added by its name. Listing `UNIT_NAMES` (0–227) instead shows 332
as "332 (raw)". For vanilla the order is the palette's, not id order.
