# Changelog

All notable changes to AtomToolBox are recorded here.

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
