//! Offsets observed against one exact installed Deadlock client build.
//! Unknown binaries keep their offsets unset rather than displaying false data.
use crate::config::Config;
use crate::install_local::Installation;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;

const CLIENT_SHA256: &str = "cb831d124403ee2f3afa54981e69d8acf71251ba1129d0733757251f74a157c2";

pub fn apply_for_installed_build(config: &mut Config, installation: &Installation) {
    let Some(root) = installation.path.as_ref() else { return };
    let client = root.join("game/citadel/bin/win64/client.dll");
    let Ok(mut file) = File::open(client) else { return };
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let Ok(count) = file.read(&mut buffer) else { return };
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != CLIENT_SHA256 {
        return;
    }

    let offsets = &mut config.offsets;
    offsets.client.entity_system = Some(0x30ebdc8);
    offsets.client.max_entities = 64;
    offsets.entity.entry_stride = 112;
    offsets.player.steam_id = Some(0x778);
    offsets.player.team = Some(0x3f3);
    offsets.player.hero_id = Some(0x90c);
    offsets.player.net_worth = Some(0x918);
    offsets.player.kills = Some(0x944);
    offsets.player.assists = Some(0x948);
    offsets.player.deaths = Some(0x94c);
    offsets.player.hero_pawn = Some(0x8ac);
    offsets.pawn.currencies = Some(0x12e0);
    offsets.pawn.gold_currency_index = 0;
    offsets.pawn.ability_component = Some(0x14d0);
    offsets.pawn.abilities_vector = Some(0x68);
    offsets.pawn.abilities_data = Some(0x8);
    offsets.pawn.ability_subclass_id = Some(0x388);
    offsets.pawn.ability_slot = Some(0x778);
    tracing::info!("verified local game-memory profile loaded");
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires the matching Deadlock build running in a local match"]
    fn reads_the_running_local_match() {
        let mut config = Config::default();
        apply_for_installed_build(&mut config, &crate::install_local::detect());
        assert!(config.offsets.usable(), "no matching installed game build");
        let pid = crate::platform::linux::game_pid().expect("Deadlock is not running");
        let mut reader = crate::game::GameReader::attach(
            pid,
            &config.client_module,
            config.offsets,
        )
        .expect("cannot attach to the running game");
        let snapshot = reader.poll(None).unwrap().expect("no active local match");
        assert!(snapshot.players.len() >= 2);
        assert!(snapshot.players.iter().any(|player| player.account_id.is_some()));
        assert!(snapshot.players.iter().all(|player| player.hero_id.is_some()));
        assert!(snapshot.players.iter().any(|player| player.account_id.is_some() && player.unspent_souls.is_some()));
        assert!(snapshot.players.iter().any(|player| player.account_id.is_some() && player.owned_item_class_tokens.is_some()), "live ability list was not readable");
    }
}
