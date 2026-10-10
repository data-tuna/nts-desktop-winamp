// Usage: node spike/wmp/run-skin.mjs <port> <skin> <skin-dir-or-base-url> <out-dir>
// Opens wmp-host.html on <skin>, waits for the engine, then writes
// <skin>.json (frame log, controls, audio state) and <skin>.png.
import { writeFileSync } from "node:fs";
const [port, skin, dir, out] = process.argv.slice(2);

async function session() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const call = (method, params = {}) =>
    new Promise((resolve) => {
      const my = ++id;
      const on = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.id !== my) return;
        ws.removeEventListener("message", on);
        resolve(msg.result);
      };
      ws.addEventListener("message", on);
      ws.send(JSON.stringify({ id: my, method, params }));
    });
  const evaluate = async (expression) =>
    (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
  return { ws, call, evaluate };
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const origin = new URL(targets.find((t) => t.type === "page").url).origin;
const from = dir.startsWith("http") ? `base=${dir}` : `dir=${dir}`;
let s = await session();
await s.call("Page.navigate", { url: `${origin}/wmp-host.html?skin=${skin}&${from}` });
s.ws.close();
await new Promise((r) => setTimeout(r, 12000));
s = await session();
const log = await s.evaluate("wmp.report.filter(r => r.type === 'log').map(r => r.level + ': ' + r.text)");
const counts = {};
for (const l of log) counts[l] = (counts[l] ?? 0) + 1;
const controls = await s.evaluate("wmp.ask('controls')");
const state = await s.evaluate("wmp.ask('state')");
writeFileSync(`${out}/${skin}.json`, JSON.stringify({ skin, log: counts, state, controls }, null, 1));
const shot = await s.call("Page.captureScreenshot", { format: "png" });
writeFileSync(`${out}/${skin}.png`, Buffer.from(shot.data, "base64"));
s.ws.close();
console.log(JSON.stringify({ log: counts, state }, null, 1));
