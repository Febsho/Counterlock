#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod advisor;
#[path = "../../companion/src/capture.rs"]
mod capture;
#[path = "../../companion/src/config.rs"]
mod config;
#[path = "game/console.rs"]
mod console_local;
#[path = "../../companion/src/game/mod.rs"]
mod game;
#[path = "game/hud.rs"]
mod hud_local;
#[path = "game/install.rs"]
mod install_local;
#[path = "../../companion/src/logging.rs"]
mod logging;
mod memory_profile;
mod statlocker;
#[path = "../../companion/src/platform/mod.rs"]
mod platform;
#[path = "../../companion/src/provider/mod.rs"]
mod provider;
#[path = "../../companion/src/state.rs"]
mod state;
#[path = "../../companion/src/steam.rs"]
mod steam;
mod storage;

use config::{Config, ProviderKind};
use provider::{attached::AttachedProvider, Capabilities, MatchDataProvider};
use serde::Serialize;
use state::MatchSnapshot;
use std::sync::{mpsc, Arc, RwLock};
use std::time::{Duration, Instant};
use storage::{Preferences, Storage, WindowGeometry};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[derive(Clone, Default, Serialize, PartialEq)]
struct DesktopStatus {
    in_game: bool,
    account_id: Option<u32>,
    match_id: Option<u64>,
    game_running: bool,
    pid: Option<u32>,
    steam_running: bool,
    installation_path: Option<std::path::PathBuf>,
    build_id: Option<String>,
    console_phase: Option<String>,
    lobby_id: Option<u64>,
    provider: String,
    capabilities: Capabilities,
    last_error: Option<String>,
}

#[derive(Default)]
struct DesktopState {
    status: DesktopStatus,
    snapshot: Option<MatchSnapshot>,
    console: console_local::ConsoleState,
    evidence: Option<advisor::EvidenceSet>,
    advice: Option<advisor::AdviceSet>,
    local_roster: Option<console_local::LocalRoster>,
}

type Shared = Arc<RwLock<DesktopState>>;

#[tauri::command]
fn desktop_status(state: tauri::State<'_, Shared>) -> DesktopStatus {
    state.read().unwrap().status.clone()
}

#[tauri::command]
fn match_snapshot(state: tauri::State<'_, Shared>) -> Option<MatchSnapshot> {
    state.read().unwrap().snapshot.clone()
}

#[tauri::command]
fn last_match(storage: tauri::State<'_, Storage>) -> Result<Option<MatchSnapshot>, String> {
    storage.last_match().map_err(|e| e.to_string())
}

#[tauri::command]
fn recommendations(state: tauri::State<'_, Shared>) -> Option<advisor::AdviceSet> {
    state.read().unwrap().advice.clone()
}

#[tauri::command]
fn set_advisor_evidence(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    evidence: advisor::EvidenceSet,
) {
    state.write().unwrap().evidence = Some(evidence);
    update_advice(&app, state.inner());
}

#[tauri::command]
fn submit_local_roster(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    mut roster: console_local::LocalRoster,
) -> Result<(), String> {
    if !roster.valid() {
        return Err(
            "the confirmed scoreboard must contain your hero and at least one distinct enemy hero"
                .into(),
        );
    }
    let mut current = state.write().unwrap();
    if !current.status.game_running || !current.status.in_game {
        return Err(
            "no local live match has been detected yet; enable -condebug and restart Deadlock"
                .into(),
        );
    }
    roster.pid = current.status.pid;
    roster.match_id = current.status.match_id;
    let base = current
        .snapshot
        .clone()
        .or_else(|| console_local::snapshot(&current.console, current.status.account_id))
        .ok_or_else(|| "the current local match is unavailable".to_string())?;
    if base.source == "attached" {
        return Err("the attached provider already supplied a roster".into());
    }
    let next = roster.merge(base);
    current.local_roster = Some(roster);
    current.snapshot = Some(next.clone());
    current.status.provider = next.source.clone();
    current.status.capabilities = console_local::SCOREBOARD_CAPABILITIES;
    let status = current.status.clone();
    drop(current);
    let _ = app.emit("desktop-status", status);
    let _ = app.emit("match-state", Some(next));
    update_advice(&app, state.inner());
    Ok(())
}

fn update_advice(app: &tauri::AppHandle, shared: &Shared) {
    let (computed, previous) = {
        let state = shared.read().unwrap();
        let next = match (&state.snapshot, &state.evidence) {
            (Some(snapshot), Some(evidence)) => {
                advisor::recommend(snapshot, state.status.capabilities, evidence)
            }
            _ => None,
        };
        (next, state.advice.clone())
    };
    let next = advisor::stabilize(previous, computed);
    let mut state = shared.write().unwrap();
    if state.advice != next {
        state.advice = next.clone();
        drop(state);
        let _ = app.emit("recommendations", next);
    }
}

#[tauri::command]
fn desktop_monitors(app: tauri::AppHandle) -> Result<Vec<hud_local::MonitorInfo>, String> {
    hud_local::monitors(&app).map_err(|e| e.to_string())
}

#[tauri::command]
fn hud_capture(app: tauri::AppHandle, monitor_index: Option<usize>) -> Result<Vec<u8>, String> {
    let bytes = capture::capture_png().map_err(|e| e.to_string())?;
    let Some(index) = monitor_index else {
        return Ok(bytes);
    };
    let monitors = hud_local::monitors(&app).map_err(|e| e.to_string())?;
    hud_local::crop_png(&bytes, &monitors, index).map_err(|e| e.to_string())
}

#[tauri::command]
fn desktop_preferences(storage: tauri::State<'_, Storage>) -> Result<Preferences, String> {
    storage.preferences().map_err(|e| e.to_string())
}

#[tauri::command]
fn save_desktop_preferences(
    app: tauri::AppHandle,
    storage: tauri::State<'_, Storage>,
    preferences: Preferences,
) -> Result<(), String> {
    storage
        .save_preferences(&preferences)
        .map_err(|e| e.to_string())?;
    if let Some(window) = app.get_webview_window("compact") {
        window
            .set_always_on_top(preferences.compact_always_on_top)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn save_compact_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("compact") else {
        return;
    };
    let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else {
        return;
    };
    let geometry = WindowGeometry {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    if let Err(error) = app.state::<Storage>().save_geometry("compact", geometry) {
        tracing::warn!(%error, "saving compact window geometry failed");
    }
}

#[tauri::command]
fn toggle_compact(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("compact") {
        if window.is_visible().map_err(|e| e.to_string())? {
            save_compact_geometry(&app);
            window.hide().map_err(|e| e.to_string())?;
        } else {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let preferences = app
        .state::<Storage>()
        .preferences()
        .map_err(|e| e.to_string())?;
    let geometry = app
        .state::<Storage>()
        .geometry("compact")
        .map_err(|e| e.to_string())?;
    let window = WebviewWindowBuilder::new(&app, "compact", WebviewUrl::App("/compact/".into()))
        .title("Counterlock Compact")
        .inner_size(340.0, 250.0)
        .min_inner_size(280.0, 180.0)
        .decorations(false)
        .always_on_top(preferences.compact_always_on_top)
        .resizable(true)
        .build()
        .map_err(|e| e.to_string())?;
    if let Some(geometry) = geometry {
        let _ = window.set_size(tauri::PhysicalSize::new(geometry.width, geometry.height));
        let _ = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y));
    }
    Ok(())
}

fn make_provider(config: &Config) -> Option<Box<dyn MatchDataProvider>> {
    (config.provider != ProviderKind::None).then(|| {
        Box::new(AttachedProvider::new_local_only(config.clone())) as Box<dyn MatchDataProvider>
    })
}

fn same_match_data(left: &Option<MatchSnapshot>, right: &Option<MatchSnapshot>) -> bool {
    match (left, right) {
        (None, None) => true,
        (Some(left), Some(right)) => {
            let mut left = left.clone();
            let mut right = right.clone();
            left.observed_at = 0;
            right.observed_at = 0;
            left == right
        }
        _ => false,
    }
}

fn match_ended(running: bool, in_match: Option<bool>, confirmed_new_match: bool) -> bool {
    !running || in_match == Some(false) || confirmed_new_match
}

fn poll_loop(
    app: tauri::AppHandle,
    config: Config,
    shared: Shared,
    game_menu: MenuItem<tauri::Wry>,
    match_menu: MenuItem<tauri::Wry>,
    wake: mpsc::Receiver<()>,
    statlocker_wake: mpsc::Sender<()>,
) {
    let mut detector = platform::detector();
    let provider = make_provider(&config);
    let mut installation = install_local::detect();
    let mut was_running = false;
    let mut last_install_refresh = Instant::now();
    loop {
        let pid = detector.game_pid();
        let running = pid.is_some();
        if !running && was_running {
            shared.write().unwrap().console = console_local::ConsoleState::default();
        }
        if running != was_running || last_install_refresh.elapsed() >= Duration::from_secs(30) {
            let previous_build = installation.build_id.clone();
            installation = install_local::detect();
            if previous_build != installation.build_id {
                shared.write().unwrap().evidence = None;
                tracing::info!(old = ?previous_build, new = ?installation.build_id, "Deadlock build changed; cached advisor evidence invalidated");
            }
            was_running = running;
            last_install_refresh = Instant::now();
        }
        let account_id = shared.read().unwrap().status.account_id;
        let console = if running {
            shared.read().unwrap().console.clone()
        } else {
            console_local::ConsoleState::default()
        };
        let result = if running {
            provider
                .as_ref()
                .map_or(Ok(None), |provider| provider.fetch(account_id))
        } else {
            Ok(None)
        };
        let (provider_snapshot, mut error) = match result {
            Ok(snapshot) => (snapshot, None),
            Err(error) => {
                let previous = shared.read().unwrap().snapshot.clone();
                (previous, Some(error.to_string()))
            }
        };
        if running && provider_snapshot.is_none() && !config.offsets.usable() {
            error = Some(format!(
                "game memory reader needs offsets for this Deadlock build: {}",
                config.offsets.missing_essentials().join(", ")
            ));
        }
        let mut next_snapshot =
            provider_snapshot.or_else(|| console_local::snapshot(&console, account_id));
        if !running || console.in_match == Some(false) {
            shared.write().unwrap().local_roster = None;
        }
        if next_snapshot
            .as_ref()
            .is_some_and(|snapshot| snapshot.source == "local-console")
        {
            let roster = shared.read().unwrap().local_roster.clone();
            if let Some(roster) = roster {
                let snapshot = next_snapshot.take().unwrap();
                next_snapshot = Some(if roster.applies_to(pid, snapshot.match_id) {
                    roster.merge(snapshot)
                } else {
                    shared.write().unwrap().local_roster = None;
                    snapshot
                });
            }
        }
        let capabilities = if next_snapshot
            .as_ref()
            .is_some_and(|s| s.source == "attached")
        {
            provider
                .as_ref()
                .map_or(console_local::CAPABILITIES, |provider| {
                    provider.capabilities()
                })
        } else if next_snapshot
            .as_ref()
            .is_some_and(|s| s.source == "local-scoreboard")
        {
            console_local::SCOREBOARD_CAPABILITIES
        } else {
            console_local::CAPABILITIES
        };
        let status = DesktopStatus {
            in_game: next_snapshot.is_some() || (running && console.in_match == Some(true)),
            account_id,
            match_id: next_snapshot.as_ref().and_then(|s| s.match_id).or_else(|| {
                if console.in_match == Some(true) {
                    console.match_id
                } else {
                    None
                }
            }),
            game_running: running,
            pid,
            steam_running: installation.steam_running,
            installation_path: installation.path.clone(),
            build_id: installation.build_id.clone(),
            console_phase: console.phase,
            lobby_id: console.lobby_id,
            provider: next_snapshot
                .as_ref()
                .map(|s| s.source.clone())
                .unwrap_or_else(|| "local-console".into()),
            capabilities,
            last_error: error,
        };
        let live = status.in_game;
        let previous_match = shared.read().unwrap().snapshot.clone();
        if let Some(previous) = previous_match {
            let confirmed_new_match = previous
                .match_id
                .zip(next_snapshot.as_ref().and_then(|s| s.match_id))
                .is_some_and(|(old, new)| old != new);
            let match_ended = match_ended(running, console.in_match, confirmed_new_match);
            if next_snapshot.is_none() || confirmed_new_match || match_ended {
                if let Err(error) = app.state::<Storage>().save_match(&previous) {
                    tracing::warn!(%error, "saving completed match failed");
                }
                if match_ended {
                    if let Some(match_id) = previous.match_id {
                        match app
                            .state::<Storage>()
                            .queue_statlocker_match(match_id, previous.account_id)
                        {
                            Ok(()) => {
                                let _ = statlocker_wake.send(());
                            }
                            Err(error) => tracing::warn!(%error, match_id, "queueing Statlocker match notification failed"),
                        }
                    }
                }
            }
        }
        {
            let mut current = shared.write().unwrap();
            if current.status != status {
                current.status = status.clone();
                let _ = game_menu.set_text(if status.game_running {
                    "Deadlock: Running"
                } else {
                    "Deadlock: Not Running"
                });
                let _ = match_menu.set_text(if status.in_game {
                    "Live Match: Active"
                } else {
                    "Live Match: Inactive"
                });
                let _ = app.emit("desktop-status", &status);
            }
            if !same_match_data(&current.snapshot, &next_snapshot) {
                current.snapshot = next_snapshot.clone();
                let _ = app.emit("match-state", &next_snapshot);
            }
        }
        update_advice(&app, &shared);
        let cadence = Duration::from_millis(if live {
            config.in_match_poll_ms
        } else {
            config.idle_poll_ms
        });
        if matches!(
            wake.recv_timeout(cadence),
            Err(mpsc::RecvTimeoutError::Disconnected)
        ) {
            std::thread::sleep(cadence);
        }
        while wake.try_recv().is_ok() {}
    }
}

fn main() {
    // Some Linux compositors reject WebKitGTK's GBM buffers, leaving an
    // otherwise running AppImage with a completely white webview.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_COMPOSITING_MODE").is_none() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(Arc::new(RwLock::new(DesktopState::default())) as Shared)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "compact" {
                    save_compact_geometry(window.app_handle());
                } else if window.label() == "main"
                    && window
                        .app_handle()
                        .state::<Storage>()
                        .preferences()
                        .map(|preferences| preferences.close_to_tray)
                        .unwrap_or(true)
                {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_status,
            match_snapshot,
            last_match,
            recommendations,
            set_advisor_evidence,
            submit_local_roster,
            hud_capture,
            desktop_monitors,
            toggle_compact,
            desktop_preferences,
            save_desktop_preferences
        ])
        .setup(|app| {
            let mut config = Config::load()?;
            memory_profile::apply_for_installed_build(&mut config, &install_local::detect());
            logging::init(config.json_logs);
            let data_dir = app.path().app_data_dir()?;
            app.manage(Storage::open(&data_dir.join("counterlock.sqlite3"))?);
            let account_id = config.account_id.or_else(|| {
                steam::detect_account()
                    .ok()
                    .flatten()
                    .map(|account| account.account_id)
            });
            let shared = app.state::<Shared>();
            shared.write().unwrap().status.account_id = account_id;
            let installation = install_local::detect();
            let (wake_sender, wake_receiver) = mpsc::channel();
            let (statlocker_sender, statlocker_receiver) = mpsc::channel();
            let statlocker_app = app.handle().clone();
            std::thread::Builder::new()
                .name("counterlock-statlocker".into())
                .spawn(move || statlocker::run(statlocker_app, statlocker_receiver))?;
            if let Some(path) = installation.path {
                let log = path.join("game/citadel/console.log");
                let state = shared.inner().clone();
                let wake_sender = wake_sender.clone();
                std::thread::Builder::new()
                    .name("counterlock-console".into())
                    .spawn(move || {
                        if let Err(error) = console_local::watch(log, |console| {
                            let mut current = state.write().unwrap();
                            if current.console != console {
                                if (console.phase.as_deref() == Some("HeroSelection")
                                    && current.console.phase != console.phase)
                                    || console.in_match == Some(false)
                                {
                                    current.local_roster = None;
                                }
                                current.console = console;
                                drop(current);
                                let _ = wake_sender.send(());
                            }
                        }) {
                            tracing::warn!(%error, "console watcher stopped");
                        }
                    })?;
            }
            let open = MenuItem::with_id(app, "open", "Open Counterlock", true, None::<&str>)?;
            let compact =
                MenuItem::with_id(app, "compact", "Open Compact View", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let game_menu = MenuItem::with_id(
                app,
                "game-status",
                "Deadlock: Not Running",
                false,
                None::<&str>,
            )?;
            let match_menu = MenuItem::with_id(
                app,
                "match-status",
                "Live Match: Inactive",
                false,
                None::<&str>,
            )?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[&open, &compact, &game_menu, &match_menu, &settings, &quit],
            )?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "compact" => {
                        let _ = toggle_compact(app.clone());
                    }
                    "settings" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                        let _ = app.emit("open-settings", ());
                    }
                    "quit" => {
                        save_compact_geometry(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;
            let handle = app.handle().clone();
            let shared = shared.inner().clone();
            std::thread::Builder::new()
                .name("counterlock-live".into())
                .spawn(move || {
                    poll_loop(
                        handle,
                        config,
                        shared,
                        game_menu,
                        match_menu,
                        wake_receiver,
                        statlocker_sender,
                    )
                })?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Counterlock desktop failed to start");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_uses_local_memory_reader_without_public_match_fallback() {
        assert_eq!(make_provider(&Config::default()).unwrap().id(), "attached");
        let mut config = Config::default();
        config.provider = ProviderKind::None;
        assert!(make_provider(&config).is_none());
    }

    #[test]
    fn observation_timestamp_does_not_trigger_new_match_event() {
        let first = MatchSnapshot::new("deadlock-api");
        let mut second = first.clone();
        second.observed_at += 1;
        assert!(same_match_data(&Some(first), &Some(second.clone())));
        second.players.push(Default::default());
        assert!(!same_match_data(&None, &Some(second)));
    }

    #[test]
    fn explicit_console_match_end_finalizes_even_while_snapshot_remains_available() {
        let snapshot_still_available = true;
        let ended = match_ended(true, Some(false), false);
        assert!(snapshot_still_available && ended);
    }
}
