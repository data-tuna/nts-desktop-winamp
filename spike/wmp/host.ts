// ATA-103 spike host. Runs in the main window, which can call Tauri.
// It fetches a .wmz the frame cannot (archive.org sends no CORS headers),
// hands the bytes to the sandboxed frame, and collects what the frame reports.
// Driven from DevTools: location.href = "/wmp-host.html?skin=<name>&dir=<abs dir>"
// (dev) or "...?skin=<name>&base=http://127.0.0.1:<port>" (release).
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

const STREAM = "https://streams.radiomast.io/nts1";
const params = new URLSearchParams(location.search);
const iframe = document.getElementById("skin") as HTMLIFrameElement;
if (import.meta.env.PROD) {
  // Tauri's asset protocol sends no CORS headers, so a frame with an opaque
  // origin cannot load module scripts from it. Inline the bundle instead.
  const html = await (await fetch("/wmp-frame.html")).text();
  const js = await (await fetch(html.match(/<script[^>]*src="([^"]+)"/)![1])).text();
  const css = await (await fetch(html.match(/<link rel="stylesheet"[^>]*href="([^"]+)"/)![1])).text();
  iframe.srcdoc = html
    .replace(/<script[^>]*src="[^"]+"><\/script>/, () => `<script type="module">${js.replace(/^import"[^"]+";/, "")}<\/script>`)
    .replace(/<link rel="modulepreload"[^>]*>/, "")
    .replace(/<link rel="stylesheet"[^>]*>/, () => `<style>${css}</style>`);
} else {
  iframe.src = "/wmp-frame.html";
}
const frame = iframe.contentWindow!;
const report: unknown[] = [];
let pending: ((v: unknown) => void) | null = null;

// Record the request Tauri's own invoke makes, so the frame can replay it.
let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
const realFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("ipc.localhost") && !captured) {
    captured = {
      url,
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : JSON.stringify(init?.body ?? null),
    };
  }
  return realFetch(input, init);
};

const win = getCurrentWindow();

window.addEventListener("message", async (e) => {
  if (e.source !== frame) return;
  const msg = e.data;
  if (msg.type === "ready") {
    const name = params.get("skin");
    if (!name) return;
    // Dev reads the skin through Vite's /@fs/; a release build has no Vite,
    // so ?base= points at a local server instead.
    const base = params.get("base") ?? `/@fs/${params.get("dir")}`;
    const bytes = await (await realFetch(`${base}/${name}.wmz`)).arrayBuffer();
    frame.postMessage({ type: "load", name, bytes, stream: STREAM }, "*", [bytes]);
    return;
  }
  report.push(msg);
  if (msg.type === "answer" && pending) {
    pending(msg.value);
    pending = null;
  }
});

await win.setSize(new LogicalSize(900, 640));

function ask(type: string, extra: object = {}) {
  return new Promise((resolve) => {
    pending = resolve;
    setTimeout(() => resolve("no answer in 5 s"), 5000);
    frame.postMessage({ type, ...extra }, "*");
  });
}

// Replays Tauri's set_size request from inside the frame, once without the
// invoke key and once with it (as if the key had leaked), then checks
// whether the window changed size.
async function probeIpc() {
  const before = await win.innerSize();
  const req = captured!;
  const target = JSON.stringify({ label: "main", value: { Logical: { width: 321, height: 123 } } });
  const noKey = { ...req, body: target, headers: { ...req.headers } };
  for (const k of Object.keys(noKey.headers)) if (k.toLowerCase() === "tauri-invoke-key") delete noKey.headers[k];
  const withKey = { ...req, body: target };
  const answer = await ask("probe", { noKey, withKey });
  await new Promise((r) => setTimeout(r, 1500));
  const after = await win.innerSize();
  return { captured: { url: req.url, headerNames: Object.keys(req.headers) }, frame: answer, before, after };
}

Object.assign(window, { wmp: { report, ask, probeIpc } });
