// ATA-103 spike frame. Runs inside <iframe sandbox="allow-scripts">: an
// opaque origin, no Tauri internals, no access to the parent's DOM. The skin
// arrives as bytes from the host; everything here reports back by postMessage.
import "./shim";
import "./vendor/webamp-modern/css/webamp.css";
import "./vendor/webamp-modern/css/wmz.css";
import "./vendor/webamp-modern/WebampModern";
import "./vendor/webamp-modern/skin/SkinEngine_WindowsMediaPlayer";
import AUDIO_PLAYER from "./vendor/webamp-modern/skin/AudioPlayer";

const send = (msg: object) => parent.postMessage(msg, "*");
const text = (args: unknown[]) =>
  args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : safeJson(a))).join(" ");
function safeJson(v: unknown) {
  try {
    return JSON.stringify(v)?.slice(0, 300);
  } catch {
    return String(v);
  }
}

for (const level of ["error", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    send({ type: "log", level, text: text(args).slice(0, 500) });
    orig(...args);
  };
}
window.addEventListener("error", (e) =>
  send({ type: "log", level: "uncaught", text: `${e.message} @ ${e.filename?.slice(0, 60)}:${e.lineno}` }),
);
window.addEventListener("unhandledrejection", (e) =>
  send({ type: "log", level: "rejection", text: text([e.reason]).slice(0, 500) }),
);

// Without crossOrigin the stream is opaque to Web Audio, and the engine's
// graph (volume, EQ, visualiser) outputs silence: the clock runs, nothing plays.
AUDIO_PLAYER._audio.crossOrigin = "anonymous";

let webamp: any;

function controls() {
  const out: object[] = [];
  const walk = (o: any, depth: number) => {
    const r = o._div?.getBoundingClientRect();
    out.push({
      depth,
      cls: o.constructor?.name,
      id: o._originalId,
      action: o._action == null ? undefined : String(o._action),
      onclick: typeof o._onClick === "string" ? o._onClick : undefined,
      visible: o._visible,
      rect: r && r.width ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : undefined,
    });
    for (const c of o._children ?? []) walk(c, depth + 1);
  };
  for (const c of webamp?._uiRoot.getContainers() ?? []) {
    walk(c, 0);
    for (const l of c._layouts ?? []) walk(l, 1);
  }
  return out;
}

function state() {
  const a = AUDIO_PLAYER._audio;
  return {
    paused: a.paused,
    currentTime: a.currentTime,
    readyState: a.readyState,
    src: a.src,
    crossOrigin: a.crossOrigin,
    gain: AUDIO_PLAYER.getVolume(),
    vu: AUDIO_PLAYER._vuMeter,
    ctx: AUDIO_PLAYER._context.state,
    texts: [...document.querySelectorAll("text")].map((t) => (t as HTMLElement).innerText).filter(Boolean),
  };
}

async function probe(noKey: Req, withKey: Req) {
  const result: Record<string, unknown> = {
    origin: location.origin,
    tauriInternals: typeof (window as any).__TAURI_INTERNALS__,
    tauri: typeof (window as any).__TAURI__,
    wryIpc: typeof (window as any).ipc,
    chromeWebview: typeof (window as any).chrome?.webview,
  };
  const attempt = async (name: string, fn: () => unknown) => {
    try {
      result[name] = { ok: await fn() };
    } catch (e) {
      result[name] = { threw: text([e]) };
    }
  };
  await attempt("parentInternals", () => typeof (parent as any).__TAURI_INTERNALS__);
  await attempt("parentDocument", () => parent.document.title);
  await attempt("localStorage", () => localStorage.length);
  const replay = async (r: Req) => {
    const res = await fetch(r.url, { method: "POST", headers: r.headers, body: r.body });
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  };
  await attempt("ipcFetchNoKey", () => replay(noKey));
  await attempt("ipcFetchWithKey", () => replay(withKey));
  await attempt("webviewPostMessage", () => {
    const w = (window as any).chrome?.webview;
    if (!w) return "no chrome.webview";
    w.postMessage(JSON.stringify({ cmd: "plugin:window|set_size", callback: 1, error: 2, payload: JSON.parse(noKey.body) }));
    return "posted";
  });
  return result;
}
type Req = { url: string; headers: Record<string, string>; body: string };

window.addEventListener("message", async (e) => {
  if (e.source !== parent) return;
  const m = e.data;
  if (m.type === "load") {
    const url = URL.createObjectURL(new Blob([m.bytes], { type: "application/zip" })) + "#" + m.name + ".wmz";
    webamp = new (window as any).WebampModern(document.getElementById("web-amp"), { skin: url, tracks: [m.stream] });
    send({ type: "loaded", name: m.name });
  } else if (m.type === "state") send({ type: "answer", value: state() });
  else if (m.type === "controls") {
    try {
      send({ type: "answer", value: controls() });
    } catch (err) {
      send({ type: "answer", value: text([err]) });
    }
  }
  else if (m.type === "probe") send({ type: "answer", value: await probe(m.noKey, m.withKey) });
});
send({ type: "ready" });
