//! Windows platform adapter.
//!
//! Uses `sysinfo` (Toolhelp32 under the hood) to enumerate process names. Only
//! names are read, never another process's memory, so the companion runs as a
//! normal user with no administrator rights and no elevated handles.

use super::{is_deadlock_process, ProcessDetector};
use sysinfo::{ProcessRefreshKind, RefreshKind, System};

pub struct WindowsProcessDetector {
    system: System,
}

impl Default for WindowsProcessDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowsProcessDetector {
    pub fn new() -> Self {
        Self {
            system: System::new_with_specifics(
                RefreshKind::new().with_processes(ProcessRefreshKind::new()),
            ),
        }
    }
}

impl ProcessDetector for WindowsProcessDetector {
    fn is_game_running(&mut self) -> bool {
        self.system
            .refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.system
            .processes()
            .values()
            .any(|process| is_deadlock_process(&process.name().to_string_lossy()))
    }
    fn game_pid(&mut self) -> Option<u32> {
        self.system
            .refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.system
            .processes()
            .iter()
            .find(|(_, process)| is_deadlock_process(&process.name().to_string_lossy()))
            .map(|(pid, _)| pid.as_u32())
    }
}

/// PowerShell one-liner used for full-screen capture.
///
/// Runs in the user's own session with no elevation; `-WindowStyle Hidden`
/// keeps a console window from flashing over the game.
pub fn capture_command(output: &str) -> (&'static str, Vec<String>) {
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
         $b = [System.Windows.Forms.SystemInformation]::VirtualScreen; \
         $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height; \
         $g = [System.Drawing.Graphics]::FromImage($bmp); \
         $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size); \
         $bmp.Save('{output}', [System.Drawing.Imaging.ImageFormat]::Png); \
         $g.Dispose(); $bmp.Dispose()"
    );
    (
        "powershell",
        vec![
            "-NoProfile".into(),
            "-NonInteractive".into(),
            "-WindowStyle".into(),
            "Hidden".into(),
            "-Command".into(),
            script,
        ],
    )
}

pub fn capture_permission_hint() -> &'static str {
    "Screen capture uses the built-in .NET graphics APIs and needs no extra permissions. \
     If the capture is black, the game is likely in exclusive full-screen mode - \
     switch Deadlock to borderless windowed."
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_command_embeds_the_output_path_and_stays_hidden() {
        let (binary, args) = capture_command("C:\\Temp\\shot.png");
        assert_eq!(binary, "powershell");
        assert!(args.iter().any(|a| a.contains("C:\\Temp\\shot.png")));
        assert!(args.iter().any(|a| a == "Hidden"));
    }
}
