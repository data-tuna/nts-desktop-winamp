import type Webamp from "webamp/butterchurn";
import { openUrl } from "@tauri-apps/plugin-opener";
import { fetchLive, mergeOnAir, nextPollDelay, type OnAir } from "./live";
import { pickOf } from "./picks";

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
  // The channel always leads (Ata, 2026-10-09): "NTS 1 - <show> - <location>".
  const titleOf = (channel: number): string => {
    const show = onAir[channel]?.title;
    return show ? `${streams[channel].defaultName} - ${show}` : streams[channel].defaultName;
  };

  const updateOverlay = (): void => {
    const channel = channelOf(webamp.store.getState().playlist.currentTrack);
    if (channel < 0 || !("mediaSession" in navigator)) return;
    const artwork = onAir[channel]?.artwork;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: titleOf(channel),
      artwork: artwork ? [{ src: artwork, sizes: "200x200" }] : [],
    });
  };

  const panel = document.getElementById("now-playing");
  const [art, now, next, close] = ["img", ".now", ".next", "button"].map((selector) =>
    panel?.querySelector<HTMLElement>(selector),
  );
  const currentPick = () => {
    const { playlist, tracks } = webamp.store.getState();
    return pickOf(playlist.currentTrack == null ? undefined : tracks[playlist.currentTrack]?.url);
  };
  let rendered = "";
  const renderPanel = (): void => {
    if (!panel || !(art instanceof HTMLImageElement) || !now || !next || !close) return;
    const state = webamp.store.getState();
    const channel = channelOf(state.playlist.currentTrack);
    const show = onAir[channel];
    const pick = currentPick();
    const style = state.display.skinPlaylistStyle;
    const key = JSON.stringify([panelOpen, channel, show, pick, style]);
    if (key === rendered) return;
    rendered = key;
    // SoundCloud's terms want the uploader, SoundCloud and a link back on
    // screen, so a pick keeps the panel open and drops its close button.
    panel.hidden = pick ? false : !panelOpen || channel < 0;
    close.hidden = !!pick;
    const skin = { normal: style?.normal, current: style?.current, background: style?.normalbg, font: style?.font };
    for (const [name, value] of Object.entries(skin)) panel.style.setProperty(`--${name}`, value ?? null);
    // Quoted, so a family name CSS would not accept bare cannot void the rule.
    if (skin.font) panel.style.setProperty("--font", JSON.stringify(skin.font));
    const artwork = pick ? pick.artwork : show?.artwork;
    art.hidden = !artwork;
    if (artwork) art.src = artwork;
    else art.removeAttribute("src");
    if (pick) {
      now.textContent = now.title = pick.title;
      const link = document.createElement("a");
      link.href = pick.url;
      link.textContent = link.title = `${pick.uploader ?? "Listen"} on SoundCloud`;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        void openUrl(pick.url);
      });
      next.title = "";
      next.replaceChildren(link);
      return;
    }
    now.textContent = now.title = channel < 0 ? "" : titleOf(channel);
    const startsAt = show?.next?.startsAt;
    const at = startsAt ? new Date(startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    next.textContent = next.title = show?.next ? `Next${at && ` ${at}`}: ${show.next.title}` : "";
  };
  const togglePanel = (): void => {
    // The panel cannot close during a pick; do not save a choice nobody sees.
    if (currentPick()) return;
    panelOpen = !panelOpen;
    localStorage.setItem(PANEL_KEY, panelOpen ? "open" : "closed");
    renderPanel();
  };
  panel?.querySelector("button")?.addEventListener("click", togglePanel);
  // Alt+3 is Winamp's "file info" shortcut.
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "Digit3" && !event.repeat) {
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
    const now = Date.now();
    onAir = mergeOnAir(onAir, fresh, streams.length, now);
    // Scheduled first, so a throw in Webamp's internals cannot end the polling.
    window.setTimeout(() => void poll(), nextPollDelay(onAir, now));
    apply();
  };

  // Runs after Webamp's own Media Session listener (registered in its
  // constructor), so this metadata wins.
  webamp.onTrackDidChange((track) => {
    if (track) updateOverlay();
  });
  // Seeking a live stream only restarts it; drop Webamp's overlay seek buttons.
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("seekbackward", null);
    navigator.mediaSession.setActionHandler("seekforward", null);
  }
  webamp.__onStateChange(renderPanel);
  void poll();
}
