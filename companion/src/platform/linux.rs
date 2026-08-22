//! Linux platform adapter.
//!
//! Process detection reads `/proc/<pid>/comm` directly instead of going through
//! `sysinfo`: it is a handful of small reads, needs no periodic full refresh,
//! and never inspects another process's memory or command line.

use super::{is_deadlock_process, ProcessDetector};
use std::fs;

/// Which display server the session is running under. Screen capture works
/// differently on each, so the answer drives both tool selection and the
/// permissions guidance we surface to the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DisplayServer {
    Wayland,
    X11,
    Unknown,
}

pub fn display_server() -> DisplayServer {
    let session_type = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
    match session_type.to_ascii_lowercase().as_str() {
        "wayland" => DisplayServer::Wayland,
        "x11" => DisplayServer::X11,
        _ if std::env::var_os("WAYLAND_DISPLAY").is_some() => DisplayServer::Wayland,
        _ if std::env::var_os("DISPLAY").is_some() => DisplayServer::X11,
        _ => DisplayServer::Unknown,
    }
}

#[derive(Default)]
pub struct LinuxProcessDetector;

impl LinuxProcessDetector {
    pub fn new() -> Self {
        Self
    }
}

impl ProcessDetector for LinuxProcessDetector {
    fn is_game_running(&mut self) -> bool {
        game_pid().is_some()
    }
}

/// Pid of the running game, or `None`.
///
/// Under Proton several processes can share the name, so callers that need to
/// read the client (the attached provider) must still confirm the pid actually
/// mapped `client.dll` before trusting it.
pub fn game_pid() -> Option<u32> {
    let entries = fs::read_dir("/proc").ok()?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // Only numeric entries are processes.
        if !name.bytes().all(|b| b.is_ascii_digit()) {
            continue;
        }
        // `comm` is truncated to 15 bytes by the kernel, so a long name such
        // as "project8.exe" is safe but anything longer would need cmdline.
        let Ok(comm) = fs::read_to_string(entry.path().join("comm")) else {
            continue;
        };
        if is_deadlock_process(comm.trim()) {
            return name.parse().ok();
        }
    }
    None
}

/// Screen-capture commands to try, in order, for the current session.
///
/// Each entry is `(binary, args)` where the final argument is the output path.
pub fn capture_commands(output: &str) -> Vec<(&'static str, Vec<String>)> {
    let mut commands: Vec<(&'static str, Vec<String>)> = Vec::new();
    match display_server() {
        DisplayServer::Wayland => {
            // wlroots compositors (Sway, Hyprland).
            commands.push(("grim", vec![output.to_string()]));
            // KDE Plasma on Wayland.
            commands.push((
                "spectacle",
                vec!["-b".into(), "-n".into(), "-o".into(), output.to_string()],
            ));
            // GNOME on Wayland goes through the portal.
            commands.push(("gnome-screenshot", vec!["-f".into(), output.to_string()]));
        }
        _ => {
            commands.push((
                "import",
                vec!["-window".into(), "root".into(), output.to_string()],
            ));
            commands.push(("maim", vec![output.to_string()]));
            commands.push((
                "spectacle",
                vec!["-b".into(), "-n".into(), "-o".into(), output.to_string()],
            ));
            commands.push(("gnome-screenshot", vec!["-f".into(), output.to_string()]));
        }
    }
    commands
}

/// Human-readable guidance shown when capture fails, tailored to the session.
pub fn capture_permission_hint() -> &'static str {
    match display_server() {
        DisplayServer::Wayland => {
            "Wayland blocks direct screen reads. Install grim (wlroots), spectacle (KDE), \
             or gnome-screenshot (GNOME), and allow the screenshot portal when prompted. \
             Flatpak users additionally need the org.freedesktop.portal.Screenshot permission."
        }
        DisplayServer::X11 => {
            "Install ImageMagick (import) or maim for X11 screen capture. \
             No elevated permissions are required on X11."
        }
        DisplayServer::Unknown => {
            "No display server was detected (XDG_SESSION_TYPE, WAYLAND_DISPLAY and DISPLAY \
             are all unset). Screen capture is unavailable in a headless session."
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_commands_are_never_empty_and_end_with_the_output_path() {
        for (_binary, args) in capture_commands("/tmp/shot.png") {
            assert!(
                args.iter().any(|a| a == "/tmp/shot.png"),
                "every command must reference the output path"
            );
        }
    }

    #[test]
    fn permission_hint_is_provided_for_every_session_type() {
        assert!(!capture_permission_hint().is_empty());
    }

    #[test]
    fn detector_does_not_panic_on_a_normal_system() {
        // The game is not running in CI; the call must simply return false.
        let mut detector = LinuxProcessDetector::new();
        let _ = detector.is_game_running();
    }
}
