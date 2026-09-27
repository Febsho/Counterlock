# Changelog

## 0.1.5

- Added match history with completed match summaries and player performance context.
- Added match intelligence for lane state, enemy team profiles, and early item decisions.
- Expanded counter recommendations with enemy coverage and clearer live build context.
- Added regression coverage for match history and match intelligence.

## 0.1.4

- Redesigned the Tauri desktop shell with compact navigation and a contextual
  match header; the public website is unchanged.
- Prioritized the live team roster, relative enemy threats, and current Next
  Buy, with expandable player profiles and a denser Build Lab.
- Added cached, batched account-ID profile enrichment, rank badges, and a
  compact overlay showing the next purchase and top threat.
- Expanded live threat and purchase context while preserving unknown values
  when a profile source or telemetry field is unavailable.

## 0.1.3

- Added Windows support for the existing read-only, exact-build game reader in
  both the desktop app and standalone companion. On a supported client build,
  this enables local roster, combat-stat, shop-soul, and owned-item detection.
- Added player names, avatars, and clearly labeled Statlocker estimated ranks
  to the live teams and Build Lab, with cached profile lookups.
- Reworked the live Build Lab around an affordable next buy, player-targeted
  reasons, alternatives, owned inventory, adaptive counters, and the full
  purchase path.
- Kept recommendations and roster context available across brief incomplete
  match snapshots, and aligned item-flow and purchase timing with live match
  time.

## 0.1.2

- Reworked recommendations around the selected hero and enemy lineup, combining
  hero item flow, exact-lineup samples, weighted individual matchups, live
  enemy threat and item counter mechanics.
- Added a focused next-buy recommendation with core build paths, adaptive
  counters, upgrade-aware planning, sample confidence and concise reasons.
- Build Lab and Desktop Live Panel now use the shared recommendation engine.
- On the exact supported Deadlock client build, the desktop reads the local
  player's unspent shop souls and owned items from game memory. Unknown values
  remain unknown; net worth is not used as shop balance.
- At match completion, the desktop scans Steam's replay cache and submits
  metadata/replay salts to Deadlock API before requesting Statlocker ingestion.
  This can seed matches that have not appeared in the popular-match feed yet.
- Added the optional server-side Statlocker profile proxy with graceful
  fallback when it is unconfigured or unavailable.

## 0.1.1

- Initial signed desktop release with Linux AppImage/DEB and Windows installer.
