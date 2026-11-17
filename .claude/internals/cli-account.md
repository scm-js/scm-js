# scmjs.dev from the terminal: sign-in, sharing, the library, links, replay sync

`account show|login|logout` (and the hidden `login`/`logout` shortcuts), `map share`, `replay share`, `scmjs share`,
`library …`, links read as input, and `replay sync`. Server half: ai-server (its README is the record of the routes'
decisions). Every module here **returns data and prints nothing** (`print*` functions make the lines), so the MCP
account tools (`cli-mcp.md`) call the same functions.

## The session and the client (`account.ts`)

- **The session file** (`sessionPath`): `SCMJS_SESSION`, else `%APPDATA%\scmjs\session.json` on Windows, else
  `$XDG_CONFIG_HOME|~/.config/scmjs/session.json` (macOS too). `{ server, session, name, provider, savedAt }`, written
  via `.part` + rename, file 600 and folder 700 (**chmod after the write**: `writeFileSync`'s `mode` applies only to a new
  file).
- **A session is sent only to the server it came from**: `requireSession(server)` refuses a file whose `server` differs
  from `SCMJS_SERVER` ("Sign in first: scmjs login", exit 2, the hint names both), so a session from a local server
  never reaches api.scmjs.dev. `logout` POSTs `/v1/auth/logout` to the file's own server (unreachable is no reason to
  keep the file) and deletes it. `account` refreshes the stored name when the provider's changed, since doctor's row
  reads the name from the file and makes no request. `account` stays "who + storage" (and its shared rooms with `--qr`);
  its last line points at `scmjs library`. Scripts read `account --json`'s `shared`, so it stays.
- **`Client`**: JSON or FormData, bearer, `AbortSignal.timeout` (30 s; 120 s for uploads and rooms), refusals as
  `CliError(server's message + "Try again in N seconds.")`; 401/`unauthorized` → exit 2 with "scmjs login signs in
  again."; an unreachable server says the `cause.code` (fetch's own refusal of a port such as 9 says "bad port").
  `missingOk` turns a 404 into null for a server without that part (rooms off, maps off, an older server).
- Every function takes `{ server, file, fetchImpl }`, so tests hand a stand-in (`tests/support/libraryServer.ts`, which
  also runs by itself: `node tests/support/libraryServer.ts <map> <replay> <port>`, the way the built command is driven by
  hand with `SCMJS_SERVER` and a session file).

## Signing in: the loopback page (`login`)

- **The editor's popup flow with `open.ts`'s loopback page as the opener.** The command serves
  `http://127.0.0.1:<random port>/<random token>` and **asks `POST /v1/auth/start { provider, returnOrigin: <that
  origin>, cli: true }` itself** (Node sends no Origin header) before opening the browser; the page gets the provider's
  URL baked in, `window.open`s it as a named popup (no `noopener`: the callback posts to `window.opener`; a button when
  the browser blocks it), takes the `scmjs-ai-auth` message only from the server's origin and that popup, and POSTs
  `{session}` to `/<token>/session` (refused unless `Origin` is the page's own). The command checks the session with
  `GET /v1/account` (kind must be `account`) before keeping it, and answers the page's POST with the name or the error,
  so the tab says "Signed in as Ann" or why not. Two minutes (`SIGN_IN_TIMEOUT_MS`); the server's state lives 10.
- **Why the command, not the page, asks for the start**: the page then never calls the server, so **no CORS change at
  all** — the narrowest option. The server accepts a loopback return origin only for `cli: true` (any port, plain http,
  127.0.0.1/localhost/[::1]), refuses `cli: true` with an Origin header (a web page cannot claim to be the command), and
  never lets `cli` reach a non-loopback origin.
- `BROWSER=none` prints the address. `--provider` has choices (discord by default).

## Signing in by code: `login --device`

For a terminal whose browser cannot reach the loopback page (SSH, a container). RFC 8628 in spirit, with the server's
own JSON shapes (camelCase, `status` in a 200 rather than RFC error codes, so `Client.request` needs no special case).

- **Flow** (`loginByCode`): `POST /v1/auth/device { client: "scmjs on <hostname()>" }` (a 404 = an older server →
  "{server} does not offer sign-in by code", hint `scmjs login` on a computer with a browser); then poll
  `/v1/auth/device/token { deviceCode }` every `interval` s: `pending`/`slow_down` carry the new interval, `denied` /
  `expired` are CliErrors, `approved` carries `{ session, account }` (no extra `GET /v1/account`; `provider` =
  `account.providers[0]`). Three poll failures in a row end it (one dropped connection does not). **The deadline is the
  command's own clock** (`expiresIn`), so a server that keeps saying pending still ends. The poll floor is 0.2 s so tests
  run fast; the server never sends under 5.
- **Terminal**: the address and the code on its own line; `--qr` draws `verificationUriComplete`; the countdown is one
  stderr line rewritten each second only on a TTY (piped: one "expires in 10 minutes" line). **Ctrl+C**: its own SIGINT
  listener (lifecycle defers to it) aborts the wait → "Cancelled; nothing was signed in", exit 130; the line is cleared
  in `finally`.
- **Chosen automatically** (`noLocalBrowser`): `SSH_CONNECTION|SSH_TTY|SSH_CLIENT`, or on Linux `$container` /
  `/.dockerenv`, and neither `DISPLAY` nor `WAYLAND_DISPLAY` (`ssh -X` gives a display, and then the loopback page
  works). `--device` / `--no-device` leave the value undefined unless given, which is when the detection runs; the line
  names why and `--no-device`. **WSL is not "no browser"** (`open.ts` starts Windows' browser). doctor's fix becomes
  `scmjs login --device` under the same test.
- **Server decisions worth knowing here**: user codes are 8 consonants (no vowels, no digit look-alikes); a code is spent
  by the poll that hands the session (atomic); a start with an `Origin` is refused, as `cli: true` is. **The `/device`
  page needs `Referrer-Policy: same-origin`, not `no-referrer`**: under `no-referrer` Chromium sends `Origin: null` with
  the page's own form posts, and the same-origin check refused the sign-in button (found only in a browser run).
- **Testing the browser half**: a Playwright route on `discord.com/**` does not see a redirect's target, and the real
  Discord page loads; route the server's own `/device/signin/**` and rewrite its 303 into the callback instead.
  `tests/cli-login-device.test.ts` and `tests/cli-share.test.ts` run against stand-ins; the browser half of each sign-in
  was driven by hand against a local ai-server (PGlite, a stand-in Discord through `fetch`) with headless Chromium.

## `map share` (`share.ts`)

- **"The same map" is the CLI's rule, by file name**: `GET /v1/maps`, the newest map whose head `fileName` equals this
  one (case-insensitive) — the server has no such notion. `--new` skips it. Same sha256 as its head → nothing uploaded,
  the existing link to that revision reused (else one made); else a new revision or a new map (multipart: `file`,
  `fileName`, `name` on create only, `note`, `meta`, `picture`), then `POST /v1/maps/:id/links { revision: head }` —
  pinned, the editor dialog's default. A map from `-` is named `<scenario name>.scx|.chk` (`shareFileName`), since
  `stdin.scx` would match every piped map.
- **`meta`** as the editor's plugin's `metaOf`: plain scenario name, `tilesetOf` **id** (not the display name), seated/
  human slots, units, triggers, a 1 px/tile thumbnail ≤ 150 KB. **The picture** is `previewPng` at `clamp(floor(512 /
  max(w,h)), 1, 8)` px a tile, halved until ≤ 900 KB (the server takes 1 MB), only when a copy of the game is found;
  none → uploaded without one (the server makes no card; the link's card shows the size) and the third line says why. A
  `--starcraft` folder that is not a copy is an error, not a silent "no picture". The server has no game graphics, which
  is why the picture is drawn here.
- **`--edit [--keep day|week|month|forever]`**: `POST /v1/rooms { name, map: base64 }` (a live room: the server's create
  reads only those) or with `keepDays` 1/7/30/null plus `fileName`, `note`, `meta`, `picture` and `mapId` of the
  same-file-name map, so a kept room is that map's next revision as in the editor. Rooms take MPQs only: a bare `.chk` is
  packed first. **A live room the command opens has nobody in it** — the editor's owner joins at once, the command does
  not — so the server's idle sweep closes it if nobody comes; the line says so.
- **Output**: the link alone on the first line (`| head -1` is the link), the facts, a dim line of what the link does.

## Links (`linkTo`, `weblink.ts`)

- Map and share links are `https://scmjs.dev/editor/map/<token>` / `…/share/<invite>` (`WEB_EDITOR`); **replay links are
  `https://scmjs.dev/replay/<token>`** (`SITE`): the front-door worker forwards it to `/editor/replay/<token>` with the
  query kept, or to `/play/?replay=<token>&…` when `play` is among the parameters. `?scmjs-server=<server>` is added
  when `SCMJS_SERVER` is not api.scmjs.dev, so a link made against a local server opens there; the moment goes after it.
  **The play page ignores `scmjs-server`** (it uses the browser's stored setting), so a `--play` link made against a
  local server reaches it only where the play page is set to it — said in the guide, not refused.
- **Links as input** (`weblink.ts`): `readInput` asks `isWebAddress(path)` before the file system, and `readWebLink`
  returns an `Input` whose **`path` stays the link** and `link` is set; `writeOutput` refuses a web address, so every
  command that writes back over its input refuses with no code of its own. Accepted: hosts `scmjs.dev`, `*.scmjs.dev`,
  localhost/127.0.0.1/[::1] and `SCMJS_EDITOR_URL`'s; paths ending `/(map|replay|share)/<token>` (so `/editor/…`,
  `/replay/…`, `/nightly/map/…`) and `/play/?replay=<token>`; tokens `[A-Za-z0-9_-]{8,128}`. The server: the link's
  `?scmjs-server=` (http/https only), else `SCMJS_SERVER`, else api.scmjs.dev. A 404 is exit 2 (as a missing file).
  **Each read counts an open** and is under the server's per-address limit: `map info <link>` is an open, as the
  editor's is. `map open|replay open <link>` open the link itself instead (`cli-editor.md`).

## `replay share`, `scmjs share`, moments, `--no-link`, `--copy`, `--qr` (`replayshare.ts`, `sharefiles.ts`)

- **`replay share`**: one request — `POST /v1/replays` multipart `file` + `fileName` + `note?` + `picture?` +
  `link=1`, which answers the stored replay's facts **and its first link**; the same bytes again answer `existing:
  true` with the link that is there. So **one link per replay**, and a moment is only the query (`withMoment` appends
  after any query). Limits are the server's (size, count, storage): its messages are printed as they come. The card's
  picture is the replay's map (`parseScenario(rep.chk)` → `previewPng` under 900 KB), none without a copy of the game,
  `--no-picture` to skip. A replay from `-` is `replay.rep`.
- **`--at <time>`** (`parseMomentTime`): `m:ss`, `h:mm:ss`, whole seconds (decimals refused, to keep `t` a clock).
  `frame = ceil(s*1000/42)`; refused past the replay's length (shown as `floor(frames*42/1000)` seconds). `0` writes no
  `t`.
- **`--play [player]`**: a **slot number** (`ReplayPlayer.slot`, the lobby slot — what Aftermath's Share and Play From
  Here hand over and the play card matches `p.slot` against; 0 and 2 in a usual 1v1) or a name (case aside, whole, or
  the start of exactly one). Players offered are types 1, 2, 5, 6 (the play page's `isPlayingType`), computers included.
  **Not** `replay export --follow`'s "number as replay info lists them, from 1": the number typed is the number in the
  link; the refusal lists `slot name` pairs. No value → a bare `play` (the person chooses on the card); without `--at`
  → from the start. Checked before any request (`replayMoment`), so a mistake sends nothing.
- **`--no-link`**: `keepReplay` (upload without `link=1`) and `keepMap` (the same store as `shareMap`, stopping before
  the link). Both return `link: null` in their own outcome types so `shareReplay`/`shareMap` keep `link: string`.
  Refused with `--edit`, `--keep`, `--at`, `--play`, `--copy`, `--qr` (`checkShareOptions`).
- **`scmjs share <files...>`**: every input read and kind-checked first (a bot or unreadable file stops it before
  anything is sent), then `checkShareOptions` (map-only `--name --edit --keep --new` and replay-only `--at --play` are
  refused only when **no** file is of that kind; `--name` with two maps refused), then each file in turn through
  `shareFile` → `SharedFile { file, kind, link, map | replay }`. A failing file is reported and the rest go on, exit =
  the worst. `map share --json` / `replay share --json` keep the bare outcome.
- **`--copy`** (`clipboard.ts`): `clip.exe` on win32 and WSL (`WSL_DISTRO_NAME`/`WSL_INTEROP` or `/proc/version`; then
  `/mnt/c/Windows/System32/clip.exe` for a PATH without Windows' folders), `pbcopy`, `wl-copy` under
  `WAYLAND_DISPLAY`, `xclip -selection clipboard`, `xsel --clipboard --input`. The first that exits 0 wins; ENOENT →
  next; none → `▲ Not copied: …` on stderr, exit unchanged. **Trap: xclip/wl-copy fork a process that keeps the
  clipboard and the stderr pipe** — wait on `exit`, not `close`, then destroy the pipe and `unref`, or the command hangs.
  Tests use a `node -e` stand-in; nothing in the suite touches the real clipboard (an in-process `--copy` on WSL reaches
  clip.exe by its full path even with PATH emptied).
- **`--qr`** (`map share`, `replay share`, `scmjs share`, `map play`, `account`, `login --device`): **our own encoder**
  (`qr.ts`, adapted from Project Nayuki's MIT library, credited in ATTRIBUTION.md): an npm package would have meant a
  dependency, a notices entry and an ATTRIBUTION row for ~250 lines of well-known algorithm. Byte mode, L/M, versions
  1–40, mask by the standard's four penalty rules. Checked once against `qrcode` module for module (every mask, both
  levels, texts up to version 40) and decoded with jsQR, including the terminal lines read back into pixels; the test
  pins a matrix, capacities, Reed–Solomon codewords, format and version bits, and that the half blocks read back to the
  modules. **Drawing** (`qrLines`): two rows a line with `▀▄█`, a quiet zone of 2 (4 is the standard's; phones read 2
  and the width matters); with colour the line is wrapped in black on bright white so a dark theme does not invert it;
  without colour the *light* modules are the marks, i.e. drawn for a dark terminal (qrencode's UTF8 convention; phones
  read the inverted code). ASCII fallback: `##` per module. Printed under the first line, so `| head -1` is still the
  link; `--json` ignores `--qr`.

## `scmjs library` (`library.ts`, `librarycmd.ts`)

- `library [maps|replays|shared]`, `get`, `rm`, `unlink`, `rename`, `note`; `librarycmd.ts#addLibraryCommands` adds them
  to the program.
- **The list**: `GET /v1/rooms/mine` first (a kept room's id *is* its stored map's id, so the map row says "shared for
  editing" with the invite), `GET /v1/maps`, then `GET /v1/maps/:id` **only for a map whose summary has `links > 0`**
  (the list carries the count, not the tokens), six at a time; `GET /v1/replays` (links inline, with `opens`). A server
  without a part → `missing: [...]`, said dimly. `library shared` alone asks `GET /v1/storage`.
- **Naming one thing** (`findInLibrary`): a link (looked up in the maps' links, the replays' links, or the rooms'
  invites; a link on another server than the session's is refused, naming both), an id prefix of ≥ 6 hex characters
  (ids are UUIDs; the list shows the first 8, dashes dropped), else a map's name or head file name or a replay's file
  name, case-insensitive. Several hits → an error listing them with ids.
- **`get`**: a map or replay link → the public routes (`GET /v1/links/:token`, then `/file`), **no session sent even
  when signed in**; `--revision` with a link is refused (a link opens the revision it was made for). A share link → the
  owner's kept map's head revision; a live room is refused (nothing stored). Else the account's routes with the bearer.
  The file's name is the `Content-Disposition`'s `filename*` (then `filename`), made safe by `safeFileName` (a server
  could name a file `../x`). Written through `writeOutput`, so `-o -` is stdout and a linked map gets the bytes as an
  undo step; an existing file needs `--force`.
- **`rm` / `unlink` plan first** (what goes: revisions, links with their opens, a kept room, the bytes) and print the
  plan's sentences before `confirmed()`: `--yes`, else a y/N question when stdin **and** stdout are terminals (`y`,
  `yes`, `예`, `네`, `ㅇ`), else exit 2 "no terminal to ask on". `--dry-run` stops after the sentences; `--json` puts
  them on stderr and prints `{ plan, done }`; a "no" is exit 1. The last revision is refused before asking (the server
  refuses it too). Deleting the head revision says links to "the newest" will open the one before. Unlinking a share
  link is `DELETE /v1/rooms/mine/:id`: a live room's people are sent out and nothing is kept; a kept room writes a last
  revision and stays a map.
- **`rename`** (`PATCH /v1/maps/:id { name }`) and **`note`** (`PATCH …/revisions/:n { note }`, the head by default) are
  maps only: replays have no PATCH route.

## `replay sync` (`replaysync.ts`)

`scmjs replay sync [folders…] [--watch] [--since d|Nd] [--all] [--dry-run] [--link [--no-picture] [--starcraft]]
[--json]`: new replays from StarCraft's replay folders to the account, stored without links unless asked.

- **The folders** (`usualReplayFolders`): `StarCraft/Maps/Replays` (any case) under each Documents folder — Windows:
  `%USERPROFILE%\Documents`, `%OneDrive%|OneDriveConsumer|OneDriveCommercial\Documents`, `OneDrive*` in the profile;
  WSL: every `/mnt/c/Users/<u>/Documents` and `…/OneDrive*/Documents` (not Public, Default, Default User, All Users,
  WsiAccount); Linux `~/Documents` and Wine's `drive_c/users/*/(My )Documents`; macOS `~/Library/Application
  Support/Blizzard/StarCraft/…` and `~/Documents` — then each game copy's `maps/replays` (1.16.1). **Documents is often
  OneDrive's** (plain Documents held only `My Games` on the machine checked). Remastered writes `LastReplay.rep`, a game
  saved by name at the top, and `AutoSave/<yyyymmdd>/<hhmmss>,<map>.rep`; the walk takes any sub-folders. The Remastered
  install folder has `Maps` but no replays.
- **What is on the account** is `GET /v1/replays`, read once a run: each carries `sha256`, so a replay the account has is
  never sent (not even the first time this command sees it). The server dedups by hash per account too (`existing:
  true`), the backstop. A server without replays (404) is an error.
- **The state** (`syncStatePath`: `replay-sync.json` beside the session file, or `SCMJS_REPLAY_SYNC`), written via
  `.part` + rename **after every upload** so Ctrl+C loses nothing: `servers[server] = { since, firstSync,
  uploaded{sha → …}, refused{sha → server message} }` and `files[path] = { size, mtimeMs, sha256 | skip }`. The file memo
  means a second run reads no file it read before; an old file whose hash is known counts as "already", not "older".
- **The first run's start** (the worry: years of replays into the account's storage): no state for this server →
  `since` = now, stored; on a TTY (not `--json`/`--dry-run`/`--since`/`--all`) the command asks with the count and size of
  the older `.rep` files (by stat, nothing read) — yes stores `since: null`. `--since X` or `--all` on the first run
  store that instead; later runs' `--since`/`--all` apply to that run only. The cut is the file's mtime (no read
  needed), not the header's start time. `--dry-run` writes no state.
- **`LastReplay.rep`** is a path whose content changes; it is named `<yyyy-mm-dd> <hhmmss>,<map>.rep` by its mtime, and
  each pass takes it **after** the other files, so when the game also saved an AutoSave copy (same bytes) that name wins
  and LastReplay counts as already there.
- **Refusals by the server's code**, read off a fetch wrapped round the client's (`res.clone()`), so `account.ts` is
  untouched: `invalid_input` for this file (not a replay, too large) → skipped and remembered in `refused`;
  `storage_full`, `invalid_input` "at most N replays", 401 → the run stops, the summary printed, then the CliError (exit
  1, 2 for the session). A fetch that throws while watching is a warning and the file is tried on the next pass; in a
  single run it stops. Files over 8 MB (`MAX_REPLAY_BYTES`, the server's default) are not read, and files
  `detectFormat`/`parseReplay` refuse are skipped locally.
- **Settling**: a file is taken when `now − mtime ≥ 2 s`, or when it has been seen unchanged for 2 s (**Windows' and
  WSL's clocks can differ**, and an mtime ahead of this clock would never pass the first test). A single run waits once
  for the files not settled, then leaves the rest (`unsettled`); a file that changed while read is left too.
- **`--watch`** (`ReplayFolders`): one full walk, then every 5 s `changed()` stats each known folder and re-lists only
  those whose mtime moved (new sub-folders walked), stats the files not yet settled and every `LastReplay.rep` (**an
  overwrite in place does not move its folder's mtime**). On `/mnt/c`, creating a file moves its folder's mtime and not
  the parent's, and **inotify does not fire on drvfs**, hence polling. Ctrl+C: its own SIGINT/SIGTERM listener aborts a
  controller, the loop ends between files (an upload in flight finishes), the summary prints, exit 0; a single run
  stopped that way exits 130; a second Ctrl+C has no listener left and kills at once.
- **Stored, not linked**: a link is public to whoever holds it. `--link` asks `link=1` per upload and draws the card
  picture with `replayPicture` (from `replayshare.ts`). `replay share` on a stored replay later answers its first link,
  since the same bytes are the same replay.
- **Output**: a line per upload (`✔ <name> · <map> · <matchup> <players> · <length> · stored|<link>`; `ℹ … would upload`
  for a dry run), facts from the local parse (`matchupOf` copies the server's rule); the summary (uploaded, already,
  skipped with the first five named, still being written, older left with the hint, storage). Folders and "Watching…" go
  to stderr. `--json`: one object at the end; with `--watch`, a `{"type":"upload",…}` line each and a
  `{"type":"summary",…}` line.

## Open

- Not run: anything here against api.scmjs.dev itself (only local ai-servers and stand-ins); `replay sync` on native
  Windows (`%USERPROFILE%`/OneDrive variables), on a Mac (the Mac path is unverified), on a real 1.16.1 `maps\replays`;
  `--qr` read by a phone from a real share.
- `map share`: a `--follow` link (the newest revision); ending a shared room from the terminal.
- `library`: `get` of a whole map with every revision; replays renamed or noted (no server route); `--qr` on `library`.
