import Webamp from "webamp";

const container = document.getElementById("app");
if (!container) {
  throw new Error("#app is missing from index.html");
}

if (!Webamp.browserIsSupported()) {
  container.textContent = "This WebView cannot run Webamp.";
} else {
  // No initialSkin: Webamp falls back to the base skin bundled with the npm package.
  const webamp = new Webamp({});
  webamp.renderWhenReady(container).catch((error: unknown) => {
    console.error("Webamp failed to render", error);
    container.textContent = "Webamp failed to start.";
  });
}
