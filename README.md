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

## Local companion

The web app polls an optional local companion on `http://127.0.0.1:9876` every 8 seconds.
The companion is a Rust binary in [companion/](companion/) that also serves this UI, so
`http://127.0.0.1:9876` is the whole app offline. Build both with:

```bash
npm run build:companion
```

See [companion/README.md](companion/README.md) for install, permissions, data sources, and limitations.

| Endpoint | Response |
| --- | --- |
| `GET /v1/status` | `{ in_game, account_id, match_id, joined_at, hud_capture_available?, roster_available? }` |
| `GET /v1/roster` | `{ match_id, account_id, duration_s, match_mode_parsed, players: [{ account_id, hero_id, team }] }` |
| `GET /v1/hud-capture` | PNG image of the current scoreboard |

When `roster_available` is true the app imports the roster straight from `/v1/roster`, which also
covers matches that are not visible in Deadlock's public Watch tab. If the endpoint is missing or
fails, the app falls back to the public active-match lookup and then to screenshot OCR.

## Data and privacy

Matchup and item statistics come from [Deadlock API](https://deadlock-api.com/). Screenshot recognition runs in the browser with Tesseract.js; uploaded images are not sent to this project or stored by it.

## Disclaimer

Community project. Not affiliated with or endorsed by Valve. Deadlock and all related properties belong to Valve Corporation.
