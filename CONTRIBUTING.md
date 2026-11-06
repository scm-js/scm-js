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

`verify` ends with a summary of what passed and what did not run on your machine. Paste it
into the pull request's Testing section.

## The rules that matter most

- **Nothing of Blizzard's goes into git**: not the game's archives, not the files
  `npm run extract` writes, not Blizzard's maps, not pictures of the game's graphics.
- **Keep the documents current.** A change people will notice belongs in the guides under
  `docs/`, written for map makers and plugin authors, not as notes on the code.
- **Text people see goes through `t()`**, and `npm run i18n -- --write` adds it to the
  Korean catalogue. Fill in the Korean if you can; say so in the pull request if not.
- **The plugin API only grows.** `PLUGIN_API_VERSION` stays at 1; an addition is
  documented in `docs/plugins.md` and in `src/plugins/api.ts`.
- **Code adapted from elsewhere is credited**, as [ATTRIBUTION.md](ATTRIBUTION.md#maintenance-rule)
  describes.

The plugins are separate repositories under [github.com/scm-js](https://github.com/scm-js),
and `npx @scm-js/cli plugin new` starts a new one.
