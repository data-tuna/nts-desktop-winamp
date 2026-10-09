// Run with `npm test`. Node strips the TypeScript types itself (22.18+).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeEntities, parseLive } from "../src/live.ts";

// A real /api/v2/live response from 2026-10-09, trimmed to the fields read.
const fixture = JSON.parse(readFileSync(new URL("live-fixture.json", import.meta.url), "utf8"));

test("titles, locations, artwork, end times and next shows", () => {
  const [nts1, nts2] = parseLive(fixture);
  assert.equal(nts1.title, "THE NTS BREAKFAST SHOW w/ CHEB MIMO & NIHAL - London");
  assert.equal(nts1.endsAt, Date.parse("2026-10-09T10:00:00Z"));
  assert.match(nts1.artwork, /^https:\/\/media3\.ntslive\.co\.uk\/resize\/200x200\//);
  assert.deepEqual(nts1.next, { title: "SOUP TO NUTS w/ ARCHITECT", startsAt: Date.parse("2026-10-09T10:00:00Z") });
  assert.equal(nts2.title, "The weirdness of dancing w/ JULES FRANCIS - Paris");
});

test("a show with no location or artwork keeps its title", () => {
  const body = { results: [{ channel_name: "2", now: { broadcast_title: "In Focus", embeds: { details: null } } }] };
  assert.deepEqual(parseLive(body), [undefined, { title: "In Focus", artwork: undefined, endsAt: undefined, next: undefined }]);
});

test("anything not shaped like the API gives no shows", () => {
  for (const body of [null, "", [], {}, { results: {} }, { results: [null, { channel_name: "1", now: { broadcast_title: 3 } }] }]) {
    assert.deepEqual(parseLive(body), [undefined, undefined]);
  }
});

test("HTML entities", () => {
  assert.equal(decodeEntities("A &amp; B &#39;C&#x27; &quot;D&quot; &lt;3"), "A & B 'C' \"D\" <3");
  assert.equal(decodeEntities("&eacute; &#0; &bogus"), "&eacute; &#0; &bogus");
});
