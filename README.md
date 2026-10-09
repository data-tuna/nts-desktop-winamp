# nts-desktop-winamp

An unofficial Winamp-style desktop player for
[NTS Radio](https://www.nts.live/), in progress. The plan: it opens straight
into NTS 1, switches to NTS 2 with one click, and wears a random classic
Winamp skin from the [Winamp Skin Museum](https://skins.webamp.org/) every time
it starts.

**This is a fan project. It is not made, endorsed or supported by NTS.** If
you listen a lot, support the station directly:
[nts.live/supporters](https://www.nts.live/supporters).

Status: early. The app opens a frameless Webamp window and starts NTS 1 on
its own, wearing a random skin from the Skin Museum. To search for a skin,
keep favourites or keep one skin, open Options > Skins > Skin Browser, or
press Alt+S. Switch channels with next or previous, by double-clicking NTS 1
or NTS 2 in the playlist, or with the 1 and 2 keys. If the stream drops, it
reconnects to the same channel by itself. Volume and whether the equaliser
and playlist are open carry over to the next launch; the channel does not:
it always starts on NTS 1. Milkdrop starts closed and opens from Webamp. The
scrolling title, the playlist and Windows' media overlay show what is on air,
from the NTS website's schedule; a panel under the player adds the show's
artwork and what comes next, and Alt+3 or its × hides it. Windows comes
first, then macOS.

## Install (Windows)

Download `Unofficial.NTS.Player_<version>_x64-setup.exe` from the latest
[release](https://github.com/data-tuna/nts-desktop-winamp/releases/latest)
and run it. It installs for your user only, so it needs no administrator
rights, and adds a Start menu and a desktop shortcut.

**Windows SmartScreen will warn you.** The installer is not code-signed, so
Windows shows "Windows protected your PC". Click **More info**, then **Run
anyway**. Your browser may also flag the download as uncommon; keep it.

The app updates itself. Each time it starts, it checks GitHub for a newer
release; if there is one, it installs it and restarts, which interrupts the
stream for a few seconds. Updates are signed, and the app refuses one whose
signature does not match.

Uninstall from Settings > Apps. Cached skins stay in
`%LOCALAPPDATA%\com.datatuna.ntswinamp`; delete that folder to remove them.

## Credits

- [Webamp](https://github.com/captbaritone/webamp) by Jordan Eldredge and
  contributors is the player: Winamp 2 rebuilt in HTML5 and JavaScript (MIT).
- The [Winamp Skin Museum](https://skins.webamp.org/) hosts the skins. They are
  fan works by their original authors. The app downloads them at runtime
  and caches up to 200 MB of them on your machine. None are included in this
  repository or the installer.
- [Tauri](https://tauri.app/) is the desktop shell.
- Streams will come from NTS via `streams.radiomast.io`.

## Development

You need Windows 10 or 11 with:

1. **Node.js** 22.12 or newer (20.19 also works).
2. **Microsoft C++ Build Tools**: install
   [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and tick "Desktop development with C++".
3. **WebView2**: already present on Windows 11 and current Windows 10.
4. **Rust** with the MSVC toolchain:

   ```powershell
   winget install --id Rustlang.Rustup
   rustup default stable-msvc
   rustup target add x86_64-pc-windows-msvc
   ```

   `rustup` installs into `%USERPROFILE%\.cargo\bin`. Open a new terminal so
   that directory is on `PATH`, then check with `cargo -V`.

Then:

```powershell
npm install
npm run tauri dev
```

The first `tauri dev` compiles about 340 Rust crates and takes a minute or
two. Later runs reuse the build.

Before opening a PR, run `npm run check` (typecheck, lint, frontend build).
CI runs the same on `windows-latest`, plus `cargo fmt --check`. Conventions
for contributors, human or agent, are in [AGENTS.md](AGENTS.md); the reasoning
behind the stack is in [docs/decisions.md](docs/decisions.md).

## Releasing

1. Set the same version in `package.json` and `src-tauri/Cargo.toml`, run
   `npm install` and `cargo check` so the lockfiles follow, and merge that
   to `main`.
2. Tag `main` and push the tag:

   ```powershell
   git tag v0.1.1
   git push origin v0.1.1
   ```

The Release workflow builds the installer on `windows-latest`, signs it
for the updater with the `TAURI_SIGNING_PRIVATE_KEY` and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets, and publishes a
GitHub Release with `latest.json`, which installed copies read. It fails if
the tag does not match both versions.

## Licence

[MIT](LICENSE). The licence covers this repository's code only. Skins
downloaded from the Skin Museum remain the work of their authors.
