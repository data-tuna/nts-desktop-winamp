# Decisions

What was decided, by whom, and why. Newest first within each section. When a
decision is reversed, leave the old entry and add the new one beside it with
the evidence.

## Stack

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

### Licence: MIT (ATA-66)

MIT, to match Webamp. The issue suggested it and nothing in the dependencies
argues otherwise. This rules out copying code from GPL-3.0 projects such as
Marconio.

## Product

### Decisions (Ata, 2026-10-08)

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

- The app is unofficial. Do not use the NTS logo in a way that looks
  official, and link to `https://www.nts.live/supporters`.
- Skins are third-party fan works. Fetch them at runtime and cache them
  locally, but never commit them to the repo.
