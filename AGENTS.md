# AGENTS.md

Conventions for anyone, person or agent, working in this repository. Read
this before touching anything. The *decisions* live in `docs/decisions.md`;
this file is how the project is worked on and what will bite you.

## What this is

**nts-desktop-winamp**, an unofficial Winamp-style desktop player for
[NTS Radio](https://www.nts.live/). It opens straight into NTS 1, switches to
NTS 2 with one click, and loads a random classic skin from the
[Winamp Skin Museum](https://skins.webamp.org/) on every launch.

**The app is unofficial, and it has to look unofficial.** It is a fan-made
player for someone else's radio station, wearing someone else's skins. NTS
does not endorse it. Nothing in the window, the installer, the icon or the
README may use the NTS logo or name in a way that reads as official, and the
app must link listeners to `https://www.nts.live/supporters` (the README and
the skin browser's footer do).

Phases: **1 is Windows**, 2 is macOS, 3 is NTS Infinite Mixtapes plus Windows
Media Player skins. Windows comes first, and nothing in phase 1 should make
macOS harder than it needs to be.

Written in English.

## Layout

    src/                  The frontend: Vite + TypeScript. main.ts mounts Webamp,
                          keeps the OS window fitted to Webamp's windows
                          and clipped to them, reconnects dropped streams,
                          saves settings and runs the tray's player entries.
                          skins.ts picks, caches and applies Museum skins.
                          picker.ts is the skin browser window (picker.html).
                          live.ts reads the NTS live API; nowPlaying.ts puts
                          the show in the titles, the show panel and
                          Windows' media overlay.
    src-tauri/            The Rust shell (Tauri 2). Window config in tauri.conf.json,
                          permissions in capabilities/. lib.rs holds the skin
                          cache commands, the update check, the tray, and
                          the window's position and click-through region.
    src-tauri/icons/      App icons, generated: tools/make-icon.py, then
                          `npx tauri icon`. Drop the android/ and ios/ output.
    docs/decisions.md     Stack choice, research findings, and why.
    tests/                `node --test` tests and their fixtures.
    .github/workflows/    ci.yml checks every PR; release.yml builds and
                          publishes the installer on a v* tag. Both on
                          windows-latest.
    tools/                Scripts for observing the running app: window
                          screenshots, RAM, DevTools-protocol probes, and
                          what Windows' media overlay shows. Also
                          make-icon.py, which draws the icon (needs Python
                          with Pillow).

The player is [Webamp](https://github.com/captbaritone/webamp) (npm `webamp`
2.x), imported as `webamp/butterchurn` so the Milkdrop window works. Tauri
renders the frontend in the WebView2 runtime that ships with Windows.

The window is frameless and transparent. Webamp draws its main, equaliser,
playlist and Milkdrop windows inside it, and `main.ts` resizes the OS window
to the box around whichever are open. Pressing any `.draggable` element
(Webamp's title bars, and the main window's body) drags the whole OS window
through `startDragging` once the pointer moves 3 px, so Webamp's windows
never move relative to each other and double-clicks still reach Webamp.

## Commands

    npm install
    npm run tauri dev     The app, with the Vite dev server on :1420
    npm run typecheck     tsc, no emit
    npm run lint          oxlint, warnings fail
    npm run build         Frontend only, into dist/
    npm test              node --test on tests/ (Node 22.18+ runs the .ts imports)
    npm run check         lint + typecheck + build + test; CI runs this plus cargo fmt
    npm run tauri build   Release binary and the NSIS installer (slow, minutes)

    cargo fmt --manifest-path src-tauri/Cargo.toml --check

Rust lives in `%USERPROFILE%\.cargo\bin`. A shell that cannot find `cargo` is
missing that directory on `PATH`; see the README for setup.

**A change is not finished until `npm run check` passes and you have run the
app and looked at it.** Webamp renders into a canvas-and-sprite UI that a
typecheck knows nothing about.

## Invariants

**Streams come from `https://streams.radiomast.io/nts1` and `/nts2`.** They
are MP3 at 256 kbps and send open CORS headers, which Webamp needs because it
routes audio through Web Audio for the visualiser and equaliser.
`stream-relay-geo.ntslive.net/stream` answers with a 302 to radiomast that
carries no CORS headers, so a cross-origin fetch fails at that first hop.
radiomast itself then redirects to a regional `audio-edge-*.radiomast.io`
host, with CORS on every hop. Those edge hosts move, so never hard-code one:
always start from `streams.radiomast.io`.

**Playback never depends on the now-playing API.** `https://www.nts.live/api/v2/live`
is undocumented and can change or vanish. When it fails, the titles fall back
to "NTS 1" and "NTS 2" and the music keeps playing.

**Skins are fetched at runtime and never committed.** Skin Museum skins are
third-party fan works with no licence. They come from
`https://api.webamp.org/graphql` (APPROVED only, NSFW skipped), are cached on
the user's machine, and never enter this repository or the installer. The
only skin that ships is Webamp's own base skin inside the npm package. Be
polite to the Museum: one skin per launch, no bulk downloads.

**No code from Marconio.** It is GPL-3.0 and this project is MIT. Reading it
for ideas is fine; copying is not.

## Gotchas

**Webamp reports a live stream's duration as 0.** The time display counts up
from zero, which is expected for a radio stream. Seeking would restart the
stream, so `styles.css` hides the seek bar with `display: none`; `visibility`
does not work, because Webamp forces the thumb visible while playing.

**Webamp skips to the next track when a stream fails.** Its media layer turns
every audio error into "ended", and "ended" dispatches next, so a network drop
on NTS 1 used to start NTS 2. `main.ts` replaces that listener: a drop, or a
clock that has not moved for 10 s while playing, reloads the same channel with
backoff (1, 2, 4, then every 8 s). A failed load usually errors at once, so
those are the gaps; one that just hangs waits out the 10 s first. Pause, stop
and a channel switch cancel a pending retry and reset the backoff, and Play
after a drop reloads the stream rather than resuming the dead one. Next on
NTS 2 and previous on NTS 1 wrap to the other channel instead of stopping.

**ICY titles are empty on these streams.** Webamp does not read ICY metadata
anyway. The track title comes from the NTS live API or the fallback.

**The NTS live API is cached for 15 minutes.** It answers with
`Cache-Control: max-age=900` and CloudFront honours it, so a bare request
can return the show that ended a quarter of an hour ago. `live.ts` adds a
query string that changes once a minute: a fresh answer, while every client
in the same minute still shares one cache entry. `broadcast_title` arrives
HTML-escaped (`&amp;`).

**Titles use ` - `, not ` — `.** Webamp draws the scrolling title from the
skin's bitmap font, which has a hyphen but no em dash; an em dash comes out
as a blank cell.

**Windows' media overlay needs `HardwareMediaKeyHandling`.** WebView2 keeps
`navigator.mediaSession` to itself unless that Chromium feature is on, so
`tauri.conf.json` enables it. The overlay then lists the app as
`msedgewebview2.exe`, not by its own name. Webamp's `enableMediaSession`
sets the metadata only when the track changes; `nowPlaying.ts` sets it again
after every API answer.

**Webamp with Butterchurn is ~2.0 MB minified.** `vite.config.ts` sets the
chunk warning limit to 2100 kB for that reason: about 1.1 MB of it is
Butterchurn and its presets. Do not raise it further to hide a real
regression.

**`webamp/butterchurn` ships without its types.** Its `package.json` points
at a `butterchurn.d.ts` that is not in the package, so
`src/webamp-butterchurn.d.ts` reuses the main entry's types. Drop the shim if
a later Webamp release fixes it.

**`additionalBrowserArgs` replaces Tauri's WebView2 defaults.** Tauri
normally passes `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`;
setting the option drops that, so `tauri.conf.json` repeats it before
`--autoplay-policy=no-user-gesture-required` and
`--enable-features=HardwareMediaKeyHandling`. Keep all three when adding flags.

**The window is clipped to Webamp.** With the equaliser closed between the
main window and the playlist, the gap is see-through. `main.ts` sends the
rectangles of Webamp's windows, its open menus and the show panel to
`set_hit_region`, which sets them as the window's region (`SetWindowRgn`),
so clicks in the gap reach whatever is behind. Anything new drawn outside
those (another panel, a tooltip) is cut off until it is added to the
selector in `clickThroughGaps`. A skin's `region.txt` shape is not
followed: its transparent corners still take clicks.

**One copy runs at a time.** A second launch hands over to the first and
exits, which brings the player back. That includes a release build started
from `src-tauri\target\release` while the installed copy runs: quit one to
test the other.

**The window's position is saved on quit,** in
`%APPDATA%\com.datatuna.ntswinamp\.window-state.json`. A killed process
saves nothing; a self-update saves first. At launch, and each time
`main.ts` resizes the window to Webamp, `lib.rs` pulls a window that is
partly off screen back inside its monitor's work area.

**A drag lags the pointer by a few pixels.** The OS drag starts only after
the pointer has moved 3 px and `startDragging` has returned, and the window
never makes up that distance, so the point you grabbed ends up a few pixels
from the cursor. Starting the drag on the press instead would break
double-click shade. Not fixed yet.

**`main.ts` leans on Webamp internals.** It listens with
`webamp.__onStateChange`, moves windows with an `UPDATE_WINDOW_POSITIONS`
dispatch on `webamp.store`, replaces the "ended" listeners in
`webamp.media._emitter`, passes `__customMiddlewares`, and dispatches
`PLAY_TRACK` / `BUFFER_TRACK` and swallows `IS_STOPPED`. `clickThroughGaps`
measures Webamp's DOM: `#webamp .window`, `#main-window` and the menus under
`#webamp-context-menu`. `nowPlaying.ts`
writes titles with `SET_MEDIA_TAGS` and reads `skinPlaylistStyle` for the
show panel's colours. None of it is public API; check all of it when
upgrading Webamp.

**`search_skins` returns rejected, unreviewed and NSFW skins.** Only the
`skins(filter: APPROVED)` query is pre-filtered. `searchSkins` in `skins.ts`
keeps a hit only if `nsfw` is false and every review on it is `APPROVED`.

**The skin browser hooks Webamp's menu.** Its entry is an `availableSkins`
item whose url is a placeholder; a capture-phase click listener in
`skins.ts` stops Webamp fetching it and closes the menu by clicking the
body. The match is on the label text, so keep the two in step.

**Webamp shows an `alert()` when a skin fails to parse.** No Museum skin has
done so yet; if one does, the user sees the dialog and keeps the old skin.

**The WebView opens no new windows.** A `target="_blank"` link does
nothing; the picker sends its links through the opener plugin, and
`capabilities/picker.json` allows exactly those URLs. Add a URL there when
you add a link.

**The executable is not named after the product.** `productName` is
"Unofficial NTS Player" (the installer, shortcuts and window title), but
`mainBinaryName` keeps `nts-desktop-winamp.exe`, which `tools/` and the
commands here rely on. The installed copy lives in
`%LOCALAPPDATA%\Unofficial NTS Player`.

**Release builds update themselves on launch.** A release binary whose
version is older than the latest GitHub release downloads that release's
installer, runs it (which installs or updates the per-user copy) and quits,
even when it was started from `src-tauri\target\release`. Keep the version
in a branch current before measuring a release build. Debug builds
(`tauri dev`) never check. Updater artifacts are signed only when
`tauri.release.conf.json` is passed, as the Release workflow does; a plain
`npm run tauri build` needs no key.

**`tauri dev` needs port 1420 free.** Vite runs with `strictPort`, so a
leftover dev server makes the next launch fail rather than pick another port.

## Observing the running app

Webamp's `<audio>` element is never attached to the DOM, so it does not show
up in a selector. To look inside the app, start it with WebView2's DevTools
port open, then use the probes in `tools/`:

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9333 --autoplay-policy=no-user-gesture-required"
    src-tauri\target\release\nts-desktop-winamp.exe
    node tools/cdp.mjs 9333 "location.href"     Any expression, in the page
    node tools/cdp-audio.mjs 9333               Every audio element's state
    node tools/cdp-analysers.mjs 9333           Signal in every AnalyserNode
    node tools/cdp-shot.mjs 9333 shot.png [picker]   What the renderer paints
    powershell -File tools/window-shot.ps1 nts-desktop-winamp shot.png
    powershell -File tools/ram.ps1 nts-desktop-winamp
    powershell -File tools/smtc.ps1             What Windows' media overlay shows

The environment variable carries the autoplay flag too, so a debug run plays
the way a normal one does. `window-shot.ps1` captures only the app's own
window (transparent areas come out black), never the desktop behind it, but
after a skin change it can return a stale frame still showing the old skin;
`cdp-shot.mjs` shows what is actually painted.
`ram.ps1` sums the app and all of its WebView2 processes. The DevTools
probes talk to the first page in the target list, which is the skin browser
when that is open; close it first.

To see the now-playing fallback, add
`--host-resolver-rules="MAP www.nts.live ~NOTFOUND"` to the browser
arguments: the API fails, the titles read "NTS 1" and "NTS 2", and the
stream plays as before.

**Two instances share one WebView2 profile.** A second copy of the app (another
checkout, another agent) joins the first one's browser process, its DevTools
port and its `localStorage`, so probes can land in the wrong window. Give each
run its own profile with `$env:WEBVIEW2_USER_DATA_FOLDER = "$PWD\.wv2-test"`
and its own port. `window-shot.ps1` and `ram.ps1` pick a process by name, so
they cannot tell two instances apart either.

To test reconnecting without cutting the machine's network, add
`--proxy-server=http://127.0.0.1:<port>` to the browser arguments and run a
CONNECT proxy you can stop. DevTools' offline emulation does not interrupt a
stream that is already playing, so it proves nothing here.

## Where the decisions are

    docs/decisions.md     Tauri over Electron, and the research behind it.
                          Add an entry when you make or reverse a decision.

Project tracking lives in the Multica project *nts-desktop-winamp*, not here.
Ata decides anything that is not already written down.

## Working agreement

One issue at a time; the issue is the contract and its "Done when" is the
bar.

Branches are named `agent/<name>/<issue-key>-short-description`, for example
`agent/lama/ata-66-bootstrap`. Nothing is committed to `main` directly. Every
change lands as a PR against `main` with the issue key in the title
(`ATA-66: ...`), and goes through the review loop: the reviewer's findings are
fixed or answered with evidence until it approves with none left.

Verify, don't assert. Run the app and observe: screenshots of the window,
audio actually playing, measured RAM and installer size. UI changes carry
before and after screenshots in the PR.

Keep this file, `CLAUDE.md` and `docs/decisions.md` true in the same branch
as the change that makes them stale.

## Known gaps

**No content security policy.** `tauri.conf.json` has `"csp": null`, the
scaffold default. A CSP should allow exactly the stream, skin and
now-playing hosts (`www.nts.live`, and the `media*.ntslive.co.uk` artwork
hosts) plus what Webamp needs (`blob:`, `data:`, inline styles).

**Webamp still says 192 kbps.** The streams are 256 kbps (`icy-br: 256`);
the display is Webamp's default, not a measurement.

**PR CI does not build the Rust side.** It runs typecheck, lint, the
frontend build, the tests and `cargo fmt --check`. Only a release tag runs a
full `tauri build`, so a Rust break can first show up there.

**The installer is not code-signed.** SmartScreen warns on first run; the
options are in `docs/decisions.md`.
