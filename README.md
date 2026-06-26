# RINEX Tools

VS Code / Cursor extension for RINEX GNSS files (`.OBS`, `.NAV`, `.rnx`, `.YYo`, …) and DJI `.MRK` marker files.

## Supported files

| Format | Detection | Highlight | Hover |
| --- | --- | --- | --- |
| RINEX 3 **OBS** (observation) | content (`RINEX VERSION / TYPE`) + extension | header + obs columns colored by type | obs-code decode, LLI/SSI flags |
| RINEX 3 **NAV** (ephemeris) | content + extension | header + SV/epoch + value columns | broadcast-orbit parameter names |
| DJI **.MRK** (marker/events) | extension | rainbow columns | per-column meaning (lat/lon/offset/σ) |

## Features

- **Format auto-detection** — primary signal is the line-1 content signature (`RINEX VERSION / TYPE`, file type at col 20), so renamed / oddly-suffixed files still work; extension globs are a fallback.
- **Syntax highlighting** — constellation letters, PRNs, epoch records, header descriptor labels (cols 61–80), and header numeric values. OBS data values are colored **by observation type** (pseudorange / phase / doppler / strength) so a data column matches its header definition; LLI/SSI flag characters are dimmed. NAV and MRK columns are rainbow-cycled.
- **OBS observation-code hovers** — parses `SYS / # / OBS TYPES` to map the column under the cursor to its code and decode it:
  - **C1C** → GPS · Pseudorange (m) · L1 — 1575.42 MHz · tracking: C/A code
  - **L7I** → Galileo · Carrier phase (cycles) · E5b — 1207.14 MHz · tracking: I channel
- **OBS flag hovers** — LLI / SSI characters (chars 15–16 of each 16-wide field) decode loss-of-lock and signal-strength bins.
- **NAV ephemeris hovers** — maps the broadcast-orbit field to its parameter (Keplerian set for G/E/J/C; position/velocity set for R/S).
- **MRK column hovers** — token index → meaning, mirroring the team's parser (lat/lon/height, N/E/V offsets, per-axis σ).

## Standards scope

- **RINEX 3.0x**: OBS + NAV fully handled (16-char obs fields; NAV `D19.12` 19-char fields).
- **RINEX 2.x**: detected, header labels colored, but data coloring/hover skipped (v2 has different epoch format, `# / TYPES OF OBSERV` header, 2-digit PRN, 80-col wrap). Avoids wrong columns rather than guessing.
- **Not yet**: Hatanaka-compressed (`.crx`/`.??d` — needs `CRX2RNX` first); OBS special-event epoch blocks (flag 2–6); RINEX 2 data.

## Tests

```sh
npm test    # node test/test.js — parsing + decode assertions against fixtures in test/fixtures/
```

## How it parses

RINEX-3 observation records are **fixed-width**, not delimited: a 3-char satellite id (`G08`) followed by repeating 16-char fields — `F14.3` value + 1-char LLI + 1-char SSI. Column meaning is **per-constellation** and defined in the header, so the extension reads the header (cached per document version) to know that column 5 of a `G` row is `C1C` while column 5 of a `C` row is `C6I`.

## Run / debug

Open this folder in VS Code or Cursor and press **F5** ("Run RINEX Extension"). A new Extension Development Host window opens — open a `.OBS` file there and hover.

No build step: plain CommonJS JavaScript.

## Install from source

```sh
git clone git@github.com:bscholer/vscode-rinex.git
cd vscode-rinex
```

Then either symlink it into your editor's extensions dir (best while iterating):

```sh
ln -s "$PWD" ~/.vscode/extensions/rinex-tools-0.1.0   # reload window after
```

…or package a `.vsix` and install it:

```sh
npm install -g @vscode/vsce
vsce package                                         # produces rinex-tools-0.1.0.vsix
code --install-extension rinex-tools-0.1.0.vsix      # or: cursor --install-extension ...
```

No build step — plain CommonJS JavaScript.

## Roadmap

- Diagnostics: field-count mismatch vs header, bad epoch flags, width drift; flag known DJI BeiDou **B2I-mislabeled-as-C5I** observables.
- RINEX 2.x data coloring/hover; OBS special-event epoch blocks (flag 2–6); Hatanaka decode.
- CodeLens on epoch lines: decoded per-constellation sat counts.
- Status-bar readout of constellation / PRN / obs-type under cursor.
- Commands: jump-to-epoch-by-time, satellite visibility table.
- Band-aware coloring (type → hue, band → shade).
