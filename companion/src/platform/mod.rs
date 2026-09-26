//! Platform adapters.
//!
//! Everything OS-specific lives behind these traits so the core (state,
//! provider, server) stays portable and testable.

use crate::state::unix_now;

#[cfg(unix)]
pub mod linux;
#[cfg(windows)]
pub mod windows;

/// Process names Deadlock is known to run under.
///
/// On Linux the game runs through Proton, so the Windows executable name is the
/// one that shows up in the process list.
pub const DEADLOCK_PROCESS_NAMES: &[&str] =
    &["project8.exe", "project8", "deadlock.exe", "deadlock"];

/// Whether a process name belongs to Deadlock.
///
/// Matching is exact (case-insensitive) rather than substring: a substring test
/// would match unrelated processes such as a `deadlock-counterlock` dev server
/// or this companion's own binary.
pub fn is_deadlock_process(name: &str) -> bool {
    let name = name.trim().to_ascii_lowercase();
    DEADLOCK_PROCESS_NAMES.iter().any(|known| *known == name)
}

/// Observed state of the game process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GameProcessState {
    pub running: bool,
    /// Unix seconds when the companion first saw the process running.
    pub started_at: Option<i64>,
}

impl GameProcessState {
    pub fn stopped() -> Self {
        Self {
            running: false,
            started_at: None,
        }
    }
}

/// Detects whether Deadlock is running. Implemented per platform.
pub trait ProcessDetector: Send {
    fn is_game_running(&mut self) -> bool;
    fn game_pid(&mut self) -> Option<u32> {
        None
    }
}

/// Lets [`GameLifecycle`] hold the boxed platform detector directly.
impl ProcessDetector for Box<dyn ProcessDetector> {
    fn is_game_running(&mut self) -> bool {
        (**self).is_game_running()
    }
    fn game_pid(&mut self) -> Option<u32> {
        (**self).game_pid()
    }
}

/// Tracks launch and exit transitions on top of a [`ProcessDetector`].
pub struct GameLifecycle<D: ProcessDetector> {
    detector: D,
    state: GameProcessState,
}

/// What changed between two lifecycle polls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleEvent {
    Launched,
    Exited,
    Unchanged,
}

impl<D: ProcessDetector> GameLifecycle<D> {
    pub fn new(detector: D) -> Self {
        Self {
            detector,
            state: GameProcessState::stopped(),
        }
    }

    pub fn state(&self) -> GameProcessState {
        self.state
    }

    /// Polls the detector and reports the transition, if any.
    pub fn poll(&mut self) -> LifecycleEvent {
        let running = self.detector.is_game_running();
        match (self.state.running, running) {
            (false, true) => {
                self.state = GameProcessState {
                    running: true,
                    started_at: Some(unix_now()),
                };
                LifecycleEvent::Launched
            }
            (true, false) => {
                self.state = GameProcessState::stopped();
                LifecycleEvent::Exited
            }
            _ => LifecycleEvent::Unchanged,
        }
    }
}

/// The platform detector for the current build.
pub fn detector() -> Box<dyn ProcessDetector> {
    #[cfg(windows)]
    {
        Box::new(windows::WindowsProcessDetector::new())
    }
    #[cfg(unix)]
    {
        Box::new(linux::LinuxProcessDetector::new())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ScriptedDetector {
        answers: Vec<bool>,
        index: usize,
    }

    impl ProcessDetector for ScriptedDetector {
        fn is_game_running(&mut self) -> bool {
            let answer = self.answers.get(self.index).copied().unwrap_or(false);
            self.index += 1;
            answer
        }
    }

    #[test]
    fn known_process_names_are_recognised() {
        assert!(is_deadlock_process("project8.exe"));
        assert!(is_deadlock_process("Project8.exe"));
        assert!(is_deadlock_process("  deadlock  "));
    }

    #[test]
    fn unrelated_processes_do_not_match() {
        assert!(!is_deadlock_process("counterlock-companion"));
        assert!(!is_deadlock_process("deadlock-counterlock"));
        assert!(!is_deadlock_process("steam"));
        assert!(!is_deadlock_process(""));
    }

    #[test]
    fn lifecycle_reports_launch_and_exit_once_each() {
        let detector = ScriptedDetector {
            answers: vec![false, true, true, false],
            index: 0,
        };
        let mut lifecycle = GameLifecycle::new(detector);
        assert_eq!(lifecycle.poll(), LifecycleEvent::Unchanged);
        assert_eq!(lifecycle.poll(), LifecycleEvent::Launched);
        assert!(lifecycle.state().running);
        assert!(lifecycle.state().started_at.is_some());
        assert_eq!(lifecycle.poll(), LifecycleEvent::Unchanged);
        assert_eq!(lifecycle.poll(), LifecycleEvent::Exited);
        assert!(!lifecycle.state().running);
    }
}
