"use strict";

const vscode = require("vscode");
const rinex = require("./rinex");

const RAINBOW = ["rinexF0", "rinexF1", "rinexF2", "rinexF3", "rinexF4", "rinexF5", "rinexF6"];
const TOKEN_TYPES = [
  ...RAINBOW,
  "rinexSat",
  "rinexEpoch",
  "rinexLabel",
  "rinexSys",
  "rinexCount",
  "rinexObsC",
  "rinexObsL",
  "rinexObsD",
  "rinexObsS",
  "rinexHeaderVal",
  "rinexFlag",
];
const TYPE_INDEX = Object.fromEntries(TOKEN_TYPES.map((t, i) => [t, i]));
const LEGEND = new vscode.SemanticTokensLegend(TOKEN_TYPES, []);

const OBS_FIELD_WIDTH = 16;
const DATA_START_COL = 3;
const SYS_LETTERS = "GREJCSI";
const OBS_BY_TYPE = { C: "rinexObsC", L: "rinexObsL", D: "rinexObsD", S: "rinexObsS" };
const OBS_CODE_RE_FULL = /^[CLDS][0-9][A-Z]$/;
const NUM_FULL = /^[-+]?\d*\.?\d+(?:[eEdD][-+]?\d+)?$/;

// ---- per-document cache -----------------------------------------------------
const cache = new Map();

function getDoc(document) {
  const key = document.uri.toString();
  const hit = cache.get(key);
  if (hit && hit.version === document.version) return hit.info;

  const first = document.lineCount ? document.lineAt(0).text : "";
  const format = rinex.detectFormat(first);
  const major = Math.trunc(parseFloat(first.slice(0, 9)) || 0);

  const lines = [];
  for (let i = 0; i < document.lineCount; i++) lines.push(document.lineAt(i).text);

  let headerEndLine = -1;
  let obsMap = {};
  if (format) {
    const parsed = rinex.parseHeader(lines);
    obsMap = parsed.obsMap;
    headerEndLine = parsed.headerEndLine;
  }

  const info = { format, major, lines, obsMap, headerEndLine };
  cache.set(key, { version: document.version, info });
  return info;
}

// ---- header coloring (shared by OBS and NAV) --------------------------------
function colorHeaderLine(builder, i, line, isObsTypeLine) {
  const label = line.slice(60, 80);
  const trimmed = label.trim();

  if (isObsTypeLine) {
    if (SYS_LETTERS.includes(line[0])) {
      builder.push(i, 0, 1, TYPE_INDEX.rinexSys);
      const count = /\d+/.exec(line.slice(1, 6));
      if (count) builder.push(i, 1 + count.index, count[0].length, TYPE_INDEX.rinexCount);
    }
    const region = line.slice(6, 60);
    const re = /[A-Z][0-9][A-Z0-9]/g;
    let m;
    while ((m = re.exec(region)) !== null) {
      const type = OBS_BY_TYPE[m[0][0]] || "rinexCount";
      builder.push(i, 6 + m.index, 3, TYPE_INDEX[type]);
    }
  } else {
    // Classify each whitespace-delimited token in the value region: obs codes
    // (e.g. GLONASS COD/PHS/BIS) by type, plain numbers as header values.
    // Token-level matching avoids coloring the "1" inside a code like C1C.
    for (const s of rinex.tokenizeSpans(line.slice(0, 60))) {
      let type = null;
      if (OBS_CODE_RE_FULL.test(s.text)) type = OBS_BY_TYPE[s.text[0]];
      else if (NUM_FULL.test(s.text)) type = "rinexHeaderVal";
      if (type) builder.push(i, s.start, s.text.length, TYPE_INDEX[type]);
    }
  }

  if (trimmed) {
    builder.push(i, 60 + label.indexOf(trimmed[0]), trimmed.length, TYPE_INDEX.rinexLabel);
  }
}

// ---- OBS data ---------------------------------------------------------------
function buildObs(builder, info) {
  const { lines, obsMap, headerEndLine } = info;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (i <= headerEndLine) {
      colorHeaderLine(builder, i, line, line.slice(60, 80).trim() === rinex.HEADER_LABEL);
      continue;
    }

    if (line[0] === ">") {
      builder.push(i, 0, line.length, TYPE_INDEX.rinexEpoch);
      continue;
    }

    const sys = line[0];
    if (!SYS_LETTERS.includes(sys)) continue;
    const codes = obsMap[sys];
    if (!codes) continue;

    builder.push(i, 0, DATA_START_COL, TYPE_INDEX.rinexSat);
    for (let f = 0; f < codes.length; f++) {
      const start = DATA_START_COL + f * OBS_FIELD_WIDTH;
      if (start >= line.length) break;
      if (!line.slice(start, start + 14).trim()) continue;
      // Color the value by observation type so it matches the header def
      // (C=pseudorange, L=phase, D=doppler, S=strength).
      const valLen = Math.min(14, line.length - start);
      builder.push(i, start, valLen, TYPE_INDEX[OBS_BY_TYPE[codes[f][0]] || "rinexObsC"]);
      // LLI (col 15) and SSI (col 16) flag characters, when present.
      const lli = line[start + 14];
      if (lli && lli !== " ") builder.push(i, start + 14, 1, TYPE_INDEX.rinexFlag);
      const ssi = line[start + 15];
      if (ssi && ssi !== " ") builder.push(i, start + 15, 1, TYPE_INDEX.rinexFlag);
    }
  }
}

// ---- NAV data ---------------------------------------------------------------
function colorNavFields(builder, i, line, firstCol) {
  let f = 0;
  for (let start = firstCol; start < line.length; start += rinex.NAV_FIELD_WIDTH) {
    const span = line.slice(start, start + rinex.NAV_FIELD_WIDTH);
    if (span.trim()) {
      const len = Math.min(rinex.NAV_FIELD_WIDTH, line.length - start);
      builder.push(i, start, len, TYPE_INDEX[RAINBOW[f % RAINBOW.length]]);
    }
    f++;
  }
}

function buildNav(builder, info) {
  const { lines, headerEndLine } = info;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    if (i <= headerEndLine) {
      colorHeaderLine(builder, i, line, false);
      continue;
    }

    if (rinex.NAV_SV_RE.test(line)) {
      builder.push(i, 0, 3, TYPE_INDEX.rinexSat);
      builder.push(i, 3, rinex.NAV_SV_FIRST_COL - 3, TYPE_INDEX.rinexEpoch);
      colorNavFields(builder, i, line, rinex.NAV_SV_FIRST_COL);
    } else {
      colorNavFields(builder, i, line, rinex.NAV_CONT_FIRST_COL);
    }
  }
}

// ---- MRK --------------------------------------------------------------------
function buildMrk(builder, document) {
  for (let i = 0; i < document.lineCount; i++) {
    const line = document.lineAt(i).text;
    if (!line.trim()) continue;
    const spans = rinex.tokenizeSpans(line);
    spans.forEach((s, idx) => {
      builder.push(i, s.start, s.end - s.start, TYPE_INDEX[RAINBOW[idx % RAINBOW.length]]);
    });
  }
}

function buildRinexTokens(document) {
  const info = getDoc(document);
  const builder = new vscode.SemanticTokensBuilder(LEGEND);
  // Precise field geometry is RINEX-3 specific; for other versions we still
  // color header labels but skip data coloring to avoid wrong columns.
  if (info.major === 3) {
    if (info.format === "OBS") buildObs(builder, info);
    else if (info.format === "NAV") buildNav(builder, info);
  } else if (info.headerEndLine >= 0) {
    for (let i = 0; i <= info.headerEndLine; i++) {
      const line = info.lines[i];
      if (line) colorHeaderLine(builder, i, line, line.slice(60, 80).trim() === rinex.HEADER_LABEL);
    }
  }
  return builder.build();
}

// ---- hovers -----------------------------------------------------------------
function rinexHover(document, position) {
  const info = getDoc(document);
  const line = document.lineAt(position.line).text;
  const col = position.character;

  if (position.line <= info.headerEndLine) {
    const label = line.slice(60, 80).trim();
    if (label === rinex.HEADER_LABEL && col >= 60) {
      return hover("**SYS / # / OBS TYPES** — defines the per-constellation column layout used by every data record.");
    }
    return null;
  }

  if (info.major !== 3) return null;

  let md = null;
  if (info.format === "OBS") md = rinex.describeDataColumn(line, col, info.obsMap);
  else if (info.format === "NAV") md = rinex.describeNavColumn(info.lines, position.line, col);
  return md ? hover(md) : null;
}

function mrkHover(document, position) {
  const md = rinex.describeMrkColumn(document.lineAt(position.line).text, position.character);
  return md ? hover(md) : null;
}

function hover(markdown) {
  return new vscode.Hover(new vscode.MarkdownString(markdown));
}

function activate(context) {
  context.subscriptions.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      "rinex",
      { provideDocumentSemanticTokens: buildRinexTokens },
      LEGEND
    ),
    vscode.languages.registerDocumentSemanticTokensProvider(
      "dji-mrk",
      { provideDocumentSemanticTokens: (doc) => {
        const b = new vscode.SemanticTokensBuilder(LEGEND);
        buildMrk(b, doc);
        return b.build();
      } },
      LEGEND
    ),
    vscode.languages.registerHoverProvider("rinex", { provideHover: rinexHover }),
    vscode.languages.registerHoverProvider("dji-mrk", { provideHover: mrkHover }),
    vscode.workspace.onDidCloseTextDocument((doc) => cache.delete(doc.uri.toString()))
  );
}

function deactivate() {
  cache.clear();
}

module.exports = { activate, deactivate };
