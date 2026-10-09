// NTS Picks: the latest hand-picked episodes, listed under the two channels
// and played through SoundCloud's embed widget, out of sight, with Webamp as
// the only player on screen. nts.live plays them from SoundCloud too.
// SoundCloud's API terms ask for credit to the uploader and to SoundCloud,
// with a link back: nowPlaying.ts shows that line while a pick plays.

import type Webamp from "webamp/butterchurn";
// The .ts extension lets `node --test` load this file directly.
import { decodeEntities } from "./live.ts";

// Undocumented, like the live API. One page of 12, once per launch.
const PICKS_API = "https://www.nts.live/api/v2/collections/nts-picks?offset=0&limit=12";
const WIDGET = "https://w.soundcloud.com/player/";
const WIDGET_ORIGIN = "https://w.soundcloud.com";

/** The playlist row between the channels and the picks. Its empty url is how the app tells it apart. */
export const SEPARATOR = { url: "", metaData: { artist: "", title: "-".repeat(40) }, duration: 0 };

export type Pick = {
  /** The SoundCloud track page, query string dropped. It is also the pick's Webamp track url. */
  url: string;
  /** `<name> - <location> (<genres and moods>)` */
  title: string;
  artwork?: string;
  /** Who uploaded it, from the widget once the pick has loaded. */
  uploader?: string;
};

const picks = new Map<string, Pick>();

/** The pick behind a Webamp track url, if it is one. */
export function pickOf(url: string | undefined): Pick | undefined {
  return url ? picks.get(url) : undefined;
}

export function parsePicks(body: unknown): Pick[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((episode: Record<string, unknown> | null) => {
    const sources = Array.isArray(episode?.audio_sources) ? (episode.audio_sources as { url?: unknown; source?: unknown }[]) : [];
    const source = sources.find((entry) => entry?.source === "soundcloud" && typeof entry.url === "string");
    const url = (source?.url as string | undefined)?.split("?")[0];
    const name = text(episode?.name);
    // ponytail: picks with only a Mixcloud copy are skipped. Every pick had a SoundCloud one on 2026-10-09.
    if (!url?.startsWith("https://soundcloud.com/") || !name) return [];
    const location = text(episode?.location_long);
    const tags = [episode?.genres, episode?.moods].flatMap((list) =>
      Array.isArray(list) ? list.flatMap((tag: { value?: unknown } | null) => text(tag?.value) ?? []) : [],
    );
    const picture = (episode?.media as { picture_small?: unknown } | undefined)?.picture_small;
    return [
      {
        url,
        title: `${name}${location ? ` - ${location}` : ""}${tags.length ? ` (${tags.join(", ")})` : ""}`,
        artwork: typeof picture === "string" && picture.startsWith("https://") ? picture : undefined,
      },
    ];
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? decodeEntities(value.trim()) : undefined;
}

/** Fetch the picks and append them, after a separator, to the playlist. A failure leaves just the channels. */
export async function listPicks(webamp: Webamp): Promise<void> {
  const response = await fetch(PICKS_API, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`NTS picks API: HTTP ${response.status}`);
  const list = parsePicks(await response.json());
  if (!list.length) return;
  for (const pick of list) picks.set(pick.url, pick);
  webamp.appendTracks([
    SEPARATOR,
    // Duration 0 until the widget reports it; without one, Webamp would try to read the file.
    ...list.map((pick) => ({ url: pick.url, metaData: { artist: "", title: pick.title }, duration: 0 })),
  ]);
}

type Media = {
  loadFromUrl(url: string, autoPlay: boolean): Promise<void>;
  play(): Promise<void>;
  pause(): void;
  stop(): void;
  timeElapsed(): number;
  duration(): number;
  setVolume(volume: number): void;
  seekToPercentComplete(percent: number): void;
  _emitter: { trigger(event: string): void };
};

/**
 * Route pick tracks to a hidden SoundCloud widget. Webamp's media layer calls
 * these methods on its instance for every play, pause, stop, seek and volume
 * change, and reads the clock through them, so the main window, the playlist
 * and the Windows overlay all show the pick. Streams go to Webamp's own media.
 * Not public API, like the rest of `webamp.media`; check it when upgrading.
 */
export function playPicksInWidget(webamp: Webamp): void {
  const media = webamp.media as unknown as Media;
  const real = {
    loadFromUrl: media.loadFromUrl.bind(media),
    play: media.play.bind(media),
    pause: media.pause.bind(media),
    stop: media.stop.bind(media),
    timeElapsed: media.timeElapsed.bind(media),
    duration: media.duration.bind(media),
    setVolume: media.setVolume.bind(media),
    seekToPercentComplete: media.seekToPercentComplete.bind(media),
  };
  const emit = (event: string): void => media._emitter.trigger(event);

  const frame = document.createElement("iframe");
  frame.id = "pick-widget";
  frame.title = "SoundCloud player";
  frame.allow = "autoplay";
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);

  // The pick that owns the widget, or null while a stream plays.
  let current: { pick: Pick; seconds: number; duration: number; autoPlay: boolean } | null = null;
  let volume = webamp.store.getState().media.volume;
  const send = (method: string, value?: unknown): void =>
    frame.contentWindow?.postMessage(JSON.stringify({ method, value }), WIDGET_ORIGIN);

  window.addEventListener("message", (event) => {
    if (event.origin !== WIDGET_ORIGIN || event.source !== frame.contentWindow || !current) return;
    let message: { method?: string; value?: unknown };
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    const value = message.value as Record<string, unknown> | undefined;
    switch (message.method) {
      case "ready":
        for (const name of ["playProgress", "play", "finish", "error"]) send("addEventListener", name);
        send("setVolume", volume);
        send("getCurrentSound");
        if (current.autoPlay) send("play");
        break;
      case "getCurrentSound": {
        current.duration = Number(value?.duration) / 1000 || 0;
        const user = (value?.user as { username?: unknown } | undefined)?.username;
        if (typeof user === "string") current.pick.uploader = user;
        // Sets the track's length in the playlist and opens the seek bar.
        emit("fileLoaded");
        break;
      }
      case "playProgress":
        current.seconds = Number(value?.currentPosition) / 1000 || 0;
        emit("timeupdate");
        break;
      case "play":
        emit("stopWaiting");
        emit("playing");
        break;
      case "finish":
        webamp.nextTrack();
        break;
      case "error":
        console.warn("SoundCloud widget error", current.pick.url, value);
        break;
    }
  });

  const unload = (): void => {
    if (!current) return;
    current = null;
    frame.removeAttribute("src");
    document.body.classList.remove("pick");
  };

  media.loadFromUrl = async (url, autoPlay) => {
    // The separator: main.ts has already moved playback elsewhere.
    if (!url) return;
    const pick = pickOf(url);
    if (!pick) {
      unload();
      return real.loadFromUrl(url, autoPlay);
    }
    // The live stream stops while a pick plays.
    real.stop();
    current = { pick, seconds: 0, duration: 0, autoPlay };
    document.body.classList.add("pick");
    emit("waiting");
    emit("timeupdate");
    frame.src = `${WIDGET}?url=${encodeURIComponent(url)}&auto_play=false&visual=false`;
  };
  media.play = async () => {
    if (!current) return real.play();
    current.autoPlay = true;
    send("play");
  };
  media.pause = () => (current ? send("pause") : real.pause());
  media.stop = () => {
    if (!current) return real.stop();
    current.autoPlay = false;
    send("pause");
    send("seekTo", 0);
    current.seconds = 0;
    emit("timeupdate");
  };
  media.timeElapsed = () => (current ? current.seconds : real.timeElapsed());
  media.duration = () => (current ? current.duration : real.duration());
  media.seekToPercentComplete = (percent) => {
    if (!current) return real.seekToPercentComplete(percent);
    send("seekTo", current.duration * percent * 10);
  };
  media.setVolume = (value) => {
    volume = value;
    real.setVolume(value);
    send("setVolume", value);
  };
}
