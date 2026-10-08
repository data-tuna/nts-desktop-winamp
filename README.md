# nts-desktop-winamp

An unofficial Winamp-style desktop player for [NTS Radio](https://www.nts.live/).
It opens straight into NTS 1, switches to NTS 2 with one click, and wears a
random classic Winamp skin from the [Winamp Skin Museum](https://skins.webamp.org/)
every time it starts.

**This is a fan project. It is not made, endorsed or supported by NTS.** If
you listen a lot, support the station directly:
[nts.live/supporters](https://www.nts.live/supporters).

Status: early. The repository holds the scaffold, a Tauri window running
Webamp with its default skin. Windows comes first, then macOS.

## Credits

- [Webamp](https://github.com/captbaritone/webamp) by Jordan Eldredge and
  contributors is the player: Winamp 2 rebuilt in HTML5 and JavaScript (MIT).
- The [Winamp Skin Museum](https://skins.webamp.org/) hosts the skins. They are
  fan works by their original authors. The app downloads them at runtime and
  caches them on your machine. None are included in this repository or the
  installer.
- [Tauri](https://tauri.app/) is the desktop shell.
- Streams come from NTS via `streams.radiomast.io`.

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
CI runs the same on `windows-latest`, plus `cargo fmt --check`. Conventions for contributors, human or
agent, are in [AGENTS.md](AGENTS.md); the reasoning behind the stack is in
[docs/decisions.md](docs/decisions.md).

## Licence

[MIT](LICENSE). The licence covers this repository's code only. Skins
downloaded from the Skin Museum remain the work of their authors.
