// Usage: node spike/wmp/cdp-frame.mjs <port> <js-expression>
// Like tools/cdp.mjs, but evaluates inside the sandboxed WMP frame: its own
// target in dev (src=/wmp-frame.html), or an execution context of the page
// in a release build (srcdoc frames run in-process).
const [port, expr] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const own = targets.find((t) => t.type === "iframe" && t.url.includes("wmp-frame"));
const ws = new WebSocket((own ?? targets.find((t) => t.type === "page")).webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
const contexts = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Runtime.executionContextCreated") contexts.push(msg.params.context);
});
let contextId;
if (!own) {
  ws.send(JSON.stringify({ id: 0, method: "Runtime.enable" }));
  await new Promise((r) => setTimeout(r, 500));
  // The sandboxed frame's default context is the one not at the app's origin.
  const page = new URL(targets.find((t) => t.type === "page").url).origin;
  contextId = contexts.find((c) => c.auxData?.isDefault && c.origin !== page)?.id;
}
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true, contextId } }));
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  console.log(JSON.stringify(msg.error ?? msg.result.result?.value ?? msg.result, null, 1));
  ws.close();
});
