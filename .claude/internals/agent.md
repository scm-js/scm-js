# Claude Agent (`src/agent/`) — a built-in plugin

A panel where Claude reads and edits the open map. Reader docs: `docs/guide.md#claude-agent`,
README feature list.

## Shape

- **A plugin, not editor code.** `src/agent/plugin.ts` is an ordinary `activate(api)`; every
  read and write goes through the plugin API (`api.document.edit` / `update`, `api.query`,
  `api.triggers`, `api.settings`, …), so an agent edit undoes, dirties, repaints and reaches
  a shared map exactly like a hand edit, and nothing in the editor knows the agent exists.
  It lives in `src/agent` (tracked, type-checked by `tsconfig.app.json`) instead of the
  generated, gitignored `plugins/` folder, which `vendor-plugins.mjs --clean` empties.
  `src/plugins/builtin.ts` registers it as `builtin:claude-agent` after the globbed
  built-ins; `defaults.ts#isLocalBuiltin` tells it apart from a vendored default (no
  repository, so no update address), and the plugin tests compare only the remote
  defaults with `DEFAULT_REMOTE_PLUGINS`.
- **Startup cost: `plugin.ts` only** (1.6 KB): a status-bar cell, Tools ▸ Claude Agent,
  Ctrl+Alt+C (Ctrl+Shift+K is the stamp library's; Ctrl+Shift+J/A are browser keys). The
  controller, tools, `@anthropic-ai/sdk` and the React UI are one lazy chunk (453 KB, 109 KB
  gzip) loaded on first open; `docs/triggers.md` and `docs/guide.md` are two more
  (`?raw`, 23 + 43 KB gzip), loaded the first time `read_docs` runs.
- **Controller** (`controller.ts`) outlives the panel: settings (`settings.ts`, plugin
  storage; the key is stored only with *Remember*) and one `AgentSession` per document id,
  dropped when that map closes. Closing the panel mid-turn does not stop the turn.
- **Session** (`session.ts`): the Messages API's manual tool loop, streamed with
  `client.beta.messages.stream` from the browser (`dangerouslyAllowBrowser`). Tools run in
  order (they mutate the map); all of one round's results go back in one user message.
  The history is **append-only** (prompt cache + preserved thinking); per-moment context
  goes in each user message as a `<map_state>` block (`tools/map.ts#mapState`), never in
  the system prompt (`prompt.ts`, frozen text). Request: `claude-opus-5-5` by default,
  `max_tokens` 64000, adaptive thinking (`display: summarized` when shown), `output_config.
  effort`, top-level `cache_control`, and for Opus / Sonnet the server-side refusal
  fallback (`server-side-fallback-2026-07-01`, `fallbacks: "default"`; Haiku has none).
  Stop aborts the stream; tool calls not yet run get `is_error` results so the history
  stays valid. A user-run "Undo these changes" sets a note sent with the next message.
- **Tools** (`tools/*.ts`, 55, registry order fixed in `tools/index.ts` — it is part of the
  cached prefix). Each has a JSON schema (`schema.ts` subset), an effect (`read` / `write` /
  `destructive`, which the approval setting gates), a `describe` line for the transcript
  and `run`. Inputs are sent with `eager_input_streaming`, so the server no longer validates
  them: `schema.ts#validate` does, before every run, and a failure is an error result.

## Conventions the tools speak (and the prompt states)

Players 1–12 and forces 1–4 (converted to 0-based owners); locations by **number** 1–255 as
the trigger text counts them (64 Anywhere); record indices 0-based. Positions in map pixels
(unit centre), or `tx`/`ty` meaning a tile's centre; rects `{x0,y0,x1,y1}` exclusive.
Every write is labelled `Claude: …` (`types.ts#LABEL_PREFIX`); `undo_my_edits` and the
turn's undo button stop at the first entry that is not.

## Traps found

- **The trigger parser interns as it goes.** `tx.triggers.fromText` on text with an error
  on line 5 has already interned line 2's strings; `withStrings` never records them (the
  parse threw), so no undo entry exists and the table keeps them until reload.
  `tools/triggers.ts#checkText` parses first with a copy of `api.triggers.names()` whose
  `intern` returns 1 — the error, with its line, before anything is touched. `runUpdate`
  also undoes a partial entry when an update throws after recording one.
- **The SDK's typings import `undici-types` / `undici`, which pull in `@types/node`** —
  Node globals in the browser build (`setTimeout` became `NodeJS.Timeout` and broke
  `SplashScreen.tsx`). `tsconfig.app.json` `paths` maps both names to
  `src/agent/undici-types-stub.d.ts`; the SDK's `NotAny<…>` probes then fall back to the DOM
  types. Do not "fix" the splash screen instead.
- **The right dock has little spare height** under Minimap / Layers / Properties / Under
  Cursor (≈160 px at 1440 × 900), too little for a conversation, so the default placement
  is a resizable, maximizable floating panel; *Where the panel sits* offers the right dock
  and the bottom strip (`plugin.ts#where`, re-opened through `controller.reopen`). The
  panel never opens by itself: on a first visit it would cover the map (and e2e clicks).
- `erasableSyntaxOnly`: no constructor parameter properties.
- Without game data `palette.unitSize` is a fallback size, so `place_units` blocks are
  spaced wider; a tile-sized `area` filter can fall between rows (seen in the browser run).

## Verification

`tests/agent.test.ts` (13): the registry (unique names, closed schemas, eager streaming),
validation, effects, and the tools against a blank map through `createPluginApi` — units
with properties / update / move / delete, locations and which triggers use them, trigger
add / insert / replace / delete, a failed parse leaving the map, the strings and the undo
stack untouched, undo stopping at the user's edit, properties / players / forces / unit
settings, lookup, docs, and the no-graphics refusal. In the browser (built `dist/` under
`vite preview`): a local stand-in for the Messages API streaming a scripted
turn (thinking, text, overview → place + location → picture → a destructive delete) drove
the real panel: streaming rows, the schematic picture, the approval card, the turn's
undo, the placement switch; the requests carried the shape above with no key (address
mode).
