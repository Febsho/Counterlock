//! On-demand HUD capture.
//!
//! Captures stay on the machine: the PNG is written to a temporary file, handed
//! to the local UI over loopback, and deleted. Nothing is uploaded unless
//! `allow_uploads` is enabled, and this module never uploads regardless.

use anyhow::{anyhow, bail, Result};
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn temp_path() -> PathBuf {
    let mut dir = std::env::temp_dir();
    // A fixed name keeps exactly one capture on disk at a time.
    dir.push("counterlock-hud-capture.png");
    dir
}

/// Platform-appropriate guidance for enabling screen capture.
pub fn permission_hint() -> &'static str {
    #[cfg(windows)]
    {
        crate::platform::windows::capture_permission_hint()
    }
    #[cfg(unix)]
    {
        crate::platform::linux::capture_permission_hint()
    }
}

/// Whether any capture backend is present.
pub fn is_available() -> bool {
    #[cfg(windows)]
    {
        true
    }
    #[cfg(unix)]
    {
        crate::platform::linux::capture_commands("/tmp/probe.png")
            .into_iter()
            .any(|(binary, _)| binary_exists(binary))
    }
}

#[cfg(unix)]
fn binary_exists(binary: &str) -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| dir.join(binary).is_file())
}

/// Captures the screen and returns the PNG bytes.
///
/// The temporary file is removed before returning, on success and on failure.
pub fn capture_png() -> Result<Vec<u8>> {
    let output = temp_path();
    let output_str = output
        .to_str()
        .ok_or_else(|| anyhow!("temporary path is not valid UTF-8"))?
        .to_string();
    let _ = std::fs::remove_file(&output);

    let result = run_capture(&output_str);
    let bytes = match result {
        Ok(()) => std::fs::read(&output).map_err(|e| anyhow!("reading the capture failed: {e}")),
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_file(&output);

    let bytes = bytes?;
    if bytes.is_empty() {
        bail!(
            "the capture backend produced an empty image. {}",
            permission_hint()
        );
    }
    Ok(bytes)
}

#[cfg(unix)]
fn run_capture(output: &str) -> Result<()> {
    let commands = crate::platform::linux::capture_commands(output);
    let mut attempted = Vec::new();
    for (binary, args) in commands {
        if !binary_exists(binary) {
            continue;
        }
        attempted.push(binary);
        let status = Command::new(binary)
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        match status {
            Ok(status) if status.success() => return Ok(()),
            Ok(status) => {
                tracing::warn!(backend = binary, code = ?status.code(), "capture backend failed");
            }
            Err(error) => {
                tracing::warn!(backend = binary, %error, "capture backend could not be started");
            }
        }
    }
    if attempted.is_empty() {
        bail!(
            "no screen-capture backend is installed. {}",
            permission_hint()
        );
    }
    bail!(
        "every capture backend failed ({}). {}",
        attempted.join(", "),
        permission_hint()
    )
}

#[cfg(windows)]
fn run_capture(output: &str) -> Result<()> {
    let (binary, args) = crate::platform::windows::capture_command(output);
    let status = Command::new(binary)
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|e| anyhow!("starting the capture backend failed: {e}"))?;
    if !status.success() {
        bail!("the capture backend failed. {}", permission_hint());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn temp_path_is_a_png_in_the_temp_directory() {
        let path = temp_path();
        assert_eq!(path.extension().and_then(|e| e.to_str()), Some("png"));
        assert!(path.starts_with(std::env::temp_dir()));
    }

    #[test]
    fn permission_hint_is_actionable() {
        assert!(permission_hint().len() > 20);
    }

    #[test]
    fn availability_check_does_not_panic() {
        let _ = is_available();
    }
}
