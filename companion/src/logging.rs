//! Structured logging setup.
//!
//! Defaults to `info`; override with `RUST_LOG` (e.g. `RUST_LOG=debug`).
//! `json_logs = true` emits newline-delimited JSON for log shippers.

use tracing_subscriber::EnvFilter;

pub fn init(json: bool) {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("counterlock_companion=info,warn"));

    let builder = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true);

    if json {
        builder.json().flatten_event(true).init();
    } else {
        builder
            .with_ansi(std::io::IsTerminal::is_terminal(&std::io::stderr()))
            .init();
    }
}
