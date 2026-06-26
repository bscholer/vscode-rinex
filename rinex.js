"use strict";

// RINEX-3 observation-code decoding tables and header parsing.
// Reference: RINEX 3.05 spec, Table A2 (observation codes) and frequency plans.

const CONSTELLATION = {
  G: "GPS",
  R: "GLONASS",
  E: "Galileo",
  J: "QZSS",
  C: "BeiDou",
  S: "SBAS",
  I: "NavIC (IRNSS)",
};

// Observation type (first char of the 3-char code) -> {name, unit}.
const OBS_TYPE = {
  C: { name: "Pseudorange", unit: "m" },
  L: { name: "Carrier phase", unit: "cycles" },
  D: { name: "Doppler", unit: "Hz" },
  S: { name: "Signal strength (C/N0)", unit: "dB-Hz" },
  I: { name: "Ionosphere phase delay", unit: "cycles" },
  X: { name: "Receiver channel number", unit: "" },
};

// Band/frequency (2nd char) -> label + center frequency (MHz), per constellation.
// GLONASS L1/L2 are FDMA (per-PRN); nominal center frequencies shown.
const BANDS = {
  G: { 1: ["L1", 1575.42], 2: ["L2", 1227.6], 5: ["L5", 1176.45] },
  R: {
    1: ["G1 (FDMA)", 1602.0],
    2: ["G2 (FDMA)", 1246.0],
    3: ["G3", 1202.025],
    4: ["G1a", 1600.995],
    6: ["G2a", 1248.06],
  },
  E: {
    1: ["E1", 1575.42],
    5: ["E5a", 1176.45],
    7: ["E5b", 1207.14],
    8: ["E5 (a+b)", 1191.795],
    6: ["E6", 1278.75],
  },
  J: {
    1: ["L1", 1575.42],
    2: ["L2", 1227.6],
    5: ["L5", 1176.45],
    6: ["L6 (LEX)", 1278.75],
  },
  C: {
    1: ["B1C", 1575.42],
    2: ["B1I", 1561.098],
    5: ["B2a", 1176.45],
    6: ["B3", 1268.52],
    7: ["B2b / B2I", 1207.14],
    8: ["B2 (a+b)", 1191.795],
  },
  S: { 1: ["L1", 1575.42], 5: ["L5", 1176.45] },
  I: { 5: ["L5", 1176.45], 9: ["S-band", 2492.028] },
};

// Tracking-mode attribute (3rd char) -> human description.
// Meanings overlap across systems; description is the common interpretation.
const ATTRIBUTE = {
  A: "A channel (PRS / L1OCd)",
  B: "B channel (E1 data / L1OCp / B1C data)",
  C: "C/A code or C channel",
  D: "Data component",
  I: "I channel (in-phase / data)",
  L: "L2C(L) / pilot component",
  M: "M code",
  N: "Codeless",
  P: "P code",
  Q: "Q channel (quadrature / pilot)",
  S: "L2C(M) / D channel",
  W: "Z-tracking (codeless / semi-codeless)",
  X: "Combined (I+Q / M+L / B+C)",
  Y: "Y code",
  Z: "Combined (A+B+C)",
};

// Signal-strength indicator (SSI) digit meaning, in dB-Hz bins.
const SSI = {
  "0": "not known / don't care",
  "1": "< 12 dB-Hz (minimal)",
  "2": "12-17 dB-Hz",
  "3": "18-23 dB-Hz",
  "4": "24-29 dB-Hz",
  "5": "30-35 dB-Hz (threshold for good tracking)",
  "6": "36-41 dB-Hz",
  "7": "42-47 dB-Hz",
  "8": "48-53 dB-Hz",
  "9": ">= 54 dB-Hz (excellent)",
};

// Loss-of-lock indicator (LLI) bit field meaning.
const LLI = {
  "0": "OK (no loss of lock)",
  "1": "Loss of lock between previous and current observation (possible cycle slip)",
  "2": "Opposite wavelength factor / half-cycle ambiguity",
  "3": "Loss of lock + half-cycle ambiguity",
  "4": "Half-cycle ambiguity",
  "5": "Loss of lock + half-cycle ambiguity",
  "6": "Half-cycle ambiguity (opposite wavelength)",
  "7": "Loss of lock + half-cycle ambiguity (opposite wavelength)",
};

const SYS_LETTERS = "GREJCSI";
const HEADER_LABEL = "SYS / # / OBS TYPES";
const END_OF_HEADER = "END OF HEADER";

// Width of one observation field in the data section: F14.3 value + LLI + SSI.
const OBS_FIELD_WIDTH = 16;
// First data column after the 3-char satellite id (sys + PRN).
const DATA_START_COL = 3;

/**
 * Parse the header and return a map: { systemLetter: [obsCode, obsCode, ...] }
 * preserving column order, plus the line index where END OF HEADER occurs.
 */
function parseHeader(lines) {
  const obsMap = {};
  let currentSys = null;
  let headerEndLine = lines.length;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const label = line.slice(60, 80).trim();

    if (label === END_OF_HEADER) {
      headerEndLine = i;
      break;
    }
    if (label !== HEADER_LABEL) continue;

    const first = line[0];
    if (SYS_LETTERS.includes(first)) {
      currentSys = first;
      if (!obsMap[currentSys]) obsMap[currentSys] = [];
    }
    if (!currentSys) continue;

    // Observation codes live in columns 7-60, as 3-char tokens.
    const region = line.slice(6, 60);
    const codes = region.match(/[A-Z][0-9][A-Z0-9]/g);
    if (codes) obsMap[currentSys].push(...codes);
  }

  return { obsMap, headerEndLine };
}

/** Decode a 3-char observation code for a given constellation into markdown. */
function decodeObsCode(code, sysLetter) {
  const type = OBS_TYPE[code[0]];
  const bandTable = BANDS[sysLetter] || {};
  const band = bandTable[code[1]];
  const attr = ATTRIBUTE[code[2]];
  const sysName = CONSTELLATION[sysLetter] || sysLetter;

  const parts = [];
  parts.push(`**\`${code}\`** — ${sysName}`);

  const detail = [];
  if (type) {
    detail.push(`**${type.name}**${type.unit ? ` (${type.unit})` : ""}`);
  } else {
    detail.push(`Type \`${code[0]}\` (unknown)`);
  }
  if (band) {
    detail.push(`${band[0]} — ${band[1]} MHz`);
  } else {
    detail.push(`band \`${code[1]}\``);
  }
  if (attr) detail.push(`tracking: ${attr}`);
  else detail.push(`attribute \`${code[2]}\``);

  parts.push(detail.join(" · "));
  return parts.join("\n\n");
}

/**
 * Given a data line and a character column, return hover markdown describing
 * what is at that column (satellite id, observation value, LLI, or SSI).
 * Returns null if not on a data field.
 */
function describeDataColumn(line, col, obsMap) {
  const sysLetter = line[0];
  if (!SYS_LETTERS.includes(sysLetter)) return null;

  const prn = line.slice(0, 3).trim();

  if (col < DATA_START_COL) {
    const sysName = CONSTELLATION[sysLetter] || sysLetter;
    return `**${prn}** — ${sysName} satellite`;
  }

  const codes = obsMap[sysLetter];
  if (!codes) return null;

  const offset = col - DATA_START_COL;
  const fieldIndex = Math.floor(offset / OBS_FIELD_WIDTH);
  const within = offset % OBS_FIELD_WIDTH;
  const code = codes[fieldIndex];
  if (!code) return null;

  let md = decodeObsCode(code, sysLetter);
  md += `\n\nSatellite **${prn}**, column ${fieldIndex + 1} of ${codes.length}`;

  if (within === 14) {
    const flag = line[col] && line[col].trim();
    const meaning = flag ? LLI[flag] || "unknown" : "blank (OK)";
    md += `\n\n— hovering **LLI** flag: \`${flag || " "}\` = ${meaning}`;
  } else if (within === 15) {
    const flag = line[col] && line[col].trim();
    const meaning = flag ? SSI[flag] || "unknown" : "blank";
    md += `\n\n— hovering **SSI** flag: \`${flag || " "}\` = ${meaning}`;
  }

  return md;
}

// ---------------------------------------------------------------------------
// File-type detection. RINEX puts the file type at column 20 of line 1:
//   "OBSERVATION DATA"  -> O   |   "N: GNSS NAV DATA" -> N
// ---------------------------------------------------------------------------
function detectFormat(firstLine) {
  if (!firstLine) return null;
  const region = firstLine.slice(20, 60);
  if (region.includes("OBSERVATION")) return "OBS";
  if (region.includes("NAV")) return "NAV";
  const c = firstLine[20];
  if (c === "O") return "OBS";
  if ("NGECJ".includes(c)) return "NAV";
  return null;
}

// ---------------------------------------------------------------------------
// Navigation (ephemeris) records.
// Geometry: SV/epoch line = SV id (3) + epoch (cols 3-22) + 3 floats (D19.12,
// first at col 23). Continuation lines = 4 leading spaces + 4 floats (col 4).
// ---------------------------------------------------------------------------
const NAV_FIELD_WIDTH = 19;
const NAV_SV_FIRST_COL = 23;
const NAV_CONT_FIRST_COL = 4;

// Broadcast-orbit parameter names, indexed [recordLine][field].
// Keplerian set: GPS (G), Galileo (E), QZSS (J), BeiDou (C).
const NAV_KEPLER = [
  ["SV clock bias a_f0 (s)", "SV clock drift a_f1 (s/s)", "SV clock drift rate a_f2 (s/s²)"],
  ["IODE — issue of data, ephemeris", "C_rs (m)", "Δn — mean motion difference (rad/s)", "M₀ — mean anomaly (rad)"],
  ["C_uc (rad)", "e — eccentricity", "C_us (rad)", "√a — sqrt semi-major axis (√m)"],
  ["t_oe — ephemeris ref time (s of week)", "C_ic (rad)", "Ω₀ — longitude of asc. node (rad)", "C_is (rad)"],
  ["i₀ — inclination (rad)", "C_rc (m)", "ω — argument of perigee (rad)", "Ω̇ — rate of right ascension (rad/s)"],
  ["IDOT — rate of inclination (rad/s)", "Codes on L2 / data sources", "GNSS week number", "L2 P data flag / spare"],
  ["SV accuracy (m)", "SV health", "TGD / BGD group delay (s)", "IODC — issue of data, clock"],
  ["transmission time (s of week)", "fit interval (h)", "spare", "spare"],
];

// GLONASS (R) and SBAS (S): position / velocity / acceleration set.
const NAV_GLONASS = [
  ["−τ_n — SV clock bias (s)", "+γ_n — relative frequency bias", "message frame time (s of day)"],
  ["X position (km)", "Ẋ velocity (km/s)", "Ẍ acceleration (km/s²)", "health (0=OK)"],
  ["Y position (km)", "Ẏ velocity (km/s)", "Ÿ acceleration (km/s²)", "frequency number"],
  ["Z position (km)", "Ż velocity (km/s)", "Z̈ acceleration (km/s²)", "age of information (days)"],
];

const NAV_SV_RE = /^[GREJCSI]\d\d/;

function navParamTable(sysLetter) {
  return sysLetter === "R" || sysLetter === "S" ? NAV_GLONASS : NAV_KEPLER;
}

/**
 * Describe the NAV column under the cursor. `lines` is the full document,
 * `lineNo` / `col` the cursor. Walks up to the owning SV/epoch line.
 */
function describeNavColumn(lines, lineNo, col) {
  let start = lineNo;
  while (start >= 0 && !NAV_SV_RE.test(lines[start])) start--;
  if (start < 0) return null;

  const sysLetter = lines[start][0];
  const recLine = lineNo - start;
  const table = navParamTable(sysLetter);
  const sysName = CONSTELLATION[sysLetter] || sysLetter;

  if (recLine === 0) {
    const prn = lines[start].slice(0, 3);
    if (col < 3) return `**${prn}** — ${sysName} ephemeris record`;
    if (col < NAV_SV_FIRST_COL) {
      return `**Reference epoch (Toc)** — ${lines[start].slice(3, 23).trim().replace(/\s+/g, " ")}`;
    }
  }

  const firstCol = recLine === 0 ? NAV_SV_FIRST_COL : NAV_CONT_FIRST_COL;
  if (col < firstCol) return null;
  const field = Math.floor((col - firstCol) / NAV_FIELD_WIDTH);
  const row = table[recLine];
  if (!row) return null;
  const name = row[field];
  if (!name) return null;

  return `**${name}**\n\n${sysName} · broadcast orbit line ${recLine}, field ${field + 1}`;
}

// ---------------------------------------------------------------------------
// DJI .MRK marker/event files (whitespace-delimited; token index = meaning).
// Mirrors the team's parser: tokens[6]=lat, [9..11]=std dev, etc.
// ---------------------------------------------------------------------------
const MRK_SCHEMA = [
  { label: "Event number" },
  { label: "GPS time of week", unit: "s" },
  { label: "GPS week" },
  { label: "North offset (antenna phase center → camera CMOS)", unit: "mm" },
  { label: "East offset", unit: "mm" },
  { label: "Vertical (down) offset", unit: "mm" },
  { label: "Latitude (WGS84)", unit: "deg" },
  { label: "Longitude (WGS84)", unit: "deg" },
  { label: "Ellipsoidal height", unit: "m" },
  { label: "Std. deviation — North", unit: "m" },
  { label: "Std. deviation — East", unit: "m" },
  { label: "Std. deviation — Vertical", unit: "m" },
  { label: "Solution quality flag" },
];

/** Tokenize a line into [text, start, end) spans split on whitespace. */
function tokenizeSpans(line) {
  const spans = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    spans.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return spans;
}

function describeMrkColumn(line, col) {
  const spans = tokenizeSpans(line);
  const idx = spans.findIndex((s) => col >= s.start && col < s.end);
  if (idx < 0) return null;
  const schema = MRK_SCHEMA[idx];
  const value = spans[idx].text.replace(/,.*$/, "");
  if (!schema) return `Token ${idx + 1} (no defined meaning)`;
  return `**${schema.label}**${schema.unit ? ` (${schema.unit})` : ""}\n\nvalue: \`${value}\``;
}

module.exports = {
  CONSTELLATION,
  OBS_TYPE,
  BANDS,
  ATTRIBUTE,
  SSI,
  LLI,
  HEADER_LABEL,
  END_OF_HEADER,
  parseHeader,
  decodeObsCode,
  describeDataColumn,
  detectFormat,
  NAV_FIELD_WIDTH,
  NAV_SV_FIRST_COL,
  NAV_CONT_FIRST_COL,
  NAV_SV_RE,
  navParamTable,
  describeNavColumn,
  MRK_SCHEMA,
  tokenizeSpans,
  describeMrkColumn,
};
