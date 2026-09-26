//! Configuration loading.
//!
//! Precedence: built-in defaults < config file < `COUNTERLOCK_*` environment
//! variables. Every field has a working default so a first run needs no file.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::net::Ipv4Addr;
use std::path::{Path, PathBuf};

/// Which telemetry source to poll.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    /// Attached game-state reader, falling back to [`ProviderKind::DeadlockApi`]
    /// whenever the process cannot be read or the offsets do not fit the
    /// running build. The only source that can report per-player combat stats.
    Attached,
    /// Public Deadlock API (`matches/active`). Documented and permitted.
    DeadlockApi,
    /// No telemetry: serve the UI and report process state only.
    None,
}

/// Offsets for the attached reader.
///
/// These move on every game patch, so nothing here ships with a value. Each
/// one is optional: a missing offset disables exactly the field it feeds
/// instead of taking the reader down, and the provider falls back to the public
/// API when the essential ones are absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Offsets {
    pub client: ClientOffsets,
    pub entity: EntityLayout,
    pub player: PlayerOffsets,
    pub pawn: PawnOffsets,
    pub rules: RulesOffsets,
    /// Game-state names indexed by the engine's game-state enum value.
    /// Reorder to match the build you are on.
    pub states: Vec<String>,
}

impl Default for Offsets {
    fn default() -> Self {
        Self {
            client: ClientOffsets::default(),
            entity: EntityLayout::default(),
            player: PlayerOffsets::default(),
            pawn: PawnOffsets::default(),
            rules: RulesOffsets::default(),
            states: [
                "Init",
                "WaitingForPlayersToJoin",
                "HeroSelection",
                "PreGameWait",
                "MatchIntro",
                "GameInProgress",
                "PostGame",
                "GameOver",
            ]
            .iter()
            .map(|state| (*state).to_string())
            .collect(),
        }
    }
}

impl Offsets {
    /// Whether the minimum set needed to report anything is present.
    pub fn usable(&self) -> bool {
        self.client.entity_system.is_some()
            && self.player.steam_id.is_some()
            && self.player.hero_id.is_some()
            && self.player.team.is_some()
    }

    /// Names of the offsets that must be filled in before the reader can run.
    pub fn missing_essentials(&self) -> Vec<&'static str> {
        let mut missing = Vec::new();
        for (present, name) in [
            (self.client.entity_system.is_some(), "client.entity_system"),
            (self.player.steam_id.is_some(), "player.steam_id"),
            (self.player.hero_id.is_some(), "player.hero_id"),
            (self.player.team.is_some(), "player.team"),
        ] {
            if !present {
                missing.push(name);
            }
        }
        missing
    }
}

/// Offsets relative to the `client.dll` module base.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct ClientOffsets {
    /// `CGameEntitySystem*`
    pub entity_system: Option<u64>,
    /// `CCitadelGameRules*`
    pub game_rules: Option<u64>,
    /// `CGlobalVars*`, for the authoritative match clock.
    pub global_vars: Option<u64>,
    /// Highest entity index scanned for player controllers.
    pub max_entities: u32,
}

impl Default for ClientOffsets {
    fn default() -> Self {
        Self {
            entity_system: None,
            game_rules: None,
            global_vars: None,
            // Controllers sit at low entity indices; scanning further just
            // costs reads.
            max_entities: 64,
        }
    }
}

/// Layout of the two-level entity table. Stable across Source 2 builds, so
/// unlike the rest these do ship with working values.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EntityLayout {
    pub chunk_table: u64,
    pub chunk_size: u64,
    pub entry_stride: u64,
}

impl Default for EntityLayout {
    fn default() -> Self {
        Self {
            chunk_table: 0x10,
            chunk_size: 512,
            entry_stride: 120,
        }
    }
}

/// Field offsets inside `CCitadelPlayerController`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PlayerOffsets {
    /// `m_steamID`, also the validity check for "is this a controller".
    pub steam_id: Option<u64>,
    /// `m_nHeroID`
    pub hero_id: Option<u64>,
    /// `m_iTeamNum`
    pub team: Option<u64>,
    /// `m_iGoldNetWorth` — current souls, and the numerator for souls/minute.
    pub net_worth: Option<u64>,
    /// `m_iPlayerKills`
    pub kills: Option<u64>,
    /// `m_iDeaths`
    pub deaths: Option<u64>,
    /// `m_iAssists`
    pub assists: Option<u64>,
    /// `m_hHeroPawn` entity handle on the controller.
    pub hero_pawn: Option<u64>,
}

/// Fields on the locally controlled hero pawn. Only populated by exact-build profiles.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct PawnOffsets {
    /// `m_nCurrencies[0]` (`EGold`), the live unspent shop soul balance.
    pub currencies: Option<u64>,
    pub gold_currency_index: u8,
    /// Embedded `CCitadelAbilityComponent` on the pawn.
    pub ability_component: Option<u64>,
    /// `m_vecAbilities` inside the ability component.
    pub abilities_vector: Option<u64>,
    /// Data pointer within `CNetworkUtlVectorBase<CHandle<...>>`.
    pub abilities_data: Option<u64>,
    /// `m_nSubclassID` on each ability entity.
    pub ability_subclass_id: Option<u64>,
    /// `m_eAbilitySlot` on each ability entity.
    pub ability_slot: Option<u64>,
}

/// Field offsets inside the game-rules object (`cur_time` is in `CGlobalVars`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct RulesOffsets {
    /// `m_eGameState`
    pub game_state: Option<u64>,
    /// `m_flGameStartTime`
    pub game_start_time: Option<u64>,
    /// `m_unMatchID`
    pub match_id: Option<u64>,
    /// `m_bMatchPaused`
    pub paused: Option<u64>,
    /// `CGlobalVars::curtime`
    pub cur_time: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Loopback port. The companion never binds a non-loopback address.
    pub port: u16,
    /// Browser origins allowed to call the API. Loopback origins on `port` are
    /// always allowed; add entries here for a dev server on another port.
    pub allowed_origins: Vec<String>,
    pub provider: ProviderKind,
    /// Legacy desktop setting retained for existing config files. The desktop
    /// now selects its local memory reader automatically when telemetry is on.
    pub desktop_experimental_attached: bool,
    /// Poll cadence while a match is live, in milliseconds. Clamped to 1000-2000
    /// so we stay inside the documented 1-2s push window.
    pub in_match_poll_ms: u64,
    /// Poll cadence while idle. Much slower: nothing is changing.
    pub idle_poll_ms: u64,
    /// Override the locally detected Steam account id.
    pub account_id: Option<u32>,
    /// Enable on-demand HUD screenshots via `/v1/hud-capture`.
    pub enable_hud_capture: bool,
    /// Opt-in for sending anything off the machine. Off by default; nothing in
    /// this binary uploads raw data or screenshots while it is false.
    pub allow_uploads: bool,
    /// Emit newline-delimited JSON logs instead of human-readable ones.
    pub json_logs: bool,
    /// Base URL of the Deadlock API.
    pub deadlock_api_base: String,
    /// Module the attached reader resolves its offsets against.
    pub client_module: String,
    /// Offsets for the attached reader. Empty by default; see the example
    /// config for what each one is.
    pub offsets: Offsets,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            port: 9876,
            allowed_origins: Vec::new(),
            provider: ProviderKind::DeadlockApi,
            desktop_experimental_attached: false,
            in_match_poll_ms: 1500,
            idle_poll_ms: 8000,
            account_id: None,
            enable_hud_capture: true,
            allow_uploads: false,
            json_logs: false,
            deadlock_api_base: "https://api.deadlock-api.com/v1".to_string(),
            client_module: "client.dll".to_string(),
            offsets: Offsets::default(),
        }
    }
}

impl Config {
    /// Loads defaults, overlays the config file if present, then the environment.
    pub fn load() -> Result<Self> {
        let path = Self::default_path();
        let mut config = match path.as_ref().filter(|p| p.exists()) {
            Some(path) => Self::from_file(path)?,
            None => Self::default(),
        };
        config.apply_env()?;
        config.validate()?;
        Ok(config)
    }

    pub fn from_file(path: &Path) -> Result<Self> {
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("reading config file {}", path.display()))?;
        toml::from_str(&raw).with_context(|| format!("parsing config file {}", path.display()))
    }

    /// `$XDG_CONFIG_HOME/counterlock/companion.toml` on Linux,
    /// `%APPDATA%\counterlock\companion.toml` on Windows.
    pub fn default_path() -> Option<PathBuf> {
        let dir = if cfg!(windows) {
            std::env::var_os("APPDATA").map(PathBuf::from)
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))
        };
        dir.map(|d| d.join("counterlock").join("companion.toml"))
    }

    fn apply_env(&mut self) -> Result<()> {
        if let Some(port) = env_parse::<u16>("COUNTERLOCK_PORT")? {
            self.port = port;
        }
        // Accepts a bare account id, a SteamID64, or a numeric profile URL.
        if let Ok(raw) = std::env::var("COUNTERLOCK_ACCOUNT_ID") {
            match crate::steam::account_id_from_input(&raw) {
                Some(id) => self.account_id = Some(id),
                None => bail!("COUNTERLOCK_ACCOUNT_ID: {raw:?} is not an account id, SteamID64, or numeric profile URL"),
            }
        }
        if let Some(ms) = env_parse::<u64>("COUNTERLOCK_IN_MATCH_POLL_MS")? {
            self.in_match_poll_ms = ms;
        }
        if let Some(flag) = env_bool("COUNTERLOCK_ALLOW_UPLOADS")? {
            self.allow_uploads = flag;
        }
        if let Some(flag) = env_bool("COUNTERLOCK_ENABLE_HUD_CAPTURE")? {
            self.enable_hud_capture = flag;
        }
        if let Some(flag) = env_bool("COUNTERLOCK_JSON_LOGS")? {
            self.json_logs = flag;
        }
        if let Ok(origins) = std::env::var("COUNTERLOCK_ALLOWED_ORIGINS") {
            self.allowed_origins = origins
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string)
                .collect();
        }
        Ok(())
    }

    fn validate(&mut self) -> Result<()> {
        if self.port == 0 {
            bail!("port must not be 0");
        }
        // Keep the live cadence inside the 1-2s contract the UI expects.
        self.in_match_poll_ms = self.in_match_poll_ms.clamp(1000, 2000);
        self.idle_poll_ms = self.idle_poll_ms.max(2000);
        Ok(())
    }

    /// Always loopback. Exposing match telemetry on a routable interface is not
    /// a supported configuration, so the bind address is not user-settable.
    pub fn bind_addr(&self) -> (Ipv4Addr, u16) {
        (Ipv4Addr::LOCALHOST, self.port)
    }

    /// Whether `origin` may call the API.
    ///
    /// Loopback origins on our own port are implicitly allowed so the bundled UI
    /// works with no configuration; anything else must be listed explicitly.
    pub fn origin_allowed(&self, origin: &str) -> bool {
        let implicit = [
            format!("http://127.0.0.1:{}", self.port),
            format!("http://localhost:{}", self.port),
        ];
        implicit.iter().any(|o| o == origin) || self.allowed_origins.iter().any(|o| o == origin)
    }
}

fn env_parse<T: std::str::FromStr>(key: &str) -> Result<Option<T>>
where
    T::Err: std::fmt::Display,
{
    match std::env::var(key) {
        Ok(raw) => raw
            .trim()
            .parse::<T>()
            .map(Some)
            .map_err(|e| anyhow::anyhow!("{key}: {e}")),
        Err(_) => Ok(None),
    }
}

fn env_bool(key: &str) -> Result<Option<bool>> {
    match std::env::var(key) {
        Ok(raw) => match raw.trim().to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(Some(true)),
            "0" | "false" | "no" | "off" => Ok(Some(false)),
            other => bail!("{key}: expected a boolean, got {other:?}"),
        },
        Err(_) => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_private_and_loopback() {
        let config = Config::default();
        assert!(!config.allow_uploads, "uploads must be opt-in");
        assert_eq!(config.bind_addr().0, Ipv4Addr::LOCALHOST);
    }

    #[test]
    fn own_loopback_origins_are_allowed_without_configuration() {
        let config = Config::default();
        assert!(config.origin_allowed("http://127.0.0.1:9876"));
        assert!(config.origin_allowed("http://localhost:9876"));
    }

    #[test]
    fn foreign_origins_are_rejected() {
        let config = Config::default();
        assert!(!config.origin_allowed("https://evil.example"));
        // A different local port is still a different origin.
        assert!(!config.origin_allowed("http://127.0.0.1:3000"));
        // Substring games must not pass.
        assert!(!config.origin_allowed("http://127.0.0.1:9876.evil.example"));
    }

    #[test]
    fn extra_origins_can_be_allow_listed() {
        let config = Config {
            allowed_origins: vec!["http://localhost:3000".into()],
            ..Default::default()
        };
        assert!(config.origin_allowed("http://localhost:3000"));
    }

    #[test]
    fn validate_clamps_the_live_poll_cadence() {
        let mut config = Config {
            in_match_poll_ms: 50,
            ..Default::default()
        };
        config.validate().unwrap();
        assert_eq!(config.in_match_poll_ms, 1000);

        let mut config = Config {
            in_match_poll_ms: 60_000,
            ..Default::default()
        };
        config.validate().unwrap();
        assert_eq!(config.in_match_poll_ms, 2000);
    }

    #[test]
    fn config_file_round_trips() {
        let config = Config::default();
        let text = toml::to_string(&config).unwrap();
        let parsed: Config = toml::from_str(&text).unwrap();
        assert_eq!(parsed.port, config.port);
        assert_eq!(parsed.provider, config.provider);
    }
}
