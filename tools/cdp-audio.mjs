// Usage: node cdp-audio.mjs <port> [function-body run with `this` = array of audio elements]
// Finds every HTMLAudioElement in the page, attached to the DOM or not
// (Webamp's is not), and prints its playback state.
const [port, body] = process.argv.slice(2);
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
const proto = await send("Runtime.evaluate", { expression: "HTMLAudioElement.prototype" });
const { objects } = await send("Runtime.queryObjects", { prototypeObjectId: proto.result.objectId });
const out = await send("Runtime.callFunctionOn", {
  objectId: objects.objectId,
  returnByValue: true,
  awaitPromise: true,
  functionDeclaration: body ? `async function () { ${body} }` : `function () {
    return this.map((a) => ({ src: a.src, currentSrc: a.currentSrc, crossOrigin: a.crossOrigin,
      paused: a.paused, currentTime: a.currentTime, readyState: a.readyState,
      networkState: a.networkState, error: a.error && { code: a.error.code, message: a.error.message },
      location: location.href, userActivation: navigator.userActivation.hasBeenActive }));
  }`,
});
console.log(JSON.stringify(out.result.value, null, 1));
ws.close();
