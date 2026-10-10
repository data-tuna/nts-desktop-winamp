# WMP skin spike (ATA-103). Do not merge.

This branch tests whether Webamp Modern's experimental Windows Media Player
skin engine can render and drive real `.wmz` skins inside this app, with
skin code kept away from Tauri. The findings are on the ATA-103 issue.

## Credit

`vendor/webamp-modern/` is copied from
[captbaritone/webamp](https://github.com/captbaritone/webamp),
`packages/webamp-modern/src` at commit `88ed5815d968c201962f6549915579b3d2f93c5e`.
The WMP engine (`skin/SkinEngine_WindowsMediaPlayer.ts`, `skin/wmpClasses/`)
is by x2nie. Webamp is MIT-licensed, copyright Jordan Eldredge; the licence
is in `vendor/webamp-modern/LICENSE`.

Local changes to the vendored code are marked `ATA-103 patch`:

- `skin/FileExtractor.ts`: decode skin text as UTF-16 (with a BOM) or
  Windows-1252, not UTF-8.
- `skin/SkinEngine_WindowsMediaPlayer.ts`: lower-case tag names before
  parsing, since WMP matches them case-insensitively.
- `skin/wmpClasses/util.ts`: skip a `jscript:` layout expression that
  names a property the engine does not implement, instead of throwing.

## Layout

    wmp-host.html, host.ts   The main window's page. Fetches the .wmz (it
                             can, the frame cannot), posts the bytes into
                             the frame, collects what the frame reports.
    wmp-frame.html, frame.ts The sandboxed frame: <iframe sandbox="allow-scripts">,
                             an opaque origin. Runs the engine and the skin's
                             scripts, plays NTS 1, reports state by postMessage.
    shim.ts                  In-memory localStorage (it throws in the frame).
    run-skin.mjs, click.mjs, DevTools-protocol drivers used for the test runs.
    cdp-frame.mjs

`tauri.conf.json` carries a spike identifier so this build runs next to an
installed copy, and `vite.config.ts` lets the dev server serve the frame's
modules to an opaque origin and read skins from outside the repo.

## Running it

Skins are never committed. Keep them outside the repo, for example
`..\wmp-skins\circle.wmz`.

    npm run tauri dev       with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9344"
    node spike/wmp/run-skin.mjs 9344 circle C:/path/to/wmp-skins out

A release build has no Vite to read the skins through: serve the folder with
CORS on a local port and pass `http://127.0.0.1:<port>` instead of the path.
