import type Webamp from "webamp/butterchurn";
import { fetchLive, type OnAir } from "./live";

// Ask again this often, and a few seconds after the current show ends.
const POLL_MS = 2 * 60_000;
const END_GRACE_MS = 5_000;
// The API still says a show is on after its end time: ask again sooner.
const STALE_RETRY_MS = 20_000;

const PANEL_KEY = "nowPlaying.panel";

type Stream = { url: string; defaultName: string };

/**
 * Puts the show on air in each channel's title (scrolling title, playlist,
 * Windows' media overlay) and in the optional show panel under Webamp.
 * Nothing here touches playback: on any API failure the titles fall back to
 * the channel names and the stream plays on.
 */
export function showNowPlaying(webamp: Webamp, streams: Stream[]): void {
  let onAir: (OnAir | undefined)[] = [];
  let panelOpen = localStorage.getItem(PANEL_KEY) !== "closed";

  const channelOf = (id: number | null): number => {
    const track = id == null ? undefined : webamp.store.getState().tracks[id];
    return streams.findIndex((stream) => stream.url === track?.url);
  };
  const titleOf = (channel: number): string => onAir[channel]?.title ?? streams[channel].defaultName;

  const updateOverlay = (): void => {
    const channel = channelOf(webamp.store.getState().playlist.currentTrack);
    if (channel < 0 || !("mediaSession" in navigator)) return;
    const artwork = onAir[channel]?.artwork;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleOf(channel),
      artist: streams[channel].defaultName,
      artwork: artwork ? [{ src: artwork, sizes: "200x200" }] : [],
    });
  };

  const panel = document.getElementById("now-playing");
  const [art, now, next] = ["img", ".now", ".next"].map((selector) => panel?.querySelector<HTMLElement>(selector));
  let rendered = "";
  const renderPanel = (): void => {
    if (!panel || !(art instanceof HTMLImageElement) || !now || !next) return;
    const state = webamp.store.getState();
    const channel = channelOf(state.playlist.currentTrack);
    const show = onAir[channel];
    const style = state.display.skinPlaylistStyle;
    const key = JSON.stringify([panelOpen, channel, show, style]);
    if (key === rendered) return;
    rendered = key;
    panel.hidden = !panelOpen || channel < 0;
    const skin = { normal: style?.normal, current: style?.current, background: style?.normalbg, font: style?.font };
    for (const [name, value] of Object.entries(skin)) panel.style.setProperty(`--${name}`, value ?? null);
    art.hidden = !show?.artwork;
    art.src = show?.artwork ?? "";
    now.textContent = now.title = channel < 0 ? "" : titleOf(channel);
    const startsAt = show?.next?.startsAt;
    const at = startsAt ? new Date(startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    next.textContent = next.title = show?.next ? `Next${at && ` ${at}`}: ${show.next.title}` : "";
  };
  const togglePanel = (): void => {
    panelOpen = !panelOpen;
    localStorage.setItem(PANEL_KEY, panelOpen ? "open" : "closed");
    renderPanel();
  };
  panel?.querySelector("button")?.addEventListener("click", togglePanel);
  // Alt+3 is Winamp's "file info" shortcut.
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "Digit3") {
      event.preventDefault();
      togglePanel();
    }
  });

  const apply = (): void => {
    for (const track of Object.values(webamp.store.getState().tracks)) {
      const channel = channelOf(track.id);
      if (channel < 0) continue;
      const title = titleOf(channel);
      const albumArtUrl = onAir[channel]?.artwork ?? null;
      if (track.title === title && (track.albumArtUrl ?? null) === albumArtUrl) continue;
      // Not public API; check it when upgrading Webamp.
      webamp.store.dispatch({ type: "SET_MEDIA_TAGS", id: track.id, title, artist: "", albumArtUrl });
    }
    updateOverlay();
    renderPanel();
  };

  const poll = async (): Promise<void> => {
    let fresh: (OnAir | undefined)[] = [];
    try {
      fresh = await fetchLive();
    } catch (error: unknown) {
      console.warn("NTS live API failed", error);
    }
    // A show the API has lost track of keeps its title until it is due to end.
    onAir = streams.map((_, channel) => {
      const kept = onAir[channel];
      return fresh[channel] ?? (kept?.endsAt !== undefined && kept.endsAt > Date.now() ? kept : undefined);
    });
    apply();

    const ends = onAir.flatMap((show) => (show?.endsAt === undefined ? [] : [show.endsAt - Date.now()]));
    const delay = ends.some((left) => left <= 0)
      ? STALE_RETRY_MS
      : Math.min(POLL_MS, ...ends.map((left) => left + END_GRACE_MS));
    window.setTimeout(() => void poll(), delay);
  };

  webamp.onTrackDidChange((track) => {
    if (track) updateOverlay();
  });
  webamp.__onStateChange(renderPanel);
  void poll();
}
