//! Steam installation discovery. The manifest is authoritative for the installed build.
use serde::Serialize;
use std::path::{Path, PathBuf};

const APP_ID: &str = "1422450";

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Installation {
    pub path: Option<PathBuf>,
    pub build_id: Option<String>,
    pub steam_running: bool,
}

pub fn detect() -> Installation {
    let mut system = sysinfo::System::new();
    system.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
    let steam_running = system.processes().values().any(|process| {
        let name = process.name().to_string_lossy().to_ascii_lowercase();
        name == "steam"
            || name == "steam.exe"
            || name == "steamwebhelper"
            || name == "steamwebhelper.exe"
    });
    for root in crate::steam::steam_roots() {
        for library in libraries(&root) {
            let manifest = library
                .join("steamapps")
                .join(format!("appmanifest_{APP_ID}.acf"));
            let Ok(raw) = std::fs::read_to_string(&manifest) else {
                continue;
            };
            let Some(dir) = field(&raw, "installdir") else {
                continue;
            };
            // Steam's manifest is user-writable; never accept path traversal from it.
            if Path::new(&dir).components().count() != 1 {
                continue;
            }
            let path = library.join("steamapps/common").join(dir);
            if !path.join("game/citadel").is_dir() {
                continue;
            }
            return Installation {
                path: Some(path),
                build_id: field(&raw, "buildid"),
                steam_running,
            };
        }
    }
    Installation {
        steam_running,
        ..Default::default()
    }
}

fn libraries(root: &Path) -> Vec<PathBuf> {
    let mut result = vec![root.to_path_buf()];
    let config = root.join("steamapps/libraryfolders.vdf");
    if let Ok(raw) = std::fs::read_to_string(config) {
        for line in raw.lines() {
            if let Some(path) = field(line, "path") {
                let path = PathBuf::from(path.replace("\\\\", "\\"));
                if path.is_dir() && !result.contains(&path) {
                    result.push(path);
                }
            }
        }
    }
    result
}

fn field(input: &str, key: &str) -> Option<String> {
    input.lines().find_map(|line| {
        let parts: Vec<&str> = line.split('"').collect();
        if parts.len() >= 4 && parts[1].trim() == key {
            Some(parts[3].to_owned())
        } else {
            None
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manifest_fields_are_optional() {
        assert_eq!(
            field("\"buildid\" \"123\"\n", "buildid"),
            Some("123".into())
        );
        assert_eq!(field("\"name\" \"Deadlock\"", "buildid"), None);
    }
}
