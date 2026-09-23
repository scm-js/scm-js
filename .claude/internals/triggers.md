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
game's "None". It was one too low until 2026-09-18 (nobody had opened a Blizzard map's stock triggers and read the
words: "commands at most 0 Factories" was the tell). A test on a real map's melee triggers would have caught it.

`BRIEFING_ACTION_DEFS` puts the portrait slot in `player` (the first group): Blizzard's own maps
say so — `fixtures/maps/(6)Ground Zero.scm` and `(4)Spring Thaw.scx` (gitignored copies from the
install's Maps folder) carry briefings, and `tests/briefing.test.ts` decodes, round-trips through
the text format and re-encodes them; StarEdit sets hint bits (0x04 and the unit-type hints) on every
briefing action that text cannot carry, so that test masks them. `editor/triggers.ts#actionStrings`
is the one walker over an action's text / WAV arguments (the String Editor's usage list, the Sound
Editor and Find all read it). The Text Trigger Editor is the **TrigEdit plugin** (`github.com/scm-js/plugin-trigedit`, a
default since 2026-09-07 that starts off, pinned in `defaults.ts`; Ctrl+Shift+T is its, so the hotkey is dead until it is
ticked on, while Import / Export Triggers are the editor's and are not) over `api.triggers.text` / `tx.triggers.fromText({ replace })`; it
moved out because the growth it wants — highlighting, completion, Monaco — is exactly what the editor stopped bundling,
and the format stayed here because Import / Export, the plugin API and the AI all read it. Its Briefing mode edits MBRF in
the same syntax. `api.triggers.claims(list?)` is what it fences the generated runs with, and its dialog offers the
`"trigedit.text"` slot (`DialogSpec.slot`) in place of the `textTriggerEditor` `SlottedDialogId` the built-in had; the
scmjs.dev plugin's Explain / Write / Ask buttons register there. `DialogId` no longer has `textTriggerEditor` — the one
non-additive change the move made to the typings, with no consumer outside the organisation.
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
about it — so `tests/trigger.test.ts` masks the hint bits in its fixture round trip. `intern` appends
to the string table while parsing (never removed, so harmless). Trigger dialogs are settings-style
transactions: `useScenarioForm(scenario, readTriggers)` → `applyTriggers` (marks `TRIG` only on a
real change) → `commitTriggersAtom` (`triggersRevisionAtom`); nothing is in the undo model.
`newCondition` / `newAction` seed StarEdit-like defaults.

### Trigger claims, and the TrigScript plugin

The trigger scripting language — its compiler, simulator and Monaco dialog — is the **TrigScript**
plugin (`github.com/scm-js/plugin-trigscript`, a default that ships on since 2026-09-07, pinned in `defaults.ts`), not the
editor: it was moved out (as "Trigger Script", 2026-09-03) so the editor no longer bundles Monaco and a
second TypeScript (the desktop download lost ~14 MB of the 18 MB those chunks weighed), and rewritten
on 2026-09-07 as TrigScript: the script is ordinary TypeScript that *runs* when built (files, imports,
helpers, the standard library), recording one trigger per `trigger()` call, and only `program(() => …)`
bodies are compiled — since TrigScript 3.0.0 (2026-09-18) into an IR that the eudplib plugin builds into the saved map
(Remastered only; the death-counter state machine is gone). Its README documents the
language and its internals. What stays here is generic:

- `api.triggers.claim(spec)` (`host.ts`, `pluginTriggerClaimsAtom`, `plugins/claims.ts`): a plugin
  names a run of the trigger list it generates, found by *content* — `spec.locate(list)` is asked
  with whatever list an editor holds, since the Classic editor works on a working copy with local
  inserts — and `TriggerListEditor` badges and locks those rows (`claimBadge`, `claimDescription`,
  `spec.open` as the button), inserts after the run rather than into it, `textOf` in the Text
  Trigger Editor fences every located run in comments, and Import Triggers' replace hint lists
  them. `commitTriggersAtom` no longer relocates anything: the plugin listens to `"triggers"` and
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
  (`github.com/scm-js/plugin-scmjs-dev`) provides `scmjs-dev.account`; since the AI features moved
  into that plugin (below) nothing in the organisation consumes it, and it stays provided for a
  third party's plugin. A plugin item whose top menu does not exist gets a top-level menu of its own before Help
  (`withPluginItems`; `MenuPath` accepts any string for it) — it used to fall back to Plugins.
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
  added 2026-09-12 for the Magenta plugin (`github.com/scm-js/plugin-magenta`), which carries
  its own pure copies so its tests run without the editor. The `+ 0x2000` the docs used to give
  in the EPD formula was wrong; `epdOf` never added it.
- TypeScript stays a runtime dependency for one job: `plugins/transpile.worker.ts` +
  `transpileClient.ts` turn a `.ts` plugin into JavaScript for the loader (idle-terminated after
  `WORKER_IDLE_MS`, main-thread fallback when the worker cannot start). A plugin cannot transpile the
  plugins loaded before it, so this cannot move out.
