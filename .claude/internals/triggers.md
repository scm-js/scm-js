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

`BRIEFING_ACTION_DEFS` puts the portrait slot in `player` (the first group): Blizzard's own maps
say so — `fixtures/maps/(6)Ground Zero.scm` and `(4)Spring Thaw.scx` (gitignored copies from the
install's Maps folder) carry briefings, and `tests/briefing.test.ts` decodes, round-trips through
the text format and re-encodes them; StarEdit sets hint bits (0x04 and the unit-type hints) on every
briefing action that text cannot carry, so that test masks them. `editor/triggers.ts#actionStrings`
is the one walker over an action's text / WAV arguments (the String Editor's usage list, the Sound
Editor and Find all read it). The Text Trigger Editor's Briefing mode edits MBRF in the same syntax.
The Classic editor's player pick carries an EPD box (`epdOf` / `addressOfEpd` over
`DEATHS_TABLE_ADDRESS`) for EUD work.

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
plugin (`github.com/scm-js/plugin-trigscript`, not a default — installed from Browse Plugins), not the
editor: it was moved out (as "Trigger Script", 2026-09-03) so the editor no longer bundles Monaco and a
second TypeScript (the desktop download lost ~14 MB of the 18 MB those chunks weighed), and rewritten
on 2026-09-07 as TrigScript: the script is ordinary TypeScript that *runs* when built (files, imports,
helpers, the standard library), recording one trigger per `trigger()` call, and only `program(() => …)`
bodies are compiled — into the same death-counter state machine as before. Its README documents the
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
  (the plugin's compiler carries its own copy).
- TypeScript stays a runtime dependency for one job: `plugins/transpile.worker.ts` +
  `transpileClient.ts` turn a `.ts` plugin into JavaScript for the loader (idle-terminated after
  `WORKER_IDLE_MS`, main-thread fallback when the worker cannot start). A plugin cannot transpile the
  plugins loaded before it, so this cannot move out.
