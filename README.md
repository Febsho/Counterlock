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
`v0.1.2`. If you password-protect the key, also add
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

Desktop live-match detection uses the running game and its local `console.log`,
not the public Watch-tab match list. Add `-condebug` to Deadlock's Steam launch
options and restart the game to enable log events. Match phase and ID can be
read locally. On the exact supported client build, the attached desktop reader
also reads live souls and the local player's owned items from game memory;
unknown fields remain unavailable on other builds. The desktop can capture the
current screen while the in-game scoreboard is visible; after reviewing and
importing its hero detections, the confirmed roster enters the Rust match state
and advisor.
On multiple monitors, select the display showing Deadlock before capturing.

When a match ends, Counterlock queues its confirmed match ID for ingestion.
This includes an explicit end reported by the local console even if the final
snapshot is still present. It scans Steam's local replay cache for that match's
metadata/replay salts and submits those identifiers to the documented Deadlock
API `/v1/matches/salts` endpoint, then calls Statlocker's `/populate` trigger.
This follows the public [Deadlock API ingest tool](https://github.com/deadlock-api/deadlock-api-ingest) flow, so a match need not already be in the popular-match feed. The local queue retries when cache metadata or either service is temporarily unavailable. Counterlock sends replay salts and the detected account ID; it does not upload the raw replay file or its local snapshot.

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

## Build recommendations

Recommendations combine the hero's recent item baseline, early item-flow data
(including its net-worth-adjusted win rate and observed transitions), exact
selected-enemy-lineup evidence, and per-enemy item matchups. Exact-lineup data
is only allowed to add meaningful weight after its sample reaches the configured
confidence threshold; otherwise individual matchups provide the fallback. Live
desktop net worth, net-worth-derived souls per minute, and K/D/A weight those
enemy matchups by current relative threat. These historical relationships are
observational, not causal. Missing live values stay unknown.

Item-flow requests are cached for an hour in the app session; item-stat requests
are cached for six hours. Manual healing, weapon, spirit, and crowd-control flags
use a small curated mapping from stable item class names to counter tags. Common
enemy items are historical tendencies, never a claim about current enemy
inventory. On the exact supported client build, the desktop reads unspent shop souls from
the local hero pawn currency array and uses that value to label live item
affordability. On the exact supported client build, local owned items are read
from the pawn ability list and resolved against the current item catalog; manual
ownership marks remain available as an override. Total net worth is never used
as shop balance.

The optional Statlocker profile lookup uses only the documented batch profiles
endpoint, through `/api/statlocker/profiles`. Configure `STATLOCKER_API_KEY` in
the server environment to enable it; the proxy strips the response to account ID
and PP score and never accepts or returns a key. Its PP score is a small threat
prior, below live net worth, souls/min and K/D/A. Missing configuration,
authorization failures and rate limits leave Deadlock API recommendations
working normally. Static GitHub Pages and the bundled desktop app do not host a
server route, so profile lookup remains unavailable there unless the app is
paired with a configured API host. When used, the UI attributes Statlocker.
Match-salt ingestion is a separate desktop flow and does not require this
profile API key.

## Disclaimer

Community project. Not affiliated with or endorsed by Valve. Deadlock and all related properties belong to Valve Corporation.
