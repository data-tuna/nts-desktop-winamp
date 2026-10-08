import Webamp from "webamp/butterchurn";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { connectPicker, launchSkin, PICKER_MENU_ENTRY, swapInRandomSkin } from "./skins";

// Always start from streams.radiomast.io: it redirects to a regional edge
// host with CORS on every hop. See AGENTS.md, Invariants.
const STREAMS = [
  { url: "https://streams.radiomast.io/nts1", defaultName: "NTS 1" },
  { url: "https://streams.radiomast.io/nts2", defaultName: "NTS 2" },
];

// How far the pointer moves on a title bar before the press becomes a drag.
const DRAG_THRESHOLD_PX = 3;

const container = document.getElementById("app");
if (!container) {
  throw new Error("#app is missing from index.html");
}

if (!Webamp.browserIsSupported()) {
  container.textContent = "This WebView cannot run Webamp.";
} else {
  void launchSkin().then(start);
}

/** `initialSkin` undefined falls back to the base skin bundled with Webamp. */
function start(initialSkin: { url: string } | undefined): void {
  if (!container) return;
  const webamp = new Webamp({
    initialSkin,
    availableSkins: [PICKER_MENU_ENTRY],
    initialTracks: STREAMS.map((stream) => ({
      ...stream,
      metaData: { artist: "", title: stream.defaultName },
      // A live stream has no length. Without this the playlist shows
      // "InfinityNaN:NaNNaN" for tracks it has not opened yet.
      duration: 0,
    })),
    // Milkdrop starts closed (Ata, 2026-10-08): open, it costs about 285 MB.
    windowLayout: {
      main: { position: { top: 0, left: 0 } },
      equalizer: { position: { top: 116, left: 0 } },
      playlist: { position: { top: 232, left: 0 } },
      milkdrop: { position: { top: 348, left: 0 }, closed: true },
    },
  });
  webamp
    .renderWhenReady(container)
    .then(() => {
      followWebampWindows(webamp);
      // Autoplay with no click relies on WebView2's
      // --autoplay-policy=no-user-gesture-required (tauri.conf.json).
      webamp.play();
      if (initialSkin) URL.revokeObjectURL(initialSkin.url);
      connectPicker(webamp);
      // Offline, the launch skin from the cache simply stays.
      swapInRandomSkin(webamp).catch((error: unknown) =>
        console.error("No new skin this launch", error),
      );
    })
    .catch((error: unknown) => {
      console.error("Webamp failed to render", error);
      container.textContent = "Webamp failed to start.";
    });
}

/**
 * Keeps the frameless OS window wrapped tightly around Webamp's windows, and
 * lets Webamp's title bars drag the OS window instead of moving inside it.
 */
function followWebampWindows(webamp: Webamp): void {
  const appWindow = getCurrentWindow();

  // Webamp marks every title bar part with `.draggable`. Catch the press
  // before Webamp's own handler, which would move the window inside the page,
  // and move the whole OS window instead. The OS drag only starts once the
  // pointer has moved: starting it on the press swallows the mouseup, and
  // with it the double-click that toggles shade mode.
  let press: { x: number; y: number } | null = null;
  window.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.classList.contains("draggable")) return;
      event.preventDefault();
      event.stopPropagation();
      press = { x: event.screenX, y: event.screenY };
    },
    { capture: true },
  );
  window.addEventListener("mousemove", (event) => {
    if (!press) return;
    if ((event.buttons & 1) === 0) {
      press = null;
      return;
    }
    if (Math.hypot(event.screenX - press.x, event.screenY - press.y) < DRAG_THRESHOLD_PX) return;
    press = null;
    // ponytail: the window ignores the pointer's first few pixels, so the grab
    // point ends up that far from the cursor. Fix in ATA-71 if it bothers.
    void appWindow.startDragging();
  });
  window.addEventListener("mouseup", () => {
    press = null;
  });

  webamp.onClose(() => void appWindow.close());
  webamp.onMinimize(() => void appWindow.minimize());

  let lastLayout = "";
  let fitting = false;
  const fit = async (): Promise<void> => {
    const box = webampBounds();
    if (!box) return;
    const layout = `${box.left},${box.top},${box.width},${box.height}`;
    if (layout === lastLayout || fitting) return;
    fitting = true;
    try {
      // Webamp centres its windows in the page on first render. Pin them to
      // the top-left corner instead, so the OS window only has to resize.
      if (box.left !== 0 || box.top !== 0) {
        shiftWebampWindows(webamp, -box.left, -box.top);
      }
      await appWindow.setSize(new LogicalSize(box.width, box.height));
      lastLayout = `0,0,${box.width},${box.height}`;
      // A change that landed while we were fitting gets its own pass. Only
      // after a success: a setSize that keeps failing must not retry every frame.
      requestAnimationFrame(() => void fit());
    } catch (error: unknown) {
      console.error("Could not fit the window to Webamp", error);
    } finally {
      fitting = false;
    }
  };

  webamp.__onStateChange(() => requestAnimationFrame(() => void fit()));
  void fit();
}

/** The union of Webamp's visible windows, in CSS pixels from the viewport origin. */
function webampBounds(): { left: number; top: number; width: number; height: number } | null {
  const windows = document.querySelectorAll<HTMLElement>("#webamp .window, #webamp #main-window");
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const element of windows) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (left === Infinity) return null;
  // Round the edges, not the size, so a fractional rect never loses a pixel.
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(right) - Math.round(left),
    height: Math.round(bottom) - Math.round(top),
  };
}

function shiftWebampWindows(webamp: Webamp, dx: number, dy: number): void {
  const positions = webamp.store.getState().windows.genWindows;
  const shifted = Object.fromEntries(
    Object.entries(positions).map(([id, { position }]) => [
      id,
      { x: position.x + dx, y: position.y + dy },
    ]),
  );
  webamp.store.dispatch({ type: "UPDATE_WINDOW_POSITIONS", positions: shifted, absolute: true });
}
