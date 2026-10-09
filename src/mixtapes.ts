// NTS Infinite Mixtapes: endless themed streams, listed between the channels
// and the picks. They are live MP3 streams like NTS 1 and NTS 2, so they play
// through Webamp's own media, visualiser and reconnect included.

import type Webamp from "webamp/butterchurn";
// The .ts extension lets `node --test` load this file directly.
import { decodeEntities } from "./live.ts";
import { SEPARATOR } from "./picks.ts";

// Undocumented, like the live API. Once per launch.
const MIXTAPES_API = "https://www.nts.live/api/v2/mixtapes";

// The API's MP3 url (stream-mixtape-geo.ntslive.net) redirects without CORS
// headers, like the channels' relay. Its HLS MP3 url names the same radiomast
// stream, which starts at streams.radiomast.io: drop the `/hls.m3u8`.
const RADIOMAST_HLS = /^(https:\/\/streams\.radiomast\.io\/[\w-]+)\/hls\.m3u8$/;

export type Mixtape = { url: string; title: string };

export function parseMixtapes(body: unknown): Mixtape[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((mixtape: Record<string, unknown> | null) => {
    const hls = mixtape?.audio_stream_endpoint_hls_mp3;
    const url = typeof hls === "string" ? RADIOMAST_HLS.exec(hls)?.[1] : undefined;
    const title = text(mixtape?.title);
    if (!url || !title) return [];
    const subtitle = text(mixtape?.subtitle);
    return [{ url, title: subtitle ? `${title} - ${subtitle}` : title }];
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? decodeEntities(value.trim()) : undefined;
}

/** Fetch the mixtapes and append them, after a separator, to the playlist. A failure leaves them out. */
export async function listMixtapes(webamp: Webamp): Promise<void> {
  const response = await fetch(MIXTAPES_API, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`NTS mixtapes API: HTTP ${response.status}`);
  const list = parseMixtapes(await response.json());
  if (!list.length) return;
  webamp.appendTracks([
    SEPARATOR,
    // A live stream has no length; see the channels in main.ts.
    ...list.map((mixtape) => ({ url: mixtape.url, metaData: { artist: "", title: mixtape.title }, duration: 0 })),
  ]);
}
