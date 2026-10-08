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
app must link listeners to `https://www.nts.live/supporters` (the README does
already; the app does not yet, see Known gaps).

Phases: **1 is Windows**, 2 is macOS, 3 is NTS Infinite Mixtapes plus Windows
Media Player skins. Windows comes first, and nothing in phase 1 should make
macOS harder than it needs to be.

Written in English.

## Layout

    src/                  The frontend: Vite + TypeScript. main.ts mounts Webamp
                          and keeps the OS window fitted to Webamp's windows.
    src-tauri/            The Rust shell (Tauri 2). Window config in tauri.conf.json,
                          permissions in capabilities/.
    src-tauri/icons/      App icons. Still the Tauri defaults; see Known gaps.
    docs/decisions.md     Stack choice, research findings, and why.
    .github/workflows/    CI. Runs on windows-latest.
    tools/                Scripts for observing the running app: window
                          screenshots, RAM, and DevTools-protocol probes.

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
    npm run check         lint + typecheck + build; CI runs this plus cargo fmt
    npm run tauri build   Release binary and installers (slow, minutes)

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

**Webamp reports a live stream's duration as 0.** The seek bar is dead and
the time display counts up from zero. That is expected for a radio stream,
not a bug to fix.

**ICY titles are empty on these streams.** Webamp does not read ICY metadata
anyway. The track title comes from the NTS live API or the fallback.

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
`--autoplay-policy=no-user-gesture-required`. Keep both when adding flags.

**Transparent gaps catch clicks.** When the equaliser is closed between the
main window and the playlist, the gap is see-through but still belongs to the
app window: clicks there do not reach the desktop. Click-through needs
platform code and is not done.

**Fitting the window uses Webamp internals.** `main.ts` listens with
`webamp.__onStateChange` and moves windows with an `UPDATE_WINDOW_POSITIONS`
dispatch on `webamp.store`. Neither is public API; check both when upgrading
Webamp.

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
    powershell -File tools/window-shot.ps1 nts-desktop-winamp shot.png
    powershell -File tools/ram.ps1 nts-desktop-winamp

The environment variable carries the autoplay flag too, so a debug run plays
the way a normal one does. `window-shot.ps1` captures only the app's own
window (transparent areas come out black), never the desktop behind it.
`ram.ps1` sums the app and all of its WebView2 processes.

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
scaffold default. Once the stream, skin and now-playing hosts are wired in, a
CSP should allow exactly those origins plus what Webamp needs (`blob:`,
`data:`, inline styles).

**No supporters link in the app yet.** The README links
`nts.live/supporters`; the window will once there is UI beyond Webamp.

**Icons are Tauri's defaults.** They need replacing before the installer
issue, with something that does not borrow the NTS logo.

**Webamp still says 192 kbps.** The streams are 256 kbps (`icy-br: 256`);
the display is Webamp's default, not a measurement.

**CI does not build the Rust side.** It runs typecheck, lint, the frontend
build and `cargo fmt --check`. A full `tauri build` on `windows-latest` waits
for the installer issue.
