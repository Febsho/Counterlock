//! Small local SQLite store for desktop preferences and compact-window geometry.
use crate::state::MatchSnapshot;
use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Preferences {
    pub close_to_tray: bool,
    pub compact_always_on_top: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            close_to_tray: true,
            compact_always_on_top: true,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct WindowGeometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Copy, Debug)]
pub struct PendingStatlockerMatch {
    pub match_id: u64,
    pub account_id: Option<u32>,
    pub attempts: u32,
}

pub struct Storage(Mutex<Connection>);

impl Storage {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection =
            Connection::open(path).with_context(|| format!("opening {}", path.display()))?;
        Self::from_connection(connection)
    }

    fn from_connection(connection: Connection) -> Result<Self> {
        connection.execute_batch("\
            CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);\
            CREATE TABLE IF NOT EXISTS window_state (label TEXT PRIMARY KEY, x INTEGER NOT NULL, y INTEGER NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL);\
            CREATE TABLE IF NOT EXISTS match_history (match_key TEXT PRIMARY KEY, observed_at INTEGER NOT NULL, snapshot_json TEXT NOT NULL);\
            CREATE TABLE IF NOT EXISTS statlocker_outbox (match_id INTEGER PRIMARY KEY, account_id INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0, last_error TEXT);\
        ")?;
        Ok(Self(Mutex::new(connection)))
    }

    pub fn preferences(&self) -> Result<Preferences> {
        let db = self.0.lock().unwrap();
        let raw: Option<String> = db
            .query_row(
                "SELECT value FROM settings WHERE key = 'desktop_preferences'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(Into::into))
            .unwrap_or_else(|| Ok(Preferences::default()))
    }

    pub fn save_preferences(&self, preferences: &Preferences) -> Result<()> {
        let db = self.0.lock().unwrap();
        db.execute("INSERT INTO settings(key, value) VALUES ('desktop_preferences', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [serde_json::to_string(preferences)?])?;
        Ok(())
    }

    pub fn geometry(&self, label: &str) -> Result<Option<WindowGeometry>> {
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT x, y, width, height FROM window_state WHERE label = ?1",
            [label],
            |row| {
                Ok(WindowGeometry {
                    x: row.get(0)?,
                    y: row.get(1)?,
                    width: row.get(2)?,
                    height: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn save_geometry(&self, label: &str, geometry: WindowGeometry) -> Result<()> {
        let db = self.0.lock().unwrap();
        db.execute("INSERT INTO window_state(label, x, y, width, height) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(label) DO UPDATE SET x = excluded.x, y = excluded.y, width = excluded.width, height = excluded.height",
            params![label, geometry.x, geometry.y, geometry.width, geometry.height])?;
        Ok(())
    }

    pub fn save_match(&self, match_state: &MatchSnapshot) -> Result<()> {
        let key = match_state
            .match_id
            .map(|id| format!("match:{id}"))
            .unwrap_or_else(|| format!("observed:{}", match_state.observed_at));
        let db = self.0.lock().unwrap();
        db.execute("INSERT INTO match_history(match_key, observed_at, snapshot_json) VALUES (?1, ?2, ?3) ON CONFLICT(match_key) DO UPDATE SET observed_at = excluded.observed_at, snapshot_json = excluded.snapshot_json",
            params![key, match_state.observed_at, serde_json::to_string(match_state)?])?;
        Ok(())
    }

    pub fn last_match(&self) -> Result<Option<MatchSnapshot>> {
        let db = self.0.lock().unwrap();
        let raw: Option<String> = db
            .query_row(
                "SELECT snapshot_json FROM match_history ORDER BY observed_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()?;
        raw.map(|raw| serde_json::from_str(&raw).map_err(Into::into))
            .transpose()
    }

    pub fn queue_statlocker_match(&self, match_id: u64, account_id: Option<u32>) -> Result<()> {
        let db = self.0.lock().unwrap();
        db.execute(
            "INSERT OR IGNORE INTO statlocker_outbox(match_id, account_id) VALUES (?1, ?2)",
            params![match_id, account_id],
        )?;
        Ok(())
    }

    pub fn next_statlocker_match(&self, now: i64) -> Result<Option<PendingStatlockerMatch>> {
        let db = self.0.lock().unwrap();
        db.query_row(
            "SELECT match_id, account_id, attempts FROM statlocker_outbox WHERE next_attempt_at <= ?1 ORDER BY match_id LIMIT 1",
            [now],
            |row| {
                let id: i64 = row.get(0)?;
                Ok(PendingStatlockerMatch {
                    match_id: id as u64,
                    account_id: row.get::<_, Option<u32>>(1)?,
                    attempts: row.get::<_, u32>(2)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn complete_statlocker_match(&self, match_id: u64) -> Result<()> {
        let db = self.0.lock().unwrap();
        db.execute("DELETE FROM statlocker_outbox WHERE match_id = ?1", [match_id])?;
        Ok(())
    }

    pub fn retry_statlocker_match(&self, match_id: u64, now: i64, error: &str) -> Result<()> {
        let db = self.0.lock().unwrap();
        db.execute(
            "UPDATE statlocker_outbox SET attempts = attempts + 1, next_attempt_at = ?2, last_error = ?3 WHERE match_id = ?1",
            params![match_id, now, error],
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn preferences_and_window_geometry_round_trip() {
        let store = Storage::from_connection(Connection::open_in_memory().unwrap()).unwrap();
        assert_eq!(store.preferences().unwrap(), Preferences::default());
        let preferences = Preferences {
            close_to_tray: false,
            compact_always_on_top: false,
        };
        store.save_preferences(&preferences).unwrap();
        assert_eq!(store.preferences().unwrap(), preferences);
        let geometry = WindowGeometry {
            x: 10,
            y: 20,
            width: 400,
            height: 200,
        };
        store.save_geometry("compact", geometry).unwrap();
        assert_eq!(store.geometry("compact").unwrap(), Some(geometry));
        let mut match_state = MatchSnapshot::new("test");
        match_state.match_id = Some(12);
        store.save_match(&match_state).unwrap();
        assert_eq!(store.last_match().unwrap().unwrap().match_id, Some(12));
    }
}
