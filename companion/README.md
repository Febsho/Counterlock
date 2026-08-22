# Counterlock Companion

A single self-contained binary that serves the Counterlock UI and a
localhost-only match-data API. Linux first; Windows supported.

```
┌─ counterlock-companion ────────────────────────────┐
│  embedded UI (Next.js static export)               │
│  HTTP server  127.0.0.1:9876                       │
│  poll loop    process lifecycle + telemetry        │
│  platform     Linux /proc  |  Windows Toolhelp     │
└────────────────────────────────────────────────────┘
```

The UI is compiled into the binary, so `http://127.0.0.1:9876` works offline
with nothing else installed.

## Build

Node 22+ and Rust 1.82+ required. The UI export must be built first: it is
embedded at compile time.

```bash
npm run build:companion
```

That runs `build:companion-ui` (a static export with an empty basePath) and then
`cargo build --release`. The binary lands at
`companion/target/release/counterlock-companion`.

## Install

### Linux

```bash
companion/packaging/linux/install.sh
```

Installs to `~/.local/bin`, enables a **systemd user service**, and seeds
`~/.config/counterlock/companion.toml`. No root, no system-wide changes.

```bash
systemctl --user status counterlock-companion
journalctl --user -u counterlock-companion -f
```

The unit is sandboxed: `ProtectHome=read-only`, an empty `CapabilityBoundingSet`,
and a `SystemCallFilter` that denies `@debug` — it cannot trace or read another
process even if it tried.

### Windows

Run the installer from the [companion workflow](../.github/workflows/companion.yml)
artifacts, or build it locally with Inno Setup:

```
iscc companion\packaging\windows\counterlock-companion.iss
```

Per-user install: **no administrator rights, no Windows Service, no firewall
rule** (Windows does not filter loopback). "Start automatically when I sign in"
adds an `HKCU\...\Run` entry.

## Configuration

`~/.config/counterlock/companion.toml` (Linux) or
`%APPDATA%\counterlock\companion.toml` (Windows). See
[config.example.toml](config.example.toml). Environment variables override the
file:

| Variable | Purpose |
| --- | --- |
| `COUNTERLOCK_PORT` | Loopback port (default 9876) |
| `COUNTERLOCK_ACCOUNT_ID` | Account id, SteamID64, or numeric profile URL |
| `COUNTERLOCK_ALLOWED_ORIGINS` | Comma-separated extra origins |
| `COUNTERLOCK_ENABLE_HUD_CAPTURE` | `true` / `false` |
| `COUNTERLOCK_ALLOW_UPLOADS` | `true` / `false` (default `false`) |
| `COUNTERLOCK_JSON_LOGS` | `true` for newline-delimited JSON logs |
| `RUST_LOG` | Log level, e.g. `counterlock_companion=debug` |

## API

All endpoints are `GET` on `http://127.0.0.1:9876`.

| Endpoint | Returns |
| --- | --- |
| `/v1/health` | Liveness and version |
| `/v1/status` | `in_game`, `account_id`, `match_id`, `joined_at`, `hud_capture_available`, `roster_available`, `game_running`, `provider`, `last_error` |
| `/v1/match` | Full snapshot (see below) |
| `/v1/roster` | Same payload; the name the web app polls |
| `/v1/capabilities` | What the active provider can and cannot supply |
| `/v1/hud-capture` | PNG screenshot, when enabled |
| everything else | The embedded UI |

Snapshot shape:

```json
{
  "match_id": 123, "account_id": 42, "start_time": 1000,
  "duration_s": 600, "paused_s": null, "paused": null,
  "match_mode_parsed": "Ranked",
  "game_time_s": 600, "phase": "early",
  "source": "deadlock-api", "observed_at": 1787382291,
  "players": [{
    "account_id": 42, "hero_id": 7, "team": 0, "slot": 1,
    "kills": null, "deaths": null, "assists": null,
    "net_worth": null, "souls_per_minute": null, "items": []
  }]
}
```

`null` means **this source does not report the field**, never "the value is
zero". Call `/v1/capabilities` to find out which is which.

`souls_per_minute` is derived, not reported: `net_worth / active_game_minutes`,
where active minutes exclude `paused_s` when the provider supplies it. It is
`null` whenever `net_worth` is unknown or no active time has elapsed.

## Data sources

Three sources, selected with `provider` in the config.

| Field | `attached` | `deadlock-api` | HUD capture + OCR |
| --- | --- | --- | --- |
| match id, roster, hero ids, teams | yes | yes | partial |
| game time / phase | yes | yes | yes |
| kills / deaths / assists | **yes** | no | yes |
| net worth (souls) | **yes** | no | yes |
| items | no | no | yes |
| pause state | **yes** | no | no |

`deadlock-api` only publishes what Deadlock's own Watch tab exposes, which is
roster-level: **per-player combat stats are not available from it.**

### The `attached` provider

Default since it is the only source that reports live combat stats. It opens
`/proc/<pid>/mem` on the running client, follows the entity list and the
game-rules object, and copies out the values the HUD already draws. It is
**strictly read-only**: no writes, no injection, no hooks. Scope is limited to
data this client already received — an external reader cannot surface
information the server withheld, so it yields no information the scoreboard
does not already show you.

It reads the roster during `HeroSelection`, `MatchIntro` and `PreGameWait`, so
the draft is available before the horn, and derives souls/minute from
`m_iGoldNetWorth` and the engine clock (`curtime - m_flGameStartTime`).

**Reading another process's memory is detectable by anti-cheat and is against
Deadlock's terms of service.** Set `provider = "deadlock-api"` to keep the
companion entirely outside the game process.

It degrades instead of guessing. When the process cannot be read, or the
configured offsets no longer fit the running build, it logs the reason once and
falls back to `deadlock-api` — and `/v1/capabilities` then reports that
provider's narrower matrix, so the answer always describes the source that
produced the last snapshot. `MatchSnapshot.source` names it per snapshot.

### Offsets

**No offsets ship with the companion.** They move on every game patch, so each
is optional and commented out in [config.example.toml](config.example.toml).
Without the four essentials — `client.game_rules`, `rules.game_state`,
`client.entity_system`, `player.steam_id` — the provider names what is missing
and falls back. A failed pointer dereference is logged with its address:

```
WARN direct pointer read failed address=0x7f2c11a4b3d0 error=...
```

A live match in which no player controller is readable is treated as an error
rather than an empty lobby, so a patch that moves the offsets shows up as a
fallback, never as a roster of zeros.

`/v1/status` reports `roster_available` so the UI can prefer the local roster and
fall back to screenshot import; see the [main README](../README.md).

## Permissions

### Linux

Process detection reads `/proc/<pid>/comm`, which needs no special permission.

The `attached` provider additionally reads `/proc/<pid>/mem`, which is gated by
the same `PTRACE_MODE_ATTACH` check as `ptrace(2)`. With the usual
`kernel.yama.ptrace_scope=1` that needs a capability:

```bash
sudo setcap cap_sys_ptrace+ep ~/.local/bin/counterlock-companion
```

**The shipped systemd unit deliberately blocks this**: it has an empty
`CapabilityBoundingSet` and a `SystemCallFilter` denying `@debug`, so a
service-managed companion cannot read another process even with the capability
set, and will always fall back to `deadlock-api`. That sandbox is the safe
default and is left intact. To use the attached reader, either run the binary
directly instead of through the unit, or add a drop-in that grants
`AmbientCapabilities=CAP_SYS_PTRACE` and removes the `@debug` denial — which
knowingly weakens the sandbox.

Screen capture depends on the display server. On **Wayland** the compositor
mediates access, so a helper must be installed and the screenshot portal allowed
when prompted:

| Session | Backend |
| --- | --- |
| wlroots (Sway, Hyprland) | `grim` |
| KDE Plasma | `spectacle` |
| GNOME | `gnome-screenshot` (portal) |
| X11 | `import` (ImageMagick) or `maim` |

Flatpak Steam users additionally need `org.freedesktop.portal.Screenshot`.
`/v1/capabilities` reports the detected session and the exact hint.

### Windows

Capture uses the built-in .NET graphics APIs — no extra permissions and no
elevation. If captures come out black, Deadlock is in exclusive full-screen;
switch it to borderless windowed.

## Privacy

- Binds `127.0.0.1` only. The bind address is not configurable.
- A non-loopback `Host` header is rejected, which blocks DNS-rebinding attacks
  where a public hostname resolves to 127.0.0.1.
- CORS is allow-listed, never `*`.
- Screenshots are written to a temp file, served over loopback, and deleted
  immediately — on success and on failure.
- `allow_uploads` defaults to `false`. Nothing in this binary uploads match data
  or screenshots. The flag exists so that cannot change silently.
- The only outbound request is to `deadlock_api_base`, carrying one account id.

## Limitations

- **Per-player combat stats are unavailable from `deadlock-api`.** See the table
  above. Use the `attached` provider, or HUD capture for KDA, souls, and items.
- **The `attached` provider ships with no offsets** and falls back until they
  are filled in for your game build. It is Linux-only; on Windows it always
  falls back.
- **No item tracking from the `attached` provider.** The inventory walk is not
  implemented, so `items` stays empty rather than being reported as "nothing
  bought". HUD capture remains the way to get items.
- **Pause detection is provider-dependent.** `deadlock-api` never reports it,
  so `paused` is `null` there; the `attached` provider reads `m_bMatchPaused`
  when that offset is configured. Souls/minute is only pause-corrected once a
  provider supplies `paused_s`, which neither does yet.
- **Only public matches resolve** through `deadlock-api`. Private lobbies and
  matches not published to the Watch tab return `404` from `/v1/roster`.
- **No tray icon.** On Windows the companion runs as a background process
  started from the Run key; stop it via Task Manager. On Linux use
  `systemctl --user stop counterlock-companion`.
- **The installer is unsigned** unless you supply an Authenticode certificate;
  the workflow signs only when `WINDOWS_CERT_BASE64` is configured. Unsigned
  installers trigger a SmartScreen warning.
- **Cross-compiling to Windows from Linux is not set up.** The workflow builds
  the Windows binary on a Windows runner with the MSVC target.

## Development

```bash
cargo test  --manifest-path companion/Cargo.toml
cargo clippy --manifest-path companion/Cargo.toml --all-targets -- -D warnings
```

Module map:

| File | Role |
| --- | --- |
| `src/state.rs` | Snapshot model, phase, souls/minute |
| `src/config.rs` | Config file, env overrides, CORS allow-list |
| `src/steam.rs` | `loginusers.vdf` parsing, SteamID conversion |
| `src/platform/` | Process detection and capture backends per OS |
| `src/provider/` | Telemetry providers behind one trait |
| `src/server.rs` | HTTP routes, CORS, rebinding guard |
| `src/capture.rs` | Screenshot backends |
| `src/assets.rs` | The embedded UI |
