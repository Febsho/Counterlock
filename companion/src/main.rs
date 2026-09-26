//! Counterlock companion.
//!
//! Serves the bundled Counterlock UI and a localhost-only match-data API.
//! It reads the local Steam account id from Steam's own config, watches for the
//! Deadlock process, and polls a telemetry provider while a match is live.

mod assets;
mod capture;
mod config;
mod game;
mod logging;
mod platform;
mod provider;
mod server;
mod state;
mod steam;

use anyhow::Result;
use config::{Config, ProviderKind};
use platform::{GameLifecycle, LifecycleEvent};
use provider::{
    attached::AttachedProvider, deadlock_api::DeadlockApiProvider, MatchDataProvider, NullProvider,
};
use server::{AppState, SharedState};
use state::unix_now;
use std::sync::{Arc, RwLock};
use std::time::Duration;

fn main() -> Result<()> {
    let config = Config::load()?;
    logging::init(config.json_logs);

    if let Some(path) = Config::default_path() {
        tracing::info!(config = %path.display(), exists = path.exists(), "configuration");
    }
    if !assets::is_bundled() {
        tracing::warn!(
            "no UI was bundled into this binary; run `npm run build:companion-ui` and rebuild"
        );
    }

    let account_id = resolve_account_id(&config);
    match account_id {
        Some(id) => tracing::info!(account_id = id, "resolved the local Steam account"),
        None => tracing::warn!(
            "no Steam account could be resolved; set account_id in the config or \
             COUNTERLOCK_ACCOUNT_ID. Match data will be unavailable until then."
        ),
    }

    let provider: Box<dyn MatchDataProvider> = match config.provider {
        ProviderKind::Attached => Box::new(AttachedProvider::new(config.clone())),
        ProviderKind::DeadlockApi => {
            Box::new(DeadlockApiProvider::new(config.deadlock_api_base.clone()))
        }
        ProviderKind::None => Box::new(NullProvider),
    };
    tracing::info!(
        provider = provider.id(),
        unavailable = ?provider.capabilities().unavailable_fields(),
        "telemetry provider selected"
    );
    if !config.allow_uploads {
        tracing::info!("uploads are disabled; no match data or screenshots leave this machine");
    }

    let shared: SharedState = Arc::new(RwLock::new(AppState {
        account_id,
        provider_id: provider.id().to_string(),
        capabilities: provider.capabilities(),
        ..Default::default()
    }));

    {
        let shared = Arc::clone(&shared);
        let config = config.clone();
        std::thread::Builder::new()
            .name("poll".into())
            .spawn(move || poll_loop(config, provider, shared))?;
    }

    server::run(config, shared)
}

/// Config override first, then the local Steam install.
fn resolve_account_id(config: &Config) -> Option<u32> {
    if let Some(id) = config.account_id {
        return Some(id);
    }
    match steam::detect_account() {
        Ok(Some(account)) => {
            tracing::info!(persona = ?account.persona_name, "found a local Steam account");
            Some(account.account_id)
        }
        Ok(None) => None,
        Err(error) => {
            tracing::warn!(%error, "reading the Steam account failed");
            None
        }
    }
}

/// Watches the game process and refreshes the snapshot.
///
/// The cadence is deliberately asymmetric: 1-2s while a match is live, and a
/// much slower idle poll otherwise so an idle companion is close to free.
fn poll_loop(config: Config, provider: Box<dyn MatchDataProvider>, shared: SharedState) {
    let mut lifecycle = GameLifecycle::new(platform::detector());
    let mut current_match: Option<u64> = None;

    loop {
        match lifecycle.poll() {
            LifecycleEvent::Launched => tracing::info!("Deadlock started"),
            LifecycleEvent::Exited => {
                tracing::info!("Deadlock exited");
                current_match = None;
                let mut state = shared.write().unwrap();
                state.snapshot = None;
                state.joined_at = None;
            }
            LifecycleEvent::Unchanged => {}
        }
        let running = lifecycle.state().running;
        shared.write().unwrap().game_running = running;

        // Only reach out to the provider while the game is actually running.
        let in_match = if running {
            refresh(provider.as_ref(), &shared, &mut current_match)
        } else {
            false
        };

        let interval = if in_match {
            config.in_match_poll_ms
        } else {
            config.idle_poll_ms
        };
        std::thread::sleep(Duration::from_millis(interval));
    }
}

/// Fetches one snapshot. Returns whether a match is currently live.
fn refresh(
    provider: &dyn MatchDataProvider,
    shared: &SharedState,
    current_match: &mut Option<u64>,
) -> bool {
    let account_id = shared.read().unwrap().account_id;
    let result = provider.fetch(account_id);
    // Re-read after fetching: a provider that falls back between sources
    // reports different capabilities depending on which one answered, and
    // `/v1/capabilities` must describe the source behind the last snapshot.
    shared.write().unwrap().capabilities = provider.capabilities();
    match result {
        Ok(Some(snapshot)) => {
            if *current_match != snapshot.match_id {
                tracing::info!(match_id = ?snapshot.match_id, players = snapshot.players.len(), "match started");
                *current_match = snapshot.match_id;
                shared.write().unwrap().joined_at = Some(unix_now());
            }
            let mut state = shared.write().unwrap();
            state.snapshot = Some(snapshot);
            state.last_error = None;
            true
        }
        Ok(None) => {
            if current_match.is_some() {
                tracing::info!("match ended");
                *current_match = None;
            }
            let mut state = shared.write().unwrap();
            state.snapshot = None;
            state.joined_at = None;
            state.last_error = None;
            false
        }
        Err(error) => {
            // Keep the last good snapshot: a transient network blip should not
            // make the UI think the match ended.
            tracing::warn!(%error, "provider fetch failed");
            let mut state = shared.write().unwrap();
            state.last_error = Some(error.to_string());
            state.snapshot.is_some()
        }
    }
}
