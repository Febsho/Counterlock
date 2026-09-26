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

## Desktop migration

The new Tauri 2 desktop shell is under [`src-tauri/`](src-tauri/). It reuses the
Rust companion's detectors and provider models through direct Rust modules,
loads the current React UI as a static export, and uses IPC/events rather than
starting a localhost server. Build on Linux with `npm run desktop:build` or run
`npm run desktop:dev`. Windows requires the Tauri build prerequisites.

Desktop CI builds the Linux AppImage and Windows NSIS `.exe` installer. Push a
`v*` tag to publish both installers and signed updater metadata on a GitHub
Release. The desktop System page includes **Check for updates**; updates are
downloaded and installed only after confirmation.

Updater signing is required. A keypair has been created at
`~/.tauri/counterlock.key` (private) and `~/.tauri/counterlock.key.pub`
(public). Add the private key file contents as the repository Actions secret
`TAURI_SIGNING_PRIVATE_KEY`; the public key is already embedded in the Tauri
configuration. With GitHub CLI installed and authenticated, you can set it with
`gh secret set TAURI_SIGNING_PRIVATE_KEY < ~/.tauri/counterlock.key`. Then
create a version tag matching `src-tauri/tauri.conf.json`, for example
`v0.1.0`. If you password-protect the key, also add
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Desktop live-match detection uses the running game and its local `console.log`,
not the public Watch-tab match list. Add `-condebug` to Deadlock's Steam launch
options and restart the game to enable log events. Match phase and ID can be
read locally. The desktop can capture the current screen while the in-game
scoreboard is visible; after reviewing and importing its hero detections, the
confirmed roster enters the Rust match state and advisor. Souls and inventory
remain unknown until a separate local source verifies them.
On multiple monitors, select the display showing Deadlock before capturing.

When a completed match has a confirmed match ID, Counterlock queues a Statlocker
notification automatically. It sends the match ID and, when detected, your
Steam account ID so Statlocker can associate the ingestion with your profile;
the local queue retries temporary failures. This uses the same `/populate`
notification path as the [Deadlock API ingest tool](https://github.com/deadlock-api/deadlock-api-ingest/blob/master/src/statlocker.rs).

The desktop work is incremental. See [desktop migration status](docs/DESKTOP_MIGRATION.md)
for implemented features, module decisions, data limits and the remaining
phases. The old loopback companion remains available during the migration.

## Legacy local companion

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
