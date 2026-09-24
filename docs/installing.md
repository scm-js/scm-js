# Installing

scmJS runs in a web browser, as a desktop app for Windows, macOS and Linux, or from a
container on your own server. Whichever you choose, the editor asks once for StarCraft's
graphics, which are not shipped with it. This page covers each way of running it and
that first question. The [user guide](../README.md) starts once the editor is open.

## In the browser

[editor.scmjs.dev](https://editor.scmjs.dev) is the newest numbered release. There is
nothing to install. Your maps stay on your own disk, and nothing is sent anywhere unless
you use a network feature: a copy kept on your scmjs.dev account, a map you share for
others to edit with you, or a question for the AI, all described in the user guide.

[nightly.editor.scmjs.dev](https://nightly.editor.scmjs.dev) is rebuilt every night from
the latest changes, for trying what is in development. Being a separate site, it keeps
its own settings and asks for the graphics again.

The hosted editor, the nightly and the documentation site count visits with Cloudflare
Web Analytics (no cookies, and nothing about your maps). The desktop app and a copy you
host yourself do not.

Chrome and Edge save a map back to the file you opened. In Firefox and Safari every save
is a download, and File ▸ Open Recent asks for the file again.

## The desktop app

The [releases](https://github.com/scm-js/scm-js/releases) page has the installers. These links always point at
the newest numbered release:

| System | Download |
| --- | --- |
| Windows, installer | [scmJS-windows-x64-setup.exe](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64-setup.exe) |
| Windows, zip to unpack and run | [scmJS-windows-x64.zip](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-windows-x64.zip) |
| macOS, Apple silicon | [scmJS-macos-arm64.dmg](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-arm64.dmg) |
| macOS, Intel | [scmJS-macos-x64.dmg](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-macos-x64.dmg) |
| Linux, AppImage | [scmJS-linux-x86_64.AppImage](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-x86_64.AppImage) |
| Linux, Debian and Ubuntu | [scmJS-linux-amd64.deb](https://github.com/scm-js/scm-js/releases/latest/download/scmJS-linux-amd64.deb) |

The app finds a StarCraft installation on its own, registers `.scm`, `.scx` and `.chk` so
a double-click opens a map, and can start the game for Test Map.

### Windows

The installer and the app are not code-signed, so Windows shows a SmartScreen screen
saying the app is unrecognized. Choose **More info**, then **Run anyway**. The zip needs
no installation: unpack it anywhere and run `scmJS.exe`.

### macOS

Open the dmg and drag scmJS into Applications. macOS refuses to open an app that is not
code-signed, so clear the quarantine flag once, in Terminal:

```sh
xattr -dr com.apple.quarantine /Applications/scmJS.app
```

### Linux

Make the AppImage executable and run it:

```sh
chmod +x scmJS-linux-x86_64.AppImage
./scmJS-linux-x86_64.AppImage
```

Or install the `.deb`:

```sh
sudo apt install ./scmJS-linux-amd64.deb
```

### Updates

The app checks for a new version when it starts (a preference, on by default) and when
you choose Help ▸ Check for Updates…. A new version shows up as a notice with a Download
button; nothing downloads or installs until you ask, and installing asks about unsaved
maps first, as closing the window does. Windows, the AppImage and the `.deb` install the
update themselves. On macOS the app cannot replace itself until it is code-signed, so it
offers the release page instead.

A preference lets the app follow the nightly builds instead of the numbered releases.

### Where it keeps its files

The app's data folder holds the extracted graphics, the window's size and position, and a
log of the last launch:

| System | Folder |
| --- | --- |
| Windows | `%APPDATA%\scm-js` |
| macOS | `~/Library/Application Support/scm-js` |
| Linux | `~/.config/scm-js` |

## In a container

The editor can also run from a container, for a server on your own network or to run it
locally:

```sh
docker run --rm -p 8080:80 ghcr.io/scm-js/scm-js:latest
```

then open `http://localhost:8080`. The image is the same editor as the numbered release
it is tagged with, and carries no game data, so it asks for the graphics like the hosted
editor. To serve graphics you have already extracted instead, see
[game-data.md](game-data.md#the-container-image).

Each release also has `scmJS-web.zip`, the same editor as plain files. Unpack it at the
root of any static web server.

## The graphics

The editor draws terrain and units with graphics out of StarCraft's own archives.
Blizzard's data is not redistributable and none of it ships with the editor, so on first
use it asks where to get them:

![The Game Data dialog on first use, before any graphics are installed](images/game-data.webp)

- **Download from Blizzard.** Blizzard offers the standalone StarCraft map editor as a
  free download, and that package carries the two archives the graphics come from. No
  account, nothing to find on your own disk, about 80 MB. Take this route if you have
  never had the 1.16 game installed.
- **Use your own files.** Pick `StarDat.mpq` and `BrooDat.mpq`, or the folder holding
  them, from a classic (1.16) installation. Remastered installations do not carry these
  archives; use the download above instead.

The extraction runs in the browser and the result is kept for next time; the desktop
app looks for an installation on its own first. If the editor was opened from a link (a
shared map to join, or a copy of a map), that comes first, and the question about the
graphics follows once you have answered it. **Help ▸ Game Data…** brings the dialog
back later, to remove the copy or to install a mod's files beside the game's own as a
second *data set* (see [game-data.md](game-data.md#data-sets)).

Without any graphics the editor still runs: terrain is drawn in flat colours and units as
coloured markers, and everything else works.

## From source

Building the editor yourself needs Node.js 22.18 or newer and git:

```sh
git clone https://github.com/scm-js/scm-js
cd scm-js
npm install
npm run dev            # http://localhost:5173
```

The rest, including building the desktop app and the container image, is in
[development.md](development.md).
