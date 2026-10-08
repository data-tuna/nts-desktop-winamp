// Usage: node cdp.mjs <port> <js-expression>   (expression may return a promise)
const [port, expr] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }));
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== 1) return;
  console.log(JSON.stringify(msg.error ?? msg.result.result?.value ?? msg.result, null, 1));
  ws.close();
});
