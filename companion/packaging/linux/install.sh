#!/usr/bin/env bash
# Installs the companion binary and its systemd user service.
# No root required: everything lands under $HOME.
set -euo pipefail

BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/counterlock"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BINARY="${1:-$SCRIPT_DIR/../../target/release/counterlock-companion}"

if [[ ! -x "$BINARY" ]]; then
  echo "error: no binary at $BINARY" >&2
  echo "build it first:  npm run build:companion" >&2
  exit 1
fi

mkdir -p "$BIN_DIR" "$UNIT_DIR" "$CONFIG_DIR"
install -m 0755 "$BINARY" "$BIN_DIR/counterlock-companion"
install -m 0644 "$SCRIPT_DIR/counterlock-companion.service" "$UNIT_DIR/counterlock-companion.service"

if [[ ! -f "$CONFIG_DIR/companion.toml" ]]; then
  install -m 0644 "$SCRIPT_DIR/../../config.example.toml" "$CONFIG_DIR/companion.toml"
  echo "wrote default config to $CONFIG_DIR/companion.toml"
fi

systemctl --user daemon-reload
systemctl --user enable --now counterlock-companion.service

cat <<EOF

Installed.

  binary   $BIN_DIR/counterlock-companion
  service  $UNIT_DIR/counterlock-companion.service
  config   $CONFIG_DIR/companion.toml

  open     http://127.0.0.1:9876
  logs     journalctl --user -u counterlock-companion -f
  stop     systemctl --user stop counterlock-companion

If the service starts before your graphical session, run:
  systemctl --user enable counterlock-companion.service
and log out and back in.
EOF
