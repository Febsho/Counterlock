//! Localhost HTTP server.
//!
//! Serves the embedded UI plus the `/v1` API. Three layers of protection keep
//! this from becoming a network service: the socket binds `127.0.0.1` only, the
//! `Host` header must itself be loopback (blocking DNS-rebinding, where a public
//! hostname resolves to 127.0.0.1 and a foreign page reads the API), and CORS
//! is allow-listed rather than `*`.

use crate::assets;
use crate::capture;
use crate::config::Config;
use crate::provider::Capabilities;
use crate::state::{unix_now, MatchSnapshot};
use anyhow::{Context, Result};
use serde::Serialize;
use serde_json::json;
use std::sync::{Arc, RwLock};
use tiny_http::{Header, Request, Response, Server};

/// Everything the HTTP handlers read. The poll loop is the only writer.
#[derive(Debug, Default)]
pub struct AppState {
    pub account_id: Option<u32>,
    pub game_running: bool,
    /// When the current match was first observed.
    pub joined_at: Option<i64>,
    pub snapshot: Option<MatchSnapshot>,
    pub capabilities: Capabilities,
    pub provider_id: String,
    /// Last provider error, surfaced so the UI can explain a stale feed.
    pub last_error: Option<String>,
}

pub type SharedState = Arc<RwLock<AppState>>;

/// Status payload consumed by the web app's companion poller.
#[derive(Debug, Serialize)]
struct StatusPayload {
    in_game: bool,
    account_id: Option<u32>,
    match_id: Option<u64>,
    joined_at: Option<i64>,
    hud_capture_available: bool,
    roster_available: bool,
    game_running: bool,
    provider: String,
    last_error: Option<String>,
    observed_at: i64,
}

pub fn run(config: Config, state: SharedState) -> Result<()> {
    let (host, port) = config.bind_addr();
    let server = Server::http((host, port))
        .map_err(|e| anyhow::anyhow!("binding {host}:{port} failed: {e}"))
        .context("the companion binds loopback only; is another instance running?")?;
    let server = Arc::new(server);
    tracing::info!(%host, port, "companion listening");

    // A small fixed pool: requests are tiny and mostly cache hits.
    let workers = 4;
    let mut handles = Vec::with_capacity(workers);
    for _ in 0..workers {
        let server = Arc::clone(&server);
        let state = Arc::clone(&state);
        let config = config.clone();
        handles.push(std::thread::spawn(move || loop {
            match server.recv() {
                Ok(request) => {
                    if let Err(error) = handle(request, &config, &state) {
                        tracing::warn!(%error, "request handling failed");
                    }
                }
                Err(error) => {
                    tracing::error!(%error, "accept failed");
                    break;
                }
            }
        }));
    }
    for handle in handles {
        let _ = handle.join();
    }
    Ok(())
}

fn header_value<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

/// Rejects a `Host` header that is not loopback.
///
/// Without this, `http://attacker.example` resolving to 127.0.0.1 could reach
/// the API from a browser that considers it a same-origin request.
pub fn host_is_loopback(host: &str, port: u16) -> bool {
    let host = host.trim();
    let name = match host.rsplit_once(':') {
        Some((name, given_port)) => {
            if given_port.parse::<u16>() != Ok(port) {
                return false;
            }
            name
        }
        None => host,
    };
    matches!(
        name.trim_matches(['[', ']']),
        "127.0.0.1" | "localhost" | "::1"
    )
}

fn handle(request: Request, config: &Config, state: &SharedState) -> Result<()> {
    let method = request.method().as_str().to_ascii_uppercase();
    let url = request.url().to_string();
    let path = url.split('?').next().unwrap_or("").to_string();
    let origin = header_value(&request, "Origin").map(str::to_string);
    let host = header_value(&request, "Host")
        .unwrap_or_default()
        .to_string();

    if !host.is_empty() && !host_is_loopback(&host, config.port) {
        tracing::warn!(%host, "rejected a non-loopback Host header");
        return respond(
            request,
            403,
            "text/plain; charset=utf-8",
            b"Forbidden".to_vec(),
            None,
        );
    }

    // A cross-origin request must carry an allow-listed Origin.
    let allowed_origin = match &origin {
        Some(origin) if config.origin_allowed(origin) => Some(origin.clone()),
        Some(origin) => {
            tracing::warn!(%origin, "rejected a disallowed origin");
            return respond(
                request,
                403,
                "application/json; charset=utf-8",
                json!({"error": "origin not allowed"})
                    .to_string()
                    .into_bytes(),
                None,
            );
        }
        // Same-origin and non-browser callers send no Origin at all.
        None => None,
    };

    if method == "OPTIONS" {
        return respond(
            request,
            204,
            "text/plain",
            Vec::new(),
            allowed_origin.as_deref(),
        );
    }
    if method != "GET" && method != "HEAD" {
        return respond(
            request,
            405,
            "application/json; charset=utf-8",
            json!({"error": "method not allowed"})
                .to_string()
                .into_bytes(),
            allowed_origin.as_deref(),
        );
    }

    match path.as_str() {
        "/v1/health" => json_response(
            request,
            200,
            &json!({"ok": true, "version": env!("CARGO_PKG_VERSION")}),
            allowed_origin.as_deref(),
        ),
        "/v1/status" => {
            let payload = {
                let state = state.read().unwrap();
                StatusPayload {
                    in_game: state.snapshot.is_some(),
                    account_id: state.account_id,
                    match_id: state.snapshot.as_ref().and_then(|s| s.match_id),
                    joined_at: state.joined_at,
                    hud_capture_available: config.enable_hud_capture && capture::is_available(),
                    roster_available: state
                        .snapshot
                        .as_ref()
                        .is_some_and(|s| !s.players.is_empty()),
                    game_running: state.game_running,
                    provider: state.provider_id.clone(),
                    last_error: state.last_error.clone(),
                    observed_at: unix_now(),
                }
            };
            json_response(request, 200, &payload, allowed_origin.as_deref())
        }
        "/v1/roster" | "/v1/match" => {
            let snapshot = state.read().unwrap().snapshot.clone();
            match snapshot {
                Some(snapshot) => json_response(request, 200, &snapshot, allowed_origin.as_deref()),
                None => json_response(
                    request,
                    404,
                    &json!({"error": "no live match", "detail": "The player is not in a match this provider can see."}),
                    allowed_origin.as_deref(),
                ),
            }
        }
        "/v1/capabilities" => {
            let (capabilities, provider) = {
                let state = state.read().unwrap();
                (state.capabilities, state.provider_id.clone())
            };
            json_response(
                request,
                200,
                &json!({
                    "provider": provider,
                    "capabilities": capabilities,
                    "unavailable": capabilities.unavailable_fields(),
                    "hud_capture": {
                        "enabled": config.enable_hud_capture,
                        "available": capture::is_available(),
                        "hint": capture::permission_hint(),
                    },
                    "uploads_enabled": config.allow_uploads,
                }),
                allowed_origin.as_deref(),
            )
        }
        "/v1/hud-capture" => {
            if !config.enable_hud_capture {
                return json_response(
                    request,
                    403,
                    &json!({"error": "hud capture disabled", "detail": "Set enable_hud_capture = true in the config."}),
                    allowed_origin.as_deref(),
                );
            }
            match capture::capture_png() {
                Ok(bytes) => respond(request, 200, "image/png", bytes, allowed_origin.as_deref()),
                Err(error) => {
                    tracing::warn!(%error, "hud capture failed");
                    json_response(
                        request,
                        503,
                        &json!({"error": "capture unavailable", "detail": error.to_string()}),
                        allowed_origin.as_deref(),
                    )
                }
            }
        }
        _ => match assets::resolve(&path) {
            Some(asset) => respond(
                request,
                200,
                asset.content_type,
                asset.bytes,
                allowed_origin.as_deref(),
            ),
            None => {
                let asset = assets::not_found();
                respond(
                    request,
                    404,
                    asset.content_type,
                    asset.bytes,
                    allowed_origin.as_deref(),
                )
            }
        },
    }
}

fn json_response<T: Serialize>(
    request: Request,
    status: u16,
    body: &T,
    origin: Option<&str>,
) -> Result<()> {
    let bytes = serde_json::to_vec(body).context("serialising the response")?;
    respond(
        request,
        status,
        "application/json; charset=utf-8",
        bytes,
        origin,
    )
}

fn respond(
    request: Request,
    status: u16,
    content_type: &str,
    body: Vec<u8>,
    origin: Option<&str>,
) -> Result<()> {
    let mut response = Response::from_data(body).with_status_code(status);
    response.add_header(header("Content-Type", content_type));
    // Live match data must never be served from a cache.
    response.add_header(header("Cache-Control", "no-store"));
    response.add_header(header("X-Content-Type-Options", "nosniff"));
    if let Some(origin) = origin {
        response.add_header(header("Access-Control-Allow-Origin", origin));
        response.add_header(header("Vary", "Origin"));
        response.add_header(header("Access-Control-Allow-Methods", "GET, OPTIONS"));
        response.add_header(header("Access-Control-Allow-Headers", "Content-Type"));
    }
    request.respond(response).context("writing the response")
}

fn header(name: &str, value: &str) -> Header {
    // Both sides are ASCII literals or already-validated values.
    Header::from_bytes(name.as_bytes(), value.as_bytes())
        .unwrap_or_else(|_| Header::from_bytes(&b"X-Invalid"[..], &b"1"[..]).unwrap())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_hosts_are_accepted() {
        assert!(host_is_loopback("127.0.0.1:9876", 9876));
        assert!(host_is_loopback("localhost:9876", 9876));
        assert!(host_is_loopback("[::1]:9876", 9876));
        assert!(host_is_loopback("localhost", 9876));
    }

    #[test]
    fn rebinding_hosts_are_rejected() {
        assert!(!host_is_loopback("attacker.example:9876", 9876));
        assert!(!host_is_loopback("counterlock.evil.com", 9876));
        // Right name, wrong port: not our origin.
        assert!(!host_is_loopback("127.0.0.1:80", 9876));
    }

    #[test]
    fn status_payload_uses_the_field_names_the_web_app_reads() {
        let payload = StatusPayload {
            in_game: true,
            account_id: Some(42),
            match_id: Some(7),
            joined_at: Some(1000),
            hud_capture_available: true,
            roster_available: true,
            game_running: true,
            provider: "deadlock-api".into(),
            last_error: None,
            observed_at: 1234,
        };
        let value = serde_json::to_value(&payload).unwrap();
        for key in [
            "in_game",
            "account_id",
            "match_id",
            "joined_at",
            "hud_capture_available",
            "roster_available",
        ] {
            assert!(value.get(key).is_some(), "missing {key}");
        }
    }

    #[test]
    fn roster_payload_matches_the_web_app_contract() {
        let mut snapshot = MatchSnapshot::new("deadlock-api");
        snapshot.match_id = Some(1);
        snapshot.account_id = Some(42);
        snapshot.duration_s = Some(600);
        let value = serde_json::to_value(snapshot.finalize()).unwrap();
        for key in [
            "match_id",
            "account_id",
            "duration_s",
            "match_mode_parsed",
            "players",
        ] {
            assert!(value.get(key).is_some(), "missing {key}");
        }
    }
}
