"use strict";

// Plain-node test harness (no framework). Run: `npm test` or `node test/test.js`.
// Each assertion targets a real parsing/decoding decision that could regress,
// not tautologies.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const r = require("../rinex");

const FIX = path.join(__dirname, "fixtures");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8").split(/\r?\n/);

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
}

// ---------------------------------------------------------------------------
test("detectFormat distinguishes OBS / NAV from the version line", () => {
  assert.strictEqual(r.detectFormat("     3.05           OBSERVATION DATA    M: Mixed            RINEX VERSION / TYPE"), "OBS");
  assert.strictEqual(r.detectFormat("     3.05           N: GNSS NAV DATA    M: Mixed            RINEX VERSION / TYPE"), "NAV");
  assert.strictEqual(r.detectFormat(""), null);
});

test("parseHeader maps each constellation to its ordered obs codes", () => {
  const { obsMap, headerEndLine } = r.parseHeader(read("sample.obs"));
  // GPS declares 16 obs types spanning two header lines (continuation).
  assert.strictEqual(obsMap.G.length, 16, "GPS obs count across continuation line");
  assert.deepStrictEqual(obsMap.G.slice(0, 4), ["C1C", "L1C", "D1C", "S1C"]);
  assert.strictEqual(obsMap.G[12], "C5I", "13th code is first on the continuation line");
  assert.strictEqual(obsMap.E.length, 24);
  assert.ok(headerEndLine > 0 && headerEndLine < read("sample.obs").length);
});

test("OBS column maps to the correct obs code via 16-char field stride", () => {
  const { obsMap } = r.parseHeader(read("sample.obs"));
  const gline = read("sample.obs").find((l) => /^G 8/.test(l));
  assert.ok(gline, "fixture has a G08 record");
  // field 0 (cols 3-18) is C1C; field 2 (cols 35-50) is D1C.
  assert.match(r.describeDataColumn(gline, 5, obsMap), /C1C/);
  assert.match(r.describeDataColumn(gline, 37, obsMap), /D1C/);
  // satellite id region
  assert.match(r.describeDataColumn(gline, 1, obsMap), /GPS satellite/);
});

test("obs-code decode resolves type, band frequency, and tracking", () => {
  const md = r.decodeObsCode("L7I", "E");
  assert.match(md, /Carrier phase/);
  assert.match(md, /E5b/);
  assert.match(md, /1207\.14 MHz/);
  // BeiDou B1I differs from GPS L1 even though both are "1" band.
  assert.match(r.decodeObsCode("C2I", "C"), /B1I/);
  assert.match(r.decodeObsCode("C2I", "C"), /1561\.098 MHz/);
});

test("NAV column maps to the right broadcast-orbit parameter", () => {
  const lines = read("sample.nav");
  const svLine = lines.findIndex((l) => /^G18/.test(l));
  assert.ok(svLine >= 0);
  // On the SV line, field 0 (col 23) is the clock bias a_f0.
  assert.match(r.describeNavColumn(lines, svLine, 25), /clock bias a_f0/);
  // First continuation line, field 3 (Keplerian) is M0.
  assert.match(r.describeNavColumn(lines, svLine + 1, 70), /M₀/);
  // GLONASS uses the position/velocity table, not Keplerian.
  const rLine = lines.findIndex((l) => /^R12/.test(l));
  assert.match(r.describeNavColumn(lines, rLine + 1, 10), /position \(km\)/);
});

test("MRK token index maps to the documented column meaning", () => {
  const line = read("sample.mrk").find((l) => l.trim());
  const spans = r.tokenizeSpans(line);
  // token 6 = latitude, token 9 = std dev north (per the team's parser).
  const latCol = spans[6].start + 1;
  const sdCol = spans[9].start + 1;
  assert.match(r.describeMrkColumn(line, latCol), /Latitude/);
  assert.match(r.describeMrkColumn(line, sdCol), /North/);
  assert.match(r.describeMrkColumn(line, spans[1].start + 1), /GPS time of week/);
});

console.log(`\n${passed} tests passed`);
