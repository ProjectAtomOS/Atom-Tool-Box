# Changelog

All notable changes to AtomToolBox are recorded here.

## [0.3.0] - 2026-10-21

### Added

- Windows App Debloat page with a reviewable AppX/MSIX catalog, per-app selection, filtering and a confirmed remove action
- All-user AppX removal plus provisioned-package cleanup to prevent reinstallation for new Windows accounts
- Per-app removal results with installed/provisioned remaining counts and a fresh post-removal verification scan
- `docs/DEBLOAT.md` and a focused `qa/debloat-live.js` harness

### Changed

- AtomToolBox now always runs as administrator: the packaged executable uses a `requireAdministrator` manifest and development launches re-open through UAC
- Administrator detection uses the Windows high-integrity token SID instead of relying on the Server service
- Debloat scanning is cached briefly and can be force-refreshed
- Removal now uses one AppX snapshot and one provisioned-package snapshot instead of re-enumerating the system for every app, keeping large removals within the helper timeout

### Fixed

- Fixed false “REMOVAL FAILED” reports after Windows had already removed the selected apps
- Removal progress is written atomically after every app, so a helper timeout or unexpected exit can still return partial results instead of discarding them
- A rejected or incomplete helper result now triggers a fresh AppX scan before the UI reports failure
- Provisioned-package verification failures and current-user-only scans are surfaced instead of being silently treated as success

### Notes

- Windows 10 22H2 was the primary live-test platform for this release.
- The installer is currently unsigned.
- Electron 28 remains the runtime used by this release; upgrading the Electron major version is tracked separately because it requires a fresh packaging and compatibility pass.

## [0.2.0] - 2026-10-20

### Added

- Background Monitor with process kill and IFEO-based application blocking
- Startup Manager with native StartupApproved support
- Personalize page with accent presets, taskbar and desktop icon controls
- Context Menu add/remove verbs
- Power Plans: create, import, export, rename, duplicate and delete
- Everyday power settings editor and timer resolution controls
- Backup & Restore: restore points and registry backups
- Global search with Ctrl+K
- Live CHECK STATE and registry audit export
- Dark, OLED and Light themes

### Changed

- Reworked navigation into SYSTEM, OPTIMIZATIONS, TOOLS & UTILITIES, ADVANCED and MANAGEMENT & SAFETY
- Replaced per-tweak PowerShell checks with batched checks
- Replaced dashboard polling with native process and system snapshots
- Locked the four ADVANCED tools behind the Atom Optimizer PRO prompt

### Fixed

- Removed fabricated, duplicate and unreferenced tweaks and scripts
- Corrected power-plan GUIDs, registry values and hidden-setting checks
- Fixed command-line quoting that could make plain-command tweaks silently do nothing
- Fixed false OFF states in hidden power settings, privacy checks and hex comparisons
- Fixed power-plan parsing, accent palette bounds and plan-studio selection state
- Hardened admin gating and non-fatal failure logging

### Notes

- Windows 10 22H2 was the primary live-test platform for this release.
- The installer is currently unsigned.
