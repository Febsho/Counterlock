# Changelog

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
