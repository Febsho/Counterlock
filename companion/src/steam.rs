//! Local Steam account discovery.
//!
//! Reads `config/loginusers.vdf`, which Steam writes for its own login UI. This
//! is a plain config file in the user's own Steam directory: no game files, no
//! process inspection, no credentials.

use anyhow::{bail, Context, Result};
use std::path::PathBuf;

/// Offset between a 64-bit SteamID and the 32-bit account id used by the
/// Deadlock API. `STEAM_ID64 = STEAM_ACCOUNT_ID + 76561197960265728`.
pub const STEAM_ID64_BASE: u64 = 76_561_197_960_265_728;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SteamAccount {
    pub account_id: u32,
    pub persona_name: Option<String>,
    pub most_recent: bool,
    pub timestamp: u64,
}

/// Converts a SteamID64 into a 32-bit account id.
pub fn account_id_from_steam_id64(steam_id64: u64) -> Result<u32> {
    if steam_id64 < STEAM_ID64_BASE {
        bail!("{steam_id64} is not a valid individual SteamID64");
    }
    let account_id = steam_id64 - STEAM_ID64_BASE;
    u32::try_from(account_id).context("account id does not fit in 32 bits")
}

/// Candidate Steam roots for the current platform, most likely first.
pub fn steam_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if cfg!(windows) {
        for key in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(base) = std::env::var_os(key) {
                roots.push(PathBuf::from(base).join("Steam"));
            }
        }
    } else if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        roots.push(home.join(".steam/steam"));
        roots.push(home.join(".local/share/Steam"));
        roots.push(home.join(".steam/root"));
        // Flatpak Steam keeps its own data directory.
        roots.push(home.join(".var/app/com.valvesoftware.Steam/data/Steam"));
    }
    roots
}

/// Finds `loginusers.vdf` under any known Steam root.
pub fn login_users_path() -> Option<PathBuf> {
    steam_roots()
        .into_iter()
        .map(|root| root.join("config").join("loginusers.vdf"))
        .find(|path| path.exists())
}

/// Resolves the most recently used local Steam account.
///
/// Returns `Ok(None)` when Steam is installed but no account has logged in,
/// which is a legitimate "data unavailable" state rather than an error.
pub fn detect_account() -> Result<Option<SteamAccount>> {
    let Some(path) = login_users_path() else {
        return Ok(None);
    };
    let raw =
        std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))?;
    Ok(most_recent_account(&parse_login_users(&raw)))
}

/// Picks the account Steam would log in by default: the `MostRecent` flag when
/// present, otherwise the newest timestamp.
pub fn most_recent_account(accounts: &[SteamAccount]) -> Option<SteamAccount> {
    accounts
        .iter()
        .filter(|a| a.most_recent)
        .max_by_key(|a| a.timestamp)
        .or_else(|| accounts.iter().max_by_key(|a| a.timestamp))
        .cloned()
}

/// Minimal VDF reader scoped to `loginusers.vdf`.
///
/// A full VDF parser is not warranted here: the file is a fixed two-level shape
/// (`users` -> steamid -> flat key/values), so we tokenize quoted strings and
/// braces and read the one level we care about. Unknown keys are ignored, so a
/// Steam-side addition cannot break parsing.
pub fn parse_login_users(input: &str) -> Vec<SteamAccount> {
    let tokens = tokenize(input);
    let mut accounts = Vec::new();
    let mut index = 0;

    while index < tokens.len() {
        let Token::Quoted(key) = &tokens[index] else {
            index += 1;
            continue;
        };
        // A quoted key immediately followed by `{` opens a block.
        if !matches!(tokens.get(index + 1), Some(Token::OpenBrace)) {
            index += 1;
            continue;
        }
        let Ok(steam_id64) = key.parse::<u64>() else {
            // Not a steamid block (e.g. the outer "users") - descend into it.
            index += 2;
            continue;
        };
        let Ok(account_id) = account_id_from_steam_id64(steam_id64) else {
            index += 2;
            continue;
        };

        let mut account = SteamAccount {
            account_id,
            persona_name: None,
            most_recent: false,
            timestamp: 0,
        };
        index += 2;
        let mut depth = 1usize;
        while index < tokens.len() && depth > 0 {
            match &tokens[index] {
                Token::OpenBrace => depth += 1,
                Token::CloseBrace => depth -= 1,
                Token::Quoted(field) if depth == 1 => {
                    if let Some(Token::Quoted(value)) = tokens.get(index + 1) {
                        match field.to_ascii_lowercase().as_str() {
                            "personaname" => account.persona_name = Some(value.clone()),
                            "mostrecent" => account.most_recent = value == "1",
                            "timestamp" => account.timestamp = value.parse().unwrap_or(0),
                            _ => {}
                        }
                        index += 1;
                    }
                }
                _ => {}
            }
            index += 1;
        }
        accounts.push(account);
    }
    accounts
}

#[derive(Debug, PartialEq)]
enum Token {
    Quoted(String),
    OpenBrace,
    CloseBrace,
}

fn tokenize(input: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '{' => tokens.push(Token::OpenBrace),
            '}' => tokens.push(Token::CloseBrace),
            '"' => {
                let mut value = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '\\' => {
                            // VDF uses backslash escapes; keep the escaped char verbatim.
                            if let Some(escaped) = chars.next() {
                                value.push(escaped);
                            }
                        }
                        '"' => break,
                        _ => value.push(c),
                    }
                }
                tokens.push(Token::Quoted(value));
            }
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() {
                    if c == '\n' {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    tokens
}

/// Parses a SteamID64, a numeric profile URL, or a bare account id.
pub fn account_id_from_input(input: &str) -> Option<u32> {
    let trimmed = input.trim().trim_end_matches('/');
    let candidate = trimmed.rsplit('/').next().unwrap_or(trimmed);
    let number: u64 = candidate.parse().ok()?;
    if number >= STEAM_ID64_BASE {
        account_id_from_steam_id64(number).ok()
    } else {
        u32::try_from(number).ok().filter(|id| *id > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
"users"
{
	"76561197960265729"
	{
		"AccountName"		"older"
		"PersonaName"		"Older Account"
		"RememberPassword"		"1"
		"MostRecent"		"0"
		"Timestamp"		"1700000000"
	}
	"76561197960265730"
	{
		"AccountName"		"current"
		"PersonaName"		"Current Account"
		"MostRecent"		"1"
		"Timestamp"		"1800000000"
	}
}
"#;

    #[test]
    fn steam_id64_converts_to_account_id() {
        assert_eq!(
            account_id_from_steam_id64(STEAM_ID64_BASE + 42).unwrap(),
            42
        );
    }

    #[test]
    fn steam_id64_below_the_base_is_rejected() {
        assert!(account_id_from_steam_id64(12345).is_err());
    }

    #[test]
    fn parses_every_account_in_loginusers() {
        let accounts = parse_login_users(SAMPLE);
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].account_id, 1);
        assert_eq!(accounts[0].persona_name.as_deref(), Some("Older Account"));
        assert!(!accounts[0].most_recent);
        assert_eq!(accounts[1].account_id, 2);
        assert!(accounts[1].most_recent);
    }

    #[test]
    fn most_recent_flag_wins_over_timestamp_order() {
        let accounts = parse_login_users(SAMPLE);
        let chosen = most_recent_account(&accounts).unwrap();
        assert_eq!(chosen.account_id, 2);
    }

    #[test]
    fn falls_back_to_newest_timestamp_when_no_flag_is_set() {
        let input = SAMPLE.replace(r#""MostRecent"		"1""#, r#""MostRecent"		"0""#);
        let accounts = parse_login_users(&input);
        let chosen = most_recent_account(&accounts).unwrap();
        assert_eq!(chosen.account_id, 2, "newest timestamp should win");
    }

    #[test]
    fn empty_or_garbage_input_yields_no_accounts() {
        assert!(parse_login_users("").is_empty());
        assert!(parse_login_users("not a vdf file at all").is_empty());
        assert!(most_recent_account(&[]).is_none());
    }

    #[test]
    fn comments_are_ignored() {
        let input = "// a comment with \"quotes\"\n\"users\"\n{\n}\n";
        assert!(parse_login_users(input).is_empty());
    }

    #[test]
    fn account_id_accepts_steam_ids_urls_and_bare_ids() {
        assert_eq!(account_id_from_input("76561197960265730"), Some(2));
        assert_eq!(
            account_id_from_input("https://steamcommunity.com/profiles/76561197960265730/"),
            Some(2)
        );
        assert_eq!(account_id_from_input("  4242  "), Some(4242));
        assert_eq!(account_id_from_input("gabelogannewell"), None);
        assert_eq!(account_id_from_input("0"), None);
    }
}
