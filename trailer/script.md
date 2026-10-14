# scmJS demo video — script and shot list

Draft 9, 2026-10-01. A demo of what the editor can do, about 4:10; 1920×1080 at 30 fps.

It is a demo of the editor's capabilities rather than a trailer: each feature gets the time
it needs to be followed. The terrain tools go by in a montage near the start; most of the
time goes to the parts other editors don't have: TrigScript, the shared map and the
assistant.

There is no voiceover. Shots 1–3 (the opening, opening maps and the terrain montage) have
no text: the picture explains itself. Every other shot's line
appears as text over the footage: it fades in once the action has started, holds for at
least 2.5 seconds, and fades out before the cut. The time given for each beat is how long the shot runs.

Every shot is recorded from the web editor by `scripts/trailer.mjs`. There is no footage
from the game.

## The text

- Set in the trailer's display face, white with a soft shadow so it reads over any terrain,
  in the lower third and left-aligned, clear of whatever the shot is showing.
- One line at a time, never two on screen together. A line with two sentences shows its
  second sentence half a beat after the first.
- Shot 11's line is the end card itself, not an overlay.

## Sound

Sound effects and music, made with ElevenLabs Sound Effects and Music:

- *Hum:* "Low psionic hum, crystalline overtones, slowly swelling, sci-fi ambience" — under
  the cold open and the end card.
- *Warp:* "Short warp-in whoosh with a bright crystalline shimmer at the end" — on the
  cuts between sections, used sparingly.
- *Chime:* "Soft glassy UI chime, single note" — on a few important clicks.
- *Music:* "Slow ambient choral score, wordless choir and low strings, sacred and alien,
  builds gradually, 98 seconds, ends on a sustained chord" — the bed for the whole trailer.
  The montage wants the music's first build to land under it.

## Shots

The map is *(8)Big Game Hunters* unless a shot says otherwise. The opening uses Enslavers 1
from the game's own campaign folder, a map most players will recognise.

| # | Time | On screen | Text | Sound |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:09 | Black. It fades up on a slow drift across Enslavers 1, Blizzard's own UMS campaign map, full of bases, walls and armies, with the UI, location boxes and start markers hidden (a full-bleed canvas). From 3 s the splash screen's turning globe (on a dark disc), the scmJS name and "A StarCraft 1 / Brood War Map Editor" fade in over the map; they fade out as the shot ends. There is no separate title card. | — | Hum rises; warp and music begin as the logo appears |
| 2 | 0:09–0:23 | File ▸ Open… opens the Open Scenario dialog; a map file is dragged in from the window's edge onto its drop zone, which lights up, and the map opens. Two more maps are dragged onto the window and open in their own tabs; the pointer clicks back to the first tab. | — | Chime on the drop |
| 3 | 0:23–0:49 | **Terrain montage**, six cuts of 1.5–2 s, each on a different tileset, each showing a different tool: (a) the isometric brush raising a ridge on Jungle, cliffs forming, (b) the Rect brush laying an asphalt road on Badlands, (c) the Tile brush painting a picked roof tile on Installation, (d) the Blend brush mending a cliff on Desert: three tiles knocked out of a plateau's cliff face, then the tile beside the gap picked and the matching tiles placed one by one with Follow until the cliff is whole, (e) one stroke repeated four ways by rotational symmetry on Ash World, (f) the elevation overlay switched on over Crescent Moon (Twilight). | — | Cuts on the beat |
| 4 | 0:49–1:20 | **Shared map**, four cuts against the stand-in server: (a) Account ▸ Share this Map…, Start sharing, Copy the link; (b) Kim, in an editor of her own, opens the link, types her name and joins; (c) back in the first editor, Kim's named pointer comes in and her Siege Tanks appear on the dirt by the lake as she places them, Sam's pointer wanders with *in Player Settings* beside it, and high ground is painted here; (d) Kim writes in the chat, the notice and the count on the Chat button come up, the Chat window opens and gets an answer. | *Edit your maps with your friends.* | Hum under it |
| 5 | 1:20–1:59 | **Powerful features montage**, the tools that fit nowhere else: (a) the Melee Wizard on a four-player 64×64 Jungle map, the layout set to Rotate 90°, one click placing all four start locations and *Bases at every start location* laying out every mineral line and geyser; (b) Tools ▸ Replace Terrain turning all of Crescent Moon's Dirt into Water in one step; (c) Tools ▸ Check Map listing what the game would object to; (d) File ▸ Export ▸ Image, the whole map as a picture with the layers to include. | *Use powerful features.* | — |
| 6 | 1:59–2:16 | View ▸ Walkability on Big Game Hunters: the areas in colour, the chokes circled with their widths, then a slow drift across the map. Then two Terran Supply Depots go down in a ramp: the first narrows its choke from 6.8 tiles to 3.8, the second closes it, since buildings are walls to a walking unit. | *See the ground as your units will walk it.* | — |
| 7 | 2:16–2:41 | **TrigScript montage**, six cuts recorded in one session: (a) Triggers ▸ TrigScript… opens the workspace and a start-up trigger is typed; (b) a loop that makes a trigger for each of four players, with completion offering the unit's name; (c) a wave `program()` from an array of waves; (d) Simulate plays the script through and lists each action with its frame and line; (e) a test is typed and passes; (f) Apply, and the Trigger Editor shows the triggers the script made, marked *script*. The code is typed fast, about 140 characters a second, then held on screen to be read; between cuts it jumps ahead off camera. | *Write your triggers in TypeScript.* | Chime on Simulate |
| 8 | 2:41–3:09 | **The assistant**, two cuts against the stand-in server: (a) an empty 96×96 Jungle map with the Assistant panel beside it. A request is typed: *"Make this a four-player madness map: a camp in each corner, Marines that spawn and charge the middle, kills pay minerals, last base standing wins."* The steps come in (▸ reads, ✎ changes): the players set, the corner-camps layout laid over the whole map at once (four camps on high ground with ramps, roads to an arena, water between, a Command Center and named locations in each), the walk from a spawn to the centre checked, the trigger systems built (hyper triggers, the spawns, kills paying minerals, a leaderboard, last one standing), the game's rules checked, a picture taken. The turn folds to one line with its Undo button and the answer. (b) The Trigger Editor with the triggers it wrote, one opened on its actions. | *Use the AI assistant.* | Music peaks, chime as the turn folds |
| 9 | 3:09–3:42 | **Plugins.** Tools ▸ API Playground on Big Game Hunters. A snippet is typed in fast: a function that places a ring of units around the middle of the view, and a panel with a unit list, a count and a Summon button. Run, and the Ring Maker panel appears. The playground is closed and the panel is used on its own: ten Zealots, then twenty Zerglings around them, then thirty Marines around those. | *Write your own plugins.* | Chime on Run |
| 10 | 3:42–3:57 | **Repair.** A protected map is dragged into the editor. The Repair dialog comes up over it with what is wrong (a header with a negative length, a junk section, no ISOM, a zeroed TILE layer); *Repair 5 selected* fixes them and reports the lattice rebuilt. The dialog is closed and the isometric brush paints a plateau across the map. | *Open any map.* | Warp |
| 11 | 3:57–4:08 | End card, black from its first frame: the splash screen's stars and clouds come up; the globe draws itself line by line, spinning down into place, and a ring of light goes out as the last line lands; the scmJS name arrives a letter at a time, then "A StarCraft 1 / Brood War Map Editor", a line, and six labels lighting up in turn (Terrain, Shared Maps, Triggers, TrigScript, Plugins, AI Enabled); last, "In your browser and on your desktop" and scmjs.dev with a glint across it. | (the card itself) | Music resolves on the held chord, hum fades |

## How the shots are recorded

- **Setup.** The Playwright headless shell and extracted game data, as for the guide
  pictures. Each shot or montage cut starts from a dev deep-link
  (`?nosplash&mode=…&zoom=…&tileset=…`) in a fresh browser.
- **Stop-motion.** Each frame is one step of the script (the pointer or view moved a
  little) and a screenshot, so the video is an even 30 fps however slowly the browser
  draws. Set-up that shouldn't be seen (a dialog filled in, a ridge painted before the
  pass is cut) runs with recording off.
- **Pointer.** Headless Chromium draws no cursor, so the script draws one that follows
  the pointer events. It moves at a pace a viewer can follow (the first recordings were too
  fast): every glide is stretched 1.8×, it rests on a button or menu item before clicking,
  and inside an open menu it glides straight to the item without opening the submenus it
  passes.
- **Shot 1** hides the menus and panels so the map fills the frame, and draws the globe with
  the splash screen's own code, one frame at a time in step with the recording.
- **Shot 4** uses the stand-in server the guide pictures already use for shared maps (given a
  chat for it): a second browser window for Kim, a seat the stand-in drives for Sam. The link
  in the Share dialog is shown as the released editor's reads (`editor.scmjs.dev/share/…`), not
  as the development server's.
- **Shot 9** types its snippet into the API Playground at about 220 characters a second.
  The snippet runs as typed.
- **Shot 10** shows a protected map we are free to show: the recording script takes
  Crescent Moon, one of the game's own maps, and does to it what a protector does (ISOM
  removed, TILE zeroed, junk sections added, bytes after a negative-length header). No one
  else's map appears.
- **Shot 8** runs against the same stand-in server, with the assistant's turn scripted in
  it. Every step is one of the assistant's real tools and runs for real in the editor, so the
  map and the triggers on screen are what those tools make. The steps were written by hand;
  running the request once on the live server and copying its steps would make the shot
  exactly what the product does. During the turn the page's clock is stepped a frame at a
  time and the stand-in's stream waits on the same count, so the words and the seconds
  counter run at video speed. The cost strip shows the stand-in's numbers.

## Decided

- A demo video of the editor's capabilities, not a trailer (2026-09-30): about three minutes
  is fine, as long as every feature can be followed.
- Shot 5 is one montage of the tools that fit nowhere else (Melee Wizard, Replace Terrain,
  Check Map, Export Image). Stamp Library is left out: it needs a saved stamp before it shows anything.
- No title card: the logo fades in over the opening drift.
- No text over shots 1–3; the first line is the shared map's.
- The shared map comes straight after the terrain montage (2026-09-30).
- The terrain tools are a fast montage, one tool per cut (Terrain from Image left out); the time goes to TrigScript, the shared map and
  the assistant.
- No footage from the game.
- The assistant has the slot Trigger Map had (2026-10-01), and makes a whole scenario from
  one request rather than a ramp and two cannons. Trigger Map is out of the video.
- No voiceover (the designed voices were tried on 2026-09-29 and dropped); the lines are
  on-screen text.
- The maps are whatever records best: Big Game Hunters, the fixtures, or new ones.
- The assistant is in; the rest of the scmjs.dev account (sign-in, My Maps, balance) is not.

## Still open

- **Plugins that aren't defaults.** Melee Wizard and API Playground are behind Browse
  Plugins. The video shows them without saying so unless you'd rather the text
  mention plugins once.
- **A 30-second cut**, if wanted later: shots 1, 3, 4, 7, 8 and 11.
