// Usage: node spike/wmp/click.mjs <port> <x> <y> [<x2> <y2>]
// A real mouse click at (x, y) in the host page, or a drag to (x2, y2).
// The frame fills the page from 0,0, so these are frame coordinates too.
const [port, ...xy] = process.argv.slice(2);
const [x, y, x2 = x, y2 = y] = xy.map(Number);
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const send = (type, px, py, buttons) =>
  new Promise((r) => {
    const my = ++id;
    ws.addEventListener("message", function on(m) {
      if (JSON.parse(m.data).id === my) (ws.removeEventListener("message", on), r());
    });
    ws.send(JSON.stringify({ id: my, method: "Input.dispatchMouseEvent", params: { type, x: px, y: py, button: "left", buttons, clickCount: 1 } }));
  });
await send("mouseMoved", x, y, 0);
await send("mousePressed", x, y, 1);
if (x2 !== x || y2 !== y) for (let i = 1; i <= 5; i++) await send("mouseMoved", x + ((x2 - x) * i) / 5, y + ((y2 - y) * i) / 5, 1);
await send("mouseReleased", x2, y2, 0);
ws.close();
