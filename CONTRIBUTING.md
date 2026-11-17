# Contributing to scmJS

Thank you for helping. Small, focused pull requests are easiest to review, and an issue or
a draft pull request is a fine way to ask whether something is wanted before you build it.

## Getting set up

```sh
git clone https://github.com/scm-js/scm-js
cd scm-js
npm ci
npm run doctor     # what this machine has and lacks, and what to run about it
npm run dev        # http://localhost:5173
```

You need Node.js 22.18 or newer. The editor runs without StarCraft's files, drawing flat
colours, but some test suites skip without them. `npm run doctor` says which, and how to
extract the files from your own copy of the game.
[docs/development.md](docs/development.md) has everything else: the layout of the
repository, the conventions, the plugin host, the tests, translations and the desktop app.

## Before you open a pull request

```sh
npm run verify             # what CI runs: lint, tests, type-check and build, browser tests
npm run verify -- --quick  # lint, type-check and tests, while you work
```

`verify` ends with a summary: what passed, each test suite that skipped (by file and name,
with how many tests), and what could not run on your machine at all. Paste it into the pull
request's Testing section.

## The rules that matter most

- **Nothing of Blizzard's goes into git**: not the game's archives, not the files
  `npm run extract` writes, not Blizzard's maps, not pictures of the game's graphics.
  `.gitignore` covers the generated folders; check before adding a test fixture.
- **Keep the documents current.** The guides under `docs/` are the documentation site and
  `README.md` is the repository's front page; a change people will notice that is not in
  them is undocumented. Write them for map makers and plugin authors, not as notes on the
  code, with `src/` paths only in a guide's closing *In the source* section. Keep the
  matching note in `.claude/internals/` in step too.
- **Text people see goes through `t()`**, and `npm run i18n -- --write` adds it to the
  Korean catalogue. Fill in the Korean if you can; say so in the pull request if not.
- **The plugin API only grows.** `PLUGIN_API_VERSION` stays at 1. Document an addition in
  `docs/plugins.md` and with a doc comment in `src/plugins/api.ts`, which the reference is
  generated from. The example plugin,
  [scm-js/plugin-hello-world](https://github.com/scm-js/plugin-hello-world), should keep
  building.
- **Code adapted from elsewhere is credited**, as [ATTRIBUTION.md](ATTRIBUTION.md#maintenance-rule)
  describes: a provenance comment beside an adapted algorithm or table, an entry there
  naming the source and licence, and the original notice kept.
- **Run what CI runs.** With the game data and the fixture maps on disk, `npm run verify`
  runs the real-data suites too, and that is the run that counts for a change under
  `src/formats/`.

The plugins are separate repositories under [github.com/scm-js](https://github.com/scm-js),
and `npx @scm-js/cli plugin new` starts a new one. A change to the editor that a default
plugin needs ships by moving that plugin's tag in `src/plugins/defaults.ts`.
