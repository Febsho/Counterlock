# Counterlock desktop migration

This document records the repository audit and the implementation sequence. It describes observed behavior, not a claim that every requested telemetry field is available.

## Existing code

| Module | Decision | Reason |
| --- | --- | --- |
| `app/page.tsx`, `app/globals.css` | Reuse and gradually split | Existing hero selection, screenshot import, matchup statistics, item ranking and build planning are valuable. The page is currently one large client component and fetches the public API directly. |
| `companion/src/state.rs` | Reuse now; normalize further | Snapshot/player types preserve unknown combat and inventory fields with `Option`. A future merge layer should also record per-field provenance. |
| `companion/src/provider/{mod,deadlock_api,attached}.rs` | Reuse with explicit capabilities | The public Watch feed is partial and is no longer used for desktop live-match detection. Attached process reading is experimental, Linux-only, and has no shipped offsets; desktop requires an explicit opt-in and falls back to local console state. |
| `companion/src/platform/{mod,linux,windows}.rs`, `steam.rs` | Reuse | Process and local Steam account detection are portable behind traits. Desktop adds manifest based install/build detection. |
| `companion/src/capture.rs` | Keep as manual fallback | Existing capture gets a whole screen; targeted inventory icon recognition is not implemented. It must not be presented as automatic inventory. |
| `companion/src/config.rs`, `logging.rs` | Reuse, then migrate settings | Existing telemetry config works on both OSes. Desktop preferences and compact geometry now use SQLite; the other settings still need a UI and migration. |
| `companion/src/server.rs`, `assets.rs` | Legacy only, then remove | The old companion executable still uses loopback HTTP and embeds the UI. Tauri does not start this server and uses IPC/events. Remove these after feature parity and installer replacement. |
| `app/api/steam-resolve/route.ts`, `worker/`, web build config | Keep for web release, later decouple | Web deployment remains functional during migration. Desktop static export excludes the server route. |
| `companion/packaging/`, `.github/workflows/companion.yml` | Replace after release validation | These package the old HTTP companion, not the new desktop app. |

## Implemented desktop foundation

- Tauri 2 shell loads the static React export. Its Rust process reuses the current detector, Steam account lookup, provider abstraction, snapshot and capture modules directly. It does not start the loopback server.
- `desktop_status`, `match_snapshot`, `hud_capture`, and `toggle_compact` are IPC commands. The Rust loop emits `desktop-status` and `match-state` only when changed.
- The main UI consumes those events and imports a verified roster into the existing recommendation flow. Unknown souls stay unknown in the live display. The compact window shows only fields actually present.
- A tray opens the main or compact window, shows running/match status, opens desktop settings, and quits. Closing the main window hides it to tray by default. The compact window is frameless and resizable. SQLite persists its geometry, the configurable always-on-top and close-to-tray preferences, and the last provider snapshot when a match ends.
- Steam's `appmanifest_1422450.acf` supplies install path and build ID; Steam library folder discovery is included. This is a Steam build ID, not a parsed game content version.
- The console watcher tails appended lines and handles truncation. It parses `ChangeGameState` / `OnGameStateChanged` phases, `Lobby <id> for Match <id> created/destroyed`, a `match_id=` in a Steam datagram ticket line, and a `lobby_id:` in a reconnect-info line, all observed in a local Deadlock `console.log` on 2026-09-25. It now creates a normalized snapshot for the local player's own match and wakes the Rust loop immediately. No log hero ID, player list, souls or inventory was verified.
- The desktop no longer queries `/matches/active` to identify the user's live match, even when an old config selects `deadlock-api`; that source and the web live-import button remain only in the legacy web experience. When telemetry is enabled, desktop selects the local, read-only process-memory reader first and never falls back to the public Watch feed. A SHA-256-locked profile for the locally verified `client.dll` of Steam build `25535087` reads the entity roster, hero IDs, teams, net worth, and KDA. It also accepts bots without Steam IDs in local test matches. Other builds keep those fields unavailable until verified.
- A desktop `Capture Game Screen` action uses the existing local screenshot backend and scoreboard OCR. On multiple monitors the user selects the game display; Rust crops to its physical rectangle before OCR. Once the user reviews and imports the detected sides and own hero, a `submit_local_roster` IPC command records the confirmed roster in the normalized Rust snapshot for the current process/match and can drive the Rust advisor. Team values are relative to the player's side. Match exit or a new hero selection clears the manual roster. This is a user-confirmed capture, not unattended game telemetry.
- A Rust advisor receives the web client's current Counterlock matchup evidence, checks that the hero and enemy roster match the normalized provider snapshot, ranks items, explains its actual matchup and threat inputs, and emits `recommendations` on change. Unknown souls yield unknown affordability. It filters owned items only when the provider declares inventory support. The main and compact windows consume this event.

## Next slices

1. **Local metadata**: parse the installed VPK and Source 2 compiled resources for hero/item definitions. Cache by Steam build ID, verify IDs against the existing public asset schema, and expose parse status. The game installation inspected here stores these definitions in `pak01_dir.vpk`, not plain item JSON.
2. **Normalized state and provider merge**: combine console phase, runtime process and any verified roster snapshot with per-field provenance. Handle match transitions without depending on a public match ID. Unknown inventory is already represented as `null`.
3. **Reliable live data**: derive a game-rules pointer and match clock for the current build; the roster-only memory path currently infers match presence from a human controller and both teams and counts duration from first observation. Implement an inventory walk separately. Revalidate and update the SHA-256-locked profile after game patches. The public `/matches/active` endpoint is Watch-tab/top-200 limited and cannot provide universal live statistics. The current attached reader is Linux-only; Windows process memory access needs its own implementation.
4. **Recommendations**: complete the Rust advisor with local metadata, item upgrades, damage profiles, situational counters, and cached Counterlock statistics. The current Rust scoring covers matchup evidence, known enemy souls, game time, affordability and confirmed owned items; the web UI still fetches analytics and computes its own general browsing ranks.
5. **HUD fallback**: implement cropped inventory icon templates and confidence thresholds; retain a null inventory when detection fails. The present OCR is for manual scoreboard import, not item detection.
6. **Product completion**: extend the existing SQLite store from preferences/geometry/last-match snapshots to parsed metadata and recommendation history; complete the settings UI, optional click-through and startup settings; validate installers, signing/update policy, Windows CI and live runtime on both OSes.

## Technical limits

- Tauri packaging proves a desktop shell, not that a current Deadlock match exposes every requested metric.
- Console logging requires Deadlock launch with `-condebug`. A watcher can observe only lines emitted after it starts; historic file contents are deliberately not replayed as a current match.
- The locally running Deadlock observed on 2026-09-26 used `-console` without `-condebug`; its `console.log` had not changed since the previous day. The rebuilt desktop UI correctly showed `local-console` and no verified event, but a new live-match transition could not be observed without restarting the game with logging enabled.
- The existing web UI still needs Deadlock API for hero/item assets and matchup statistics, so offline recommendations are not yet available. The desktop shell itself and process/console detection work without a remote backend.
- Automatic inventory remains unavailable. Console-only snapshots have no player roster, souls or inventory and cannot trigger an automatic next-buy recommendation. A confirmed local scoreboard roster can trigger advice after Counterlock matchup evidence has loaded, while souls and inventory stay unknown. Unknown inventory is not treated as an empty owned-item list by the Rust advisor.
