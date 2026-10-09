# Decisions

What was decided, by whom, and why. Newest first within each section. When a
decision is reversed, leave the old entry and add the new one beside it with
the evidence.

## Stack

### Milkdrop starts closed (Ata, 2026-10-08)

Milkdrop costs about 285 MB of private memory while it is open (see the spike
result below), so the app launches with it closed. It is still in the bundle
and opens from Webamp.

### Spike result: Tauri go (ATA-67, 2026-10-08)

The spike ran the release build on Windows 11 from `http://tauri.localhost`
and checked each risk in the running app:

- **Autoplay:** NTS 1 starts with no click, with
  `--autoplay-policy=no-user-gesture-required` in `additionalBrowserArgs`.
  The page reported no user activation while the stream played.
- **CORS:** `streams.radiomast.io` and its edge redirect play through
  Webamp's `crossOrigin="anonymous"` element. `stream-relay-geo.ntslive.net`
  fails from the same page (`fetch`: `TypeError: Failed to fetch`; audio:
  `MEDIA_ELEMENT_ERROR` code 4) because its 302 sends no
  `Access-Control-Allow-Origin`.
- **Milkdrop:** Butterchurn renders and reacts. All four AnalyserNodes in the
  page read live signal (about 330 to 400 of 512 bins non-zero).
- **Window:** frameless and transparent, sized to Webamp's windows, dragged by
  any title bar or the main window's body, resized when windows open or
  close. Transparent gaps show the desktop but still take clicks;
  click-through is not done.
- **Footprint:** NSIS installer 1.50 MiB, MSI 2.02 MiB. Private memory across
  the app and its WebView2 processes: 266 MB stopped, 269 MB playing, 551 to
  722 MB playing with Milkdrop open. Milkdrop accounts for about 285 MB of
  that, in the renderer and GPU processes.

Nothing here needs Electron, which would bring its own Chromium and cost at
least as much memory for the same page. The memory cost is Milkdrop's, so
whether it opens by default is a product call for Ata.

### Licence: MIT (ATA-66, 2026-10-08)

MIT, to match Webamp. The issue suggested it and nothing in the dependencies
argues otherwise. This rules out copying code from GPL-3.0 projects such as
Marconio.

### Tauri 2, not Electron (Ata, 2026-10-08)

The shell is **Tauri 2**: Rust in `src-tauri/`, Vite and TypeScript in `src/`,
rendered by the WebView2 runtime that ships with Windows.

Ata chose it because the app should be as light as possible. A radio player
sits open all day, and Electron ships its own Chromium: an installer of about
90 MB and a heavy resident footprint. Tauri reuses the system WebView, so the
installer is a few MB.

The cost is window behaviour. Electron is the easier route to transparent,
click-through windows, the kind Winamp's separate main, equaliser and playlist
windows want. In Tauri that is harder and may need platform code. The spike
issue (ATA-67) tests it.

**Electron is the fallback only if the spike proves Tauri cannot do the job.**
That outcome gets recorded here with the evidence, and Ata decides; nobody
switches stacks quietly.

### Webamp as the player (2026-10-07 research)

The player is [Webamp](https://github.com/captbaritone/webamp), npm `webamp`
2.x, MIT. It plays live streams through `<audio>`, reports the duration as 0
(so the seek bar is dead) and does not read ICY titles. Milkdrop visuals come
from `webamp/butterchurn`. It renders classic `.wsz` skins only.

[webamp-desktop](https://github.com/durasj/webamp-desktop) is unmaintained
(last active 2023, webamp 1.x). It is a reference, not a fork base.

## Distribution

### Installers, updates and the name (ATA-72, 2026-10-09)

- **Name: "Unofficial NTS Player"**, a working name. Ata had `v0.1.0` ship
  with it on 2026-10-09 and left the final name open. It is the `productName`, so it names the install
  folder, the Start menu and desktop shortcuts, the entry in Settings > Apps
  and the window title. Leading with "Unofficial" makes the shortcut itself
  say what the app is. "Winamp" stays out of it: that is someone else's
  trademark too. The executable keeps the name `nts-desktop-winamp.exe`
  (`mainBinaryName`) so `tools/` and these docs still find the process, and
  the identifier stays `com.datatuna.ntswinamp` so caches and settings carry
  over. The name is effectively fixed once `v0.1.0` ships: the per-user
  install folder and the Settings > Apps entry come from it, so a later
  rename would leave each existing copy in its old folder and need checking.
- **NSIS only, no MSI.** `.github/workflows/release.yml` builds one
  installer on a `v*` tag. It installs per user, needs no administrator
  rights, and is what `latest.json` points the updater at. 2.17 MiB for
  0.1.0. Tauri's MSI installs per machine instead: it needs administrator
  rights, every self-update through it raises a UAC prompt, and installed
  beside the NSIS copy it makes a second entry in Settings > Apps. The issue
  asked for an MSI only if it was cheap, and it is not.
- **Actions that see the signing key are pinned to commits.** The release
  job pins `tauri-action` and `rust-cache` to full SHAs, because a moved
  tag could leak the key, and whoever holds it can push an update every
  installed copy installs without asking. GitHub's own `actions/*` stay on
  version tags, as in `ci.yml`. Bump a pin by resolving the new tag
  (`git ls-remote https://github.com/tauri-apps/tauri-action refs/tags/v0.6.2^{}`)
  and keeping the version comment.
- **Updates install on launch, without asking.** A release build checks
  `releases/latest/download/latest.json` once at startup; if it is newer, it
  downloads, installs in passive mode (a small progress window) and
  restarts. The stream drops for a few seconds. Offline or with no release,
  it plays on and tries again next launch. Debug builds never check.
- **Update signing key** lives in the repository secrets
  `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, never
  in the repo. The public half is in `tauri.conf.json`. If the private key or
  its password is lost, installed copies can never update again and have to
  be reinstalled by hand, so keep a copy outside GitHub. Local builds do not
  need it: `createUpdaterArtifacts` is switched on only by
  `src-tauri/tauri.release.conf.json`, which the workflow passes.
- **No code signing yet.** SmartScreen warns on first run and the README
  says what to click. Options for later:
  - [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/):
    about 10 USD a month, signs from GitHub Actions, and builds SmartScreen
    reputation. It needs an identity check (an organisation with three years
    of history, or an individual in the US or Canada at the time of
    writing), so eligibility needs checking first.
  - An OV code-signing certificate from a CA: roughly 200 to 400 USD a year,
    now issued on a hardware token or a cloud HSM, which makes CI signing
    awkward. Reputation still builds up per certificate over time.
  - An EV certificate used to skip the warning outright; since 2024 it no
    longer does, so it is not worth its price here.
- **Icon:** a pixel-art radio drawn by `tools/make-icon.py`, with nothing
  from the NTS or Winamp marks.

## Product

### Windows behaviour: tray, media keys, one copy, position (ATA-71, 2026-10-09)

- **Tray menu:** Play / Pause, NTS 1, NTS 2, Skin (Random Skin, Skin
  Browser...), Start with Windows, Quit. A left click brings the player
  back. The tooltip is the app's name over the title playing now
  (`NTS 1 - <show> - <location>`, or just `NTS 1` when the live API fails),
  cut to the 127 characters Windows shows.
- **Closing the player still quits.** The tray is not a place to hide the
  window; the issue did not ask for that, and nothing would show the app
  was still playing.
- **Media keys go through Windows' media overlay,** the
  `navigator.mediaSession` setup from ATA-69, not a global hotkey. A global
  hotkey would take the keys from every other player while this one runs;
  through the overlay, Windows sends them to whichever player was active
  last, as it does for browsers and Spotify. Next and previous switch
  channels, wrapping like Webamp's own buttons.
- **One copy:** `tauri-plugin-single-instance`. A second launch shows,
  unminimizes and focuses the first window, then exits.
- **Position:** `tauri-plugin-window-state`, position only, since
  `main.ts` sets the size. It restores a saved position only if it lies on
  a monitor, otherwise the window opens centred. The app then pulls the
  window fully inside that monitor's work area, at launch and whenever the
  window grows (the playlist opens, the show panel appears), so no part of
  it sits off screen or under the taskbar.
- **Start with Windows:** `tauri-plugin-autostart`, off by default, toggled
  from the tray. It writes `HKCU\...\Run`, so it needs no administrator
  rights. The app starts playing NTS 1 at login, as it does on any launch.
- **Clicks on transparent areas go through.** The closest feasible
  behaviour to Winamp's separate windows: the OS window is clipped with
  `SetWindowRgn` to the rectangles of Webamp's windows, its open menus and
  the show panel, so a click in the see-through gap left by a closed
  equaliser reaches the window behind. The alternative, toggling
  `setIgnoreCursorEvents` as the pointer crosses a gap, needs the cursor
  position polled from Rust all the time, since an ignoring window gets no
  mouse events to tell it the pointer came back. Not covered: a skin's
  `region.txt` shape (its transparent corners still take clicks), and
  macOS, where this is phase 2 work.

### Now playing: titles, a show panel, the media overlay (ATA-69, 2026-10-09)

- **Polling:** the live API is asked at launch, a few seconds after the
  earlier of the two channels' shows ends, and at least every 2 minutes. If
  it still reports a show past its end time, it is asked again a second
  into the next minute, when the cache-busting query string changes.
  Each request carries a per-minute query string to get past the CDN's
  15-minute cache (see AGENTS.md, Gotchas).
- **Fallback:** a channel the API does not describe, because the request
  failed or the response changed shape, reads "NTS 1" or "NTS 2". One
  exception: a show already known keeps its title until its end time, so a
  single failed request does not blank a title that is still right. Ata
  confirmed this rule on 2026-10-09.
- **Title format:** `NTS 1 - <show> - <location>`. Ata asked for the
  channel to lead every title. Hyphens rather than the em dash the issue
  suggested, because Winamp's bitmap font has no em dash.
- **The show panel** is a strip under Webamp's windows in the skin's
  playlist colours and font: artwork, the show, and the next show with its
  start time. It is open by default; Alt+3 (Winamp's "file info" key) or its
  × closes it, and that choice is remembered.
- **Windows' media overlay** shows the same title, channel first, with the
  artwork, through `navigator.mediaSession` and the
  `HardwareMediaKeyHandling` WebView2 feature. Its play, pause, next and
  previous buttons, and the keyboard's media keys, drive Webamp: they play,
  pause and switch channels. The seek buttons are removed, since seeking a
  live stream only restarts it.

### Skins: disk cache, random on launch, a separate browser window (ATA-70, 2026-10-08)

- **Startup never waits on the network.** The launch skin comes from the
  local cache: the kept skin, or a random cached one other than the last.
  An empty cache means Webamp's base skin. Right after playback starts, one
  random APPROVED, non-NSFW skin is fetched from the Museum and swapped in;
  in measured launches, audio started no later because of it (0.42 to
  0.79 s, against 0.66 s with no skin). Offline, the cached skin stays.
- **Skins loaded through Webamp itself** (its base skin, Load Skin..., a
  dropped `.wsz`) are not Museum skins: the app forgets its current skin, and
  keeping one gives the base skin on the next launch.
- **The cache is plain files** in `%LOCALAPPDATA%\com.datatuna.ntswinamp\skins`,
  named by md5, written and read through three Rust commands that only the
  main window may call. Over 200 MB, the oldest downloads go first, kept and
  favourite skins included; they download again when next used. Skin
  metadata (name, screenshot, URL) sits in `localStorage`.
- **One Museum query per launch, usually.** The approved count is
  remembered, so a random skin costs one `skins(filter: APPROVED, offset:
  random)` query and one download. The first launch, which has no count
  yet, makes two queries, and a draw that lands on the current skin or an
  NSFW one draws again, at most three times.
- **The browser is its own window**, opened from Webamp's Options > Skins >
  "Skin Browser..." or Alt+S, Winamp's shortcut for it. Fitting it into the
  main window would fight the code that sizes that window to Webamp. Open,
  it costs about 60 MB; closed, nothing.
- **"Keep this skin"** turns random-on-launch off until it is cleared;
  picking another skin while it is on keeps the new one.

### Channel switching, reconnect and saved settings (ATA-68, 2026-10-08)

Within what ATA-68 asked for, these were the choices:

- Next on NTS 2 and previous on NTS 1 wrap to the other channel rather than
  stopping. Keys 1 and 2 pick a channel directly.
- The seek bar is hidden, not disabled: Winamp hides it for streams too, and
  seeking a live stream would only restart it.
- A dropped stream retries the same channel with backoff and never moves to
  the other one. Pause and stop are never undone by a retry.
- Volume and the equaliser and playlist windows are saved. The channel is
  not: the app always opens on NTS 1.

### Random skin on launch, three phases (Ata, 2026-10-08)

- A random approved Skin Museum skin loads on every launch, with a skin
  picker on top.
- Phases: 1 is Windows, 2 is macOS, 3 is NTS Infinite Mixtapes plus Windows
  Media Player skins. Phase 3 stays in scope.
- The project has one coder agent and one reviewer agent, using the same
  review loop as Truck Connect.

## Research findings (2026-10-07)

**Streams.** Use `https://streams.radiomast.io/nts1` and `/nts2` directly:
MP3 at 256 kbps, with open CORS headers. `stream-relay-geo.ntslive.net/stream*`
redirects without CORS headers and will likely fail in the renderer, because
Webamp pipes audio through Web Audio for the visualiser and equaliser, which
needs CORS.

**Now playing.** `https://www.nts.live/api/v2/live` is undocumented and needs
no key. It gives the show title, location, artwork and the end time for each
channel. ICY titles on the streams are empty, so this is the only source.
Playback must not depend on it.

**Skins.** The Skin Museum GraphQL API at `https://api.webamp.org/graphql`
lists about 12.7k approved classic skins, each with a `download_url` on
`r2.webampskins.org` (CORS `*`). Load skins from there at runtime and do not
bundle them, since the skins carry no licence. Winamp Heritage has no API and
should not be scraped. WMP `.wmz` skins have no open-source renderer and are
deferred to phase 3.

**Prior art.** Marconio (Swift, GPL-3.0; do not copy code), everdrone/nts (a
Python downloader, not a player), r-ohan/nts-radio-cli (a Rust TUI).

## Standing rules

The rules these findings produced (stream hosts, skins never committed, the
unofficial look, no Marconio code) are kept in one place: the Invariants
section of [AGENTS.md](../AGENTS.md).
