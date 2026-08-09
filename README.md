# Deadlock Counterlock

Deadlock Counterlock is a data-driven match assistant for drafting, lane setup, counter picks, and item builds.

## Features

- Import a scoreboard screenshot locally with drag-and-drop, file upload, or clipboard paste
- Detect both teams, the player's hero, and lane assignments
- Drag heroes between Yellow, Blue, and Green lanes
- Estimate same-lane win rates from live matchup samples
- Find counter-pick heroes against the enemy lineup
- Rank items against the enemy carry or the complete team
- Generate an ordered full-match build with sell-and-replace suggestions
- Switch instantly between English and German

## Live website

[Open Deadlock Counterlock](https://febsho.github.io/deadlock-counterlock/)

## Development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Create the Cloudflare-compatible production build:

```bash
npm run build
```

Create the static GitHub Pages export:

```bash
GITHUB_REPOSITORY=Febsho/deadlock-counterlock npm run build:pages
```

## Data and privacy

Matchup and item statistics come from [Deadlock API](https://deadlock-api.com/). Screenshot recognition runs in the browser with Tesseract.js; uploaded images are not sent to this project or stored by it.

## Disclaimer

Community project. Not affiliated with or endorsed by Valve. Deadlock and all related properties belong to Valve Corporation.
