// webamp 2.3.x points "webamp/butterchurn" at types/js/butterchurn.d.ts, which
// the package does not ship. That bundle is Webamp with Butterchurn and its
// presets built in, and the same API, so reuse the main entry's types.
declare module "webamp/butterchurn" {
  import Webamp from "webamp";
  export default Webamp;
}
