# Metropolis

Metropolis is a city builder that runs in the browser. Zone land, build roads and utilities, fund services, and manage a city budget. The app uses TypeScript, Vite and three.js.

Release version: TODO(release).

## Run locally

Use Node.js 22.x at 22.12 or later, 24.x, or 26 and later, with npm. These are the Node engine ranges shared by the locked development tools.

From the repository root:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The configured development port is 5173.

## Build

```sh
npm run build
npm run preview
```

The build runs TypeScript checks, then writes the production app to `dist/`. Preview serves that build locally; use the URL printed in the terminal. The build uses relative asset paths for static hosting. Serve it over HTTP or HTTPS.

To run only the TypeScript checks:

```sh
npm run typecheck
```

Rust is not needed for the playable build. The WebAssembly binary is committed. Rebuilding it is covered in [the WebAssembly notes](wasm/README.md).

## Requirements and tested systems

The 3D city and region map require WebGL2. Use a browser with hardware acceleration enabled. The city controls support a keyboard and mouse.

The recorded desktop checks use Chromium 141 on Windows 10 with an NVIDIA GeForce RTX 5070 Ti through ANGLE/Direct3D 11. Cloud functional checks also use Chromium with SwiftShader software rendering. See the [desktop GPU report](docs/dev/reports/local-T003-gpu-smoke.md) and [worker QA report](docs/dev/reports/local-W1.2-worker.md).

These are tested configurations, not minimum hardware specifications. Low quality targets integrated GPUs, but the docs do not establish a tested integrated-GPU minimum. Firefox and WebKit checks remain unverified in [the performance plan](docs/WASM_PLAN.md#8-risks).

## Playing

Create a region, select a tile, and found a city. Small, Medium and Large tiles have 64, 128 and 256 cells per side. Return to the region map to play another city. Neighbor connections can link city job markets.

A new city starts paused. Place roads, zones and utilities, then press Space to run it. F1 opens Help & shortcuts. Use **Show getting-started guide** there to reopen the guide.

- Residential, commercial and industrial zones grow with demand. Transport, power, water, pollution and services affect the city.
- Emergencies within a station's driving reach receive automatic dispatch. Incidents beyond that reach may need manual dispatch. Use **Send nearest** or **Choose station…** on an alert, or open the Emergencies panel.
- The procedural Web Audio soundtrack changes with the city. The music player has playback controls and a track list.
- New Year fireworks mark January 1. Settings control the show, its camera and how often the full celebration runs.
- Cities can grow past one million residents. The rank ladder reaches Megacity at one million and Megalopolis at 1.5 million.

Choose Easy, Medium, Hard or Sandbox when founding a city. Easy gives more starting money and a more forgiving start. Medium is the standard balance. Hard starts with less money and lower tax income. Sandbox has unlimited money and everything unlocked. The New City dialog also lets you choose whether disasters occur.

## City controls

Camera letter keys use physical keyboard positions. Tool and panel letters follow the typed letter. Shortcuts yield to text fields. A tool can take priority: R rotates a building while placing it.

| Input | Action |
| --- | --- |
| W/A/S/D or arrow keys | Pan the camera |
| Middle-drag or Shift + right-drag | Pan the camera |
| Right-drag | Orbit and tilt |
| Q / E | Rotate by 90 degrees |
| Page Up / Page Down | Tilt |
| Mouse wheel; + / - | Zoom; a terrain or tree brush (main-row + / -) resizes instead. Numeric keypad + / - still zooms. |
| Home | Recenter the camera |
| Left-click with Query; left-drag with Query | Inspect; pan |
| Left-click or left-drag with a building tool | Place a building or draw an area/path |
| Space | Pause or resume |
| 1 / 2 / 3, including the numeric keypad | Normal / Fast / Ultra speed |
| Ctrl+S or Cmd+S | Save the city |
| F1 or ? | Help & shortcuts |
| Esc | Back out one step; open the pause menu when nothing else is active |
| R / C / I | Residential / commercial / industrial zoning; repeat to cycle density or farms |
| T | Roads; repeat to cycle road types |
| L / U | Power lines / subway |
| X | De-zone |
| B, Delete or Backspace | Bulldoze |
| V | Query / inspect |
| K | Terraform; repeat for raise, lower, level and smooth |
| R while placing a building; Shift+R | Rotate; rotate the other way |
| Shift while drawing a road | Flip the corner |
| [ / ] with a brush | Decrease / increase brush size |
| Right-click during an area/path drag | Cancel the drag |
| M / G / J | Budget / graphs / city statistics |
| N / O / Y / P | Advisors & news / data views / ordinances / demographics |

On the region map, right-drag rotates and the wheel zooms. Q/E rotate by 45 degrees there. Home resets the region camera. Left-drag or the arrow keys pan. Click a tile to select it, double-click to play its city or found one, Esc to deselect.

## Settings

Open Settings from the title screen, the region screen's gear, the city top bar's gear, or the pause menu. Settings are stored in this browser. The title and region Settings dialog also offers **Play music**, **Mute all** and **Default quality**. The city panel offers:

- **Graphics:** Low, Medium, High or Ultra quality; day/night cycle or a fixed hour. The first run chooses a quality preset from the device.
- **Gameplay:** autosave Off, every 3 or 6 game months, or yearly; pause when hidden; New Year Cinematic, Fireworks or Off; Milestones or Every year show pacing; show camera on/off. The normal app autosave default is 3 game months.
- **Emergencies:** Live speed, Pause or Keep going when manual dispatch is needed; Major or All alerts; LIVE slowdown from normal speed to 5 times slower.
- **Camera and interface:** edge scrolling, building grid, UI scale from 70% to 150%, notifications and the FPS display.
- **Audio:** master, music, effects and ambience volumes; interface and hover sounds; pauses between songs; background muting; music playback and track selection; now-playing pop-ups.

## URL options

Append these to the game URL. Join options with `&`, for example `?simworker=1&simwasm=blur:auto`.

| Option | Effect |
| --- | --- |
| `simworker=1` | Opt in to running the simulation in a dedicated Web Worker. It remains opt-in until Worker step W1.4. A worker boot failure falls back to the main thread. |
| `simworker=0` | Use the main thread, which is the current default. |
| `simworker=loopback` | Diagnostic mode: run the worker protocol on the main thread. |
| `simwasm=blur:auto` | Use the WebAssembly blur kernel when ready and JavaScript otherwise. Blur uses JavaScript by default. |
| `simwasm=js` | Keep simulation kernels on JavaScript. |

The following are disposable testing shortcuts. **Reloading them deletes and recreates their test region.** Remove the shortcut before continuing a saved game through the title screen.

| Option | Effect and extra options |
| --- | --- |
| `quickstart=1` | Create a city in the fixed `quickstart` region. Accepts `size=small`, `medium` or `large` (also `64`, `128`, `256`), numeric `seed`, `difficulty`, `terrain` and `climate`. |
| `region=1` | Recreate a region keyed by `preset` and numeric `seed`, then open its map. `demo=1` populates demo cities; `cities` sets their requested count. |
| `newcity=1` | Recreate the same kind of test region, then open the New City dialog on a medium tile. Accepts the region options above. |

For these shortcuts, difficulty values are `easy`, `medium`, `hard`, `sandbox`. Terrain values are `region`, `flat`, `plains`, `hills`, `mountains`, `river`, `coast`, `islands`, `lakes`; `region` keeps the tile's terrain. Climate values are `temperate`, `desert`, `tropical`, `alpine`. Region presets are `greenvale`, `azure-coast`, `twin-rivers`, `highlands`, `archipelago`, `desert-basin`, `random`.

## Saving and export

Save with Ctrl+S/Cmd+S, the save indicator or **Save city** in the pause menu. **Save & exit to region** saves before returning to the map. Autosave uses the interval in Settings, at most once a minute. The app also saves when the tab is hidden and offers recovery when it finds newer unsaved progress. Only one browser tab can save a region at a time; another tab opens it read-only.

Cities and regions are stored locally in IndexedDB. On the region screen, use the download icon (**Export region (.metropolis)**) to download a `.metropolis` file containing the region and all its saved cities. Load Region also has a download icon (**Export .metropolis file**). Use the region screen's upload icon (**Import region file**) or **Import file…** in Load Region to restore one. An import with an existing region ID receives a new ID by default.

## Known limits

- Without WebGL2, the region loader can remain stuck. WebGL2 is required for this build.
- When IndexedDB is unavailable, storage falls back to memory. That progress is lost on reload. Clearing browser storage also removes local saves; region exports provide a separate copy.
- If browser storage fills up, the **Storage full** dialog offers **Export** and **Manage storage**.
- Export uses gzip when the browser supports it. Importing a compressed export requires `DecompressionStream` support.
- Worker mode is still opt-in. Recovery after closing a tab can lose progress since the last save or recovery snapshot.
- Busy cities can repeatedly enter emergency LIVE speed. **Keep going** in Settings leaves the chosen simulation speed in place, apart from a one-time tip on the first emergency.
- Large cities and high graphics settings need more resources. Key rebinding and separate text-size, motion and colour-vision controls are still pending.

## Release measurements

| Item | Release result |
| --- | --- |
| Frame rates, with hardware, city, resolution and quality | TODO(release) |
| Soak duration and result | TODO(release) |
| Save and exported-region sizes | TODO(release) |
