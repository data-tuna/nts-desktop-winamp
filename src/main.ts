import Webamp from "webamp/butterchurn";
import type { Middleware, MiddlewareStore } from "webamp";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { showNowPlaying } from "./nowPlaying";
import { connectPicker, launchSkin, PICKER_MENU_ENTRY, swapInRandomSkin } from "./skins";

// Always start from streams.radiomast.io: it redirects to a regional edge
// host with CORS on every hop. See AGENTS.md, Invariants.
// NTS 1 first: nowPlaying.ts matches these to the live API's channels by index.
const STREAMS = [
  { url: "https://streams.radiomast.io/nts1", defaultName: "NTS 1" },
  { url: "https://streams.radiomast.io/nts2", defaultName: "NTS 2" },
];

// How far the pointer moves on a title bar before the press becomes a drag.
const DRAG_THRESHOLD_PX = 3;

const SETTINGS_KEY = "player";

// Reconnect backoff: 1 s, 2 s, 4 s, then every 8 s until the stream is back.
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
// Playing, but the clock has not moved for this long: the stream is stuck.
const STALL_MS = 10000;

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
  const saved = loadSettings();
  const reconnect = reconnectOnDrop();
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
      equalizer: { position: { top: 116, left: 0 }, closed: !saved.equalizer },
      playlist: { position: { top: 232, left: 0 }, closed: !saved.playlist },
      milkdrop: { position: { top: 348, left: 0 }, closed: true },
    },
    __customMiddlewares: [wrapAtPlaylistEnds, reconnect.middleware],
    // Windows' media overlay. Its title and artwork come from showNowPlaying.
    enableMediaSession: true,
  });
  if (typeof saved.volume === "number") webamp.setVolume(saved.volume);
  reconnect.watch(webamp);
  bindChannelKeys(webamp);
  webamp
    .renderWhenReady(container)
    .then(() => {
      followWebampWindows(webamp);
      webamp.__onStateChange(() => saveSettings(webamp));
      // Autoplay with no click relies on WebView2's
      // --autoplay-policy=no-user-gesture-required (tauri.conf.json).
      webamp.play();
      showNowPlaying(webamp, STREAMS);
      connectTray(webamp);
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

interface Settings {
  volume?: number;
  equalizer: boolean;
  playlist: boolean;
}

/** Volume and which windows were open last time. The channel is not saved: launch is always NTS 1. */
function loadSettings(): Settings {
  const defaults: Settings = { equalizer: true, playlist: true };
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    return { ...defaults, ...(parsed as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

function saveSettings(webamp: Webamp): void {
  const state = webamp.store.getState();
  const windows = state.windows.genWindows;
  const settings: Settings = {
    volume: state.media.volume,
    equalizer: windows.equalizer.open,
    playlist: windows.playlist.open,
  };
  const json = JSON.stringify(settings);
  if (json === localStorage.getItem(SETTINGS_KEY)) return;
  localStorage.setItem(SETTINGS_KEY, json);
}

/**
 * With two entries, next on NTS 2 or previous on NTS 1 runs off the end of the
 * playlist, and Webamp stops. Switch to the other channel instead.
 * `IS_STOPPED` is only dispatched there.
 */
function wrapAtPlaylistEnds(store: MiddlewareStore): ReturnType<Middleware> {
  return (next) => (action) => {
    if (action.type !== "IS_STOPPED") return next(action);
    const { playlist, media } = store.getState();
    const other = playlist.trackOrder.find((id) => id !== playlist.currentTrack);
    if (other === undefined) return next(action);
    return store.dispatch({ type: media.status === "STOPPED" ? "BUFFER_TRACK" : "PLAY_TRACK", id: other });
  };
}

/** Keys 1 and 2 jump straight to NTS 1 and NTS 2. */
function bindChannelKeys(webamp: Webamp): void {
  window.addEventListener("keydown", (event) => {
    if (event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
    const channel = ["1", "2"].indexOf(event.key);
    if (channel >= 0) playChannel(webamp, channel);
  });
}

/** Plays NTS 1 (0) or NTS 2 (1), wherever it sits in the playlist. */
function playChannel(webamp: Webamp, channel: number): void {
  const { playlist, tracks } = webamp.store.getState();
  const id = playlist.trackOrder.find((trackId) => tracks[trackId]?.url === STREAMS[channel].url);
  if (id !== undefined) webamp.store.dispatch({ type: "PLAY_TRACK", id });
}

/**
 * Runs the tray menu's player entries (lib.rs sends their ids) and keeps the
 * tray tooltip on the show playing now.
 */
function connectTray(webamp: Webamp): void {
  void listen<string>("tray", ({ payload }) => {
    if (payload === "play-pause") {
      if (webamp.store.getState().media.status === "PLAYING") webamp.pause();
      else webamp.play();
    } else if (payload === "nts1" || payload === "nts2") {
      playChannel(webamp, payload === "nts1" ? 0 : 1);
    }
  });

  let tooltip = "";
  const updateTooltip = (): void => {
    const { playlist, tracks } = webamp.store.getState();
    const track = playlist.currentTrack == null ? undefined : tracks[playlist.currentTrack];
    const next = track?.title ? `Unofficial NTS Player
${track.title}` : "Unofficial NTS Player";
    if (next === tooltip) return;
    tooltip = next;
    invoke("set_tray_tooltip", { text: next }).catch((error: unknown) =>
      console.error("Could not set the tray tooltip", error),
    );
  };
  webamp.__onStateChange(updateTooltip);
  updateTooltip();
}

/**
 * Webamp treats a media error as the end of the track and moves to the next
 * one, which silently switched NTS 1 to NTS 2 when the network dropped.
 * Replace that: a dropped or stuck stream reloads the same channel, with
 * backoff, for as long as the player is meant to be playing. Pause and stop
 * stay manual, but Play after a drop reloads the stream instead of resuming
 * the dead one. Any user action cancels a pending retry and resets the backoff.
 */
function reconnectOnDrop(): { middleware: Middleware; watch: (webamp: Webamp) => void } {
  let retryMs = RETRY_MIN_MS;
  let timer: number | undefined;
  // The stream has failed and has not played since.
  let dropped = false;
  // Set while our own retry dispatches, so it is not mistaken for the user.
  let retrying = false;
  let store: MiddlewareStore | undefined;

  const isPlaying = (): boolean => store?.getState().media.status === "PLAYING";
  const cancel = (): void => {
    window.clearTimeout(timer);
    timer = undefined;
    retryMs = RETRY_MIN_MS;
  };
  const reconnect = (): void => {
    dropped = true;
    if (!store || timer !== undefined || !isPlaying()) return;
    const id = store.getState().playlist.currentTrack;
    if (id == null) return;
    console.warn(`Stream dropped, reconnecting in ${retryMs} ms`);
    timer = window.setTimeout(() => {
      timer = undefined;
      if (!store || !isPlaying()) return;
      retrying = true;
      try {
        store.dispatch({ type: "PLAY_TRACK", id });
      } finally {
        retrying = false;
      }
    }, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  };

  const middleware: Middleware = (middlewareStore) => {
    store = middlewareStore;
    return (next) => (action) => {
      if (retrying) return next(action);
      switch (action.type) {
        case "PLAY_TRACK":
        case "BUFFER_TRACK":
          // A fresh load: its own failure starts a fresh backoff.
          cancel();
          dropped = false;
          break;
        case "PAUSE":
        case "STOP":
          cancel();
          break;
        case "PLAY": {
          cancel();
          const result = next(action);
          const id = middlewareStore.getState().playlist.currentTrack;
          if (dropped && id != null) middlewareStore.dispatch({ type: "PLAY_TRACK", id });
          return result;
        }
      }
      return next(action);
    };
  };

  const watch = (webamp: Webamp): void => {
    // Webamp's own "ended" listener dispatches next(). Live streams never end
    // on purpose, so every "ended" (Webamp also fires it on errors) is a drop.
    // `_emitter` is not public API; check it when upgrading Webamp.
    (webamp.media as unknown as { _emitter: { _listeners: Record<string, unknown[]> } })._emitter._listeners.ended = [reconnect];

    // A stream that stops delivering often raises no error at all: the element
    // just waits. Watch the clock instead.
    let lastElapsed = -1;
    let stalledSince = performance.now();
    window.setInterval(() => {
      const elapsed = webamp.media.timeElapsed();
      if (!isPlaying() || elapsed !== lastElapsed) {
        if (isPlaying() && elapsed > lastElapsed && timer === undefined) {
          retryMs = RETRY_MIN_MS;
          dropped = false;
        }
        lastElapsed = elapsed;
        stalledSince = performance.now();
        return;
      }
      if (performance.now() - stalledSince >= STALL_MS) {
        stalledSince = performance.now();
        reconnect();
      }
    }, 1000);
  };

  return { middleware, watch };
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
    // point ends up that far from the cursor. Fix if it bothers.
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
    // The show panel sits under Webamp's windows, pinned to the OS window's bottom edge.
    const panelHeight = document.getElementById("now-playing")?.offsetHeight ?? 0;
    const layout = `${box.left},${box.top},${box.width},${box.height},${panelHeight}`;
    if (layout === lastLayout || fitting) return;
    fitting = true;
    try {
      // Webamp centres its windows in the page on first render. Pin them to
      // the top-left corner instead, so the OS window only has to resize.
      if (box.left !== 0 || box.top !== 0) {
        shiftWebampWindows(webamp, -box.left, -box.top);
      }
      await appWindow.setSize(new LogicalSize(box.width, box.height + panelHeight));
      lastLayout = `0,0,${box.width},${box.height},${panelHeight}`;
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
  clickThroughGaps(webamp);
  const panel = document.getElementById("now-playing");
  if (panel) new ResizeObserver(() => requestAnimationFrame(() => void fit())).observe(panel);
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

/**
 * The OS window is the box around Webamp's windows, so with the equaliser
 * closed the gap between the main window and the playlist is see-through
 * but would still take clicks. Clip the OS window to Webamp's windows, its
 * menus and the show panel, so clicks in the gaps reach what is behind.
 */
function clickThroughGaps(webamp: Webamp): void {
  let last = "";
  const clip = (): void => {
    const scale = window.devicePixelRatio;
    const rects: [number, number, number, number][] = [];
    const parts = document.querySelectorAll<HTMLElement>(
      "#webamp .window, #webamp #main-window, #webamp-context-menu .context-menu, #webamp-context-menu ul, #now-playing",
    );
    for (const element of parts) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      // Round outwards, so the region never cuts a pixel off a window.
      rects.push([
        Math.floor(rect.left * scale),
        Math.floor(rect.top * scale),
        Math.ceil(rect.right * scale),
        Math.ceil(rect.bottom * scale),
      ]);
    }
    const key = JSON.stringify(rects);
    if (rects.length === 0 || key === last) return;
    last = key;
    invoke("set_hit_region", { rects }).catch((error: unknown) => {
      last = "";
      console.error("Could not clip the window to Webamp", error);
    });
  };
  const schedule = (): void => void requestAnimationFrame(clip);
  webamp.__onStateChange(schedule);
  // Menus and the show panel come and go without a Webamp state change.
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["hidden"],
  });
  window.addEventListener("resize", schedule);
  schedule();
}
