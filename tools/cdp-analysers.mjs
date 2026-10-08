// Usage: node cdp-analysers.mjs <port>
// Reads every live AnalyserNode in the page (Webamp's own visualiser and
// Butterchurn's) and reports how much signal each one sees right now.
const [port] = process.argv.slice(2);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  pending.get(msg.id)?.(msg.result);
});
const send = (method, params) =>
  new Promise((r) => {
    pending.set(++id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const proto = await send("Runtime.evaluate", { expression: "AnalyserNode.prototype" });
const { objects } = await send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId });
const out = await send("Runtime.callFunctionOn", {
  objectId: objects.objectId,
  returnByValue: true,
  functionDeclaration: `function () {
    return this.map((n) => {
      const bins = new Uint8Array(n.frequencyBinCount);
      n.getByteFrequencyData(bins);
      const nonZero = bins.filter((b) => b > 0).length;
      return { fftSize: n.fftSize, bins: bins.length, nonZeroBins: nonZero,
        peak: Math.max(...bins), contextState: n.context.state,
        contextTime: n.context.currentTime.toFixed(1) };
    });
  }`,
});
console.log(JSON.stringify(out.result.value));
ws.close();
