import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type Webamp from "webamp/butterchurn";

/** A classic skin as the Skin Museum API returns it. */
export type Skin = {
  md5: string;
  filename: string;
  nsfw: boolean | null;
  download_url: string;
  screenshot_url: string;
};

const SKIN_FIELDS = "md5 filename nsfw download_url screenshot_url";

// localStorage is shared by the main and picker windows (same origin).
export const KEYS = {
  current: "skins.current",
  keep: "skins.keep",
  favourites: "skins.favourites",
  approvedCount: "skins.approvedCount",
  known: "skins.known",
} as const;

export function readJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? "null") as T | null) ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export const currentSkin = () => readJson<Skin | null>(KEYS.current, null);
export const isKept = () => readJson<boolean>(KEYS.keep, false);

async function museum<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch("https://api.webamp.org/graphql", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`Skin Museum: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: T; errors?: { message: string }[] };
  if (!body.data) throw new Error(`Skin Museum: ${body.errors?.[0]?.message ?? "no data"}`);
  return body.data;
}

/** One random APPROVED, non-NSFW skin that is not `exclude`. */
async function randomSkin(exclude?: string): Promise<Skin> {
  // The approved count is remembered, so a launch costs one request, not two.
  let count = readJson<number>(KEYS.approvedCount, 0);
  for (let attempt = 0; attempt < 3; attempt++) {
    const offset = Math.floor(Math.random() * count);
    const data = await museum<{ skins: { count: number; nodes: Skin[] } }>(
      `query ($offset: Int!) { skins(filter: APPROVED, first: 1, offset: $offset) { count nodes { ${SKIN_FIELDS} } } }`,
      { offset },
    );
    const guessed = count > 0;
    count = data.skins.count;
    writeJson(KEYS.approvedCount, count);
    const skin = data.skins.nodes[0];
    // Without a count, offset 0 only taught us the count: draw again.
    if (guessed && skin && skin.nsfw === false && skin.md5 !== exclude) return skin;
  }
  throw new Error("Skin Museum: no usable random skin");
}

/**
 * Approved, non-NSFW skins matching `query`. search_skins also returns
 * rejected, unreviewed and NSFW skins, so filter on the reviews.
 */
export async function searchSkins(query: string): Promise<Skin[]> {
  type Hit = Skin & { reviews?: { rating: string }[] };
  const data = await museum<{ search_skins: Hit[] }>(
    `query ($query: String!) { search_skins(query: $query, first: 60, offset: 0) { ${SKIN_FIELDS} ... on ClassicSkin { reviews { rating } } } }`,
    { query },
  );
  return data.search_skins
    .filter(
      (hit) =>
        hit.nsfw === false &&
        hit.reviews?.some((r) => r.rating === "APPROVED") &&
        !hit.reviews.some((r) => r.rating !== "APPROVED"),
    );
}

/** A display name: the filename without its extension. */
export function skinName(skin: Pick<Skin, "filename" | "md5">): string {
  return skin.filename.replace(/\.(wsz|zip)$/i, "") || skin.md5;
}

/** The skin's bytes from the cache, or downloaded once and cached. */
async function skinBytes(skin: Skin): Promise<ArrayBuffer> {
  try {
    return await invoke<ArrayBuffer>("read_skin", { md5: skin.md5 });
  } catch {
    // Skins come from the Museum's bucket and nowhere else.
    if (!skin.download_url.startsWith("https://r2.webampskins.org/")) {
      throw new Error(`Not a Skin Museum download: ${skin.download_url}`);
    }
    const response = await fetch(skin.download_url);
    if (!response.ok) throw new Error(`Skin download: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    await invoke("write_skin", bytes, { headers: { md5: skin.md5 } });
    return bytes;
  }
}

/** Metadata for cached skins, so a cache hit offline still has a name. */
function remember(skin: Skin): void {
  writeJson(KEYS.known, { ...readJson<Record<string, Skin>>(KEYS.known, {}), [skin.md5]: skin });
}

function blobUrl(bytes: ArrayBuffer): string {
  return URL.createObjectURL(new Blob([bytes]));
}

/**
 * The skin to start with, from local disk only so startup never waits on
 * the network: the kept skin, else a random cached one other than the last.
 * Undefined means Webamp's base skin.
 */
export async function launchSkin(): Promise<{ url: string } | undefined> {
  const current = currentSkin();
  const keep = isKept();
  try {
    const cached = await invoke<string[]>("cached_skins");
    const others = cached.filter((md5) => md5 !== current?.md5);
    const md5 =
      keep && current
        ? current.md5
        : (others[Math.floor(Math.random() * others.length)] ?? current?.md5);
    if (md5 && cached.includes(md5)) {
      const bytes = await invoke<ArrayBuffer>("read_skin", { md5 });
      // Forget skins the cache has evicted, so this map stays small.
      const known = Object.fromEntries(
        Object.entries(readJson<Record<string, Skin>>(KEYS.known, {})).filter(([key]) =>
          cached.includes(key),
        ),
      );
      writeJson(KEYS.known, known);
      const unknown = { md5, filename: md5, nsfw: null, download_url: "", screenshot_url: "" };
      writeJson(KEYS.current, md5 === current?.md5 ? current : (known[md5] ?? unknown));
      return { url: blobUrl(bytes) };
    }
  } catch (error: unknown) {
    console.error("No cached skin to start with", error);
  }
  // The base skin. A kept skin stays current so swapInRandomSkin fetches it.
  if (!keep) localStorage.removeItem(KEYS.current);
  return undefined;
}

// Every skin change takes a ticket. A slow change that a newer one has
// overtaken (say, the launch swap after the user picked a skin) never lands.
let latestChange = 0;

/**
 * Puts `next` on Webamp, caching it, and tells the picker. `next` may still
 * be on its way; the ticket is taken now. `stillWanted` can veto it late.
 */
export async function applySkin(
  webamp: Webamp,
  next: Skin | Promise<Skin>,
  stillWanted: () => boolean = () => true,
): Promise<void> {
  const ticket = ++latestChange;
  const skin = await next;
  const bytes = await skinBytes(skin);
  if (ticket !== latestChange || !stillWanted()) return;
  const url = blobUrl(bytes);
  webamp.setSkinFromUrl(url);
  await webamp.skinIsLoaded();
  URL.revokeObjectURL(url);
  if (ticket !== latestChange) return;
  remember(skin);
  writeJson(KEYS.current, skin);
  void emitTo("picker", "skin-changed", skin);
}

/** After launch: swap in a fresh random skin, unless the user kept one. */
export async function swapInRandomSkin(webamp: Webamp): Promise<void> {
  const current = currentSkin();
  if (isKept() && current) {
    // Kept but not in the cache (evicted, or first kept offline): fetch it.
    if (!(await invoke<string[]>("cached_skins")).includes(current.md5) && current.download_url) {
      await applySkin(webamp, current);
    }
    return;
  }
  // Ticking "Keep this skin" while this is in flight keeps the launch skin.
  await applySkin(webamp, randomSkin(current?.md5), () => !isKept());
}

/** The entry this app adds to Webamp's Options > Skins menu. */
export const PICKER_MENU_ENTRY = { name: "Skin Browser...", url: "about:blank#skin-browser" };

async function openPicker(): Promise<void> {
  const existing = await WebviewWindow.getByLabel("picker");
  if (existing) {
    await existing.unminimize();
    await existing.setFocus();
    return;
  }
  new WebviewWindow("picker", {
    url: "picker.html",
    title: "Skin Browser (nts-desktop-winamp, unofficial)",
    width: 720,
    height: 560,
    minWidth: 420,
    minHeight: 320,
  });
}

/**
 * Opens the picker from Webamp's Skins menu or Winamp's Alt+S, and applies
 * what the picker sends back.
 */
export function connectPicker(webamp: Webamp): void {
  // Webamp's menu would fetch the entry's url as a skin. Catch the click
  // first, then click the body so Webamp's own outside-click closes the menu.
  document.addEventListener(
    "click",
    (event) => {
      if (!(event.target instanceof HTMLLIElement)) return;
      if (event.target.textContent !== PICKER_MENU_ENTRY.name) return;
      event.stopPropagation();
      document.body.click();
      void openPicker();
    },
    { capture: true },
  );
  window.addEventListener("keydown", (event) => {
    if (event.altKey && event.code === "KeyS") {
      event.preventDefault();
      void openPicker();
    }
  });

  const report = (error: unknown) => {
    console.error("Could not change the skin", error);
    void emitTo("picker", "skin-error", String(error));
  };
  void listen<Skin>("pick-skin", ({ payload }) => void applySkin(webamp, payload).catch(report));
  void listen("random-skin", () => {
    void applySkin(webamp, randomSkin(currentSkin()?.md5)).catch(report);
  });
}
