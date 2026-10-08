// Usage: node cdp-shot.mjs <port> <out.png> [url-substring]
// Saves what the renderer paints, from the first page whose URL contains
// url-substring (default: the main window). Use it rather than
// window-shot.ps1 after a skin change: PrintWindow can return a stale frame.
import { writeFileSync } from "node:fs";
const [port, out, match] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(
  (t) => t.type === "page" && (match ? t.url.includes(match) : !t.url.includes("picker")),
);
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  writeFileSync(out, Buffer.from(msg.result.data, "base64"));
  ws.close();
});
ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
