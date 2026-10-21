# AtomToolBox 0.3.0

Windows 10/11 x64 tweak and system utility toolbox.

## Installer

- File: `AtomToolBox-Setup-0.3.0.exe`
- Size: 76,656,404 bytes
- SHA-256: `F5A923EE847E9D29A043081E57C0F07527F0843D4D5FE8A2B023ED4CB5882D19`

## Highlights

- New **WINDOWS DEBLOAT** page with a reviewable AppX/MSIX catalog, filtering, per-app selection and a confirmed remove action
- Removes selected apps for all users and removes provisioned copies so Windows does not reinstall them for new accounts
- Per-app remaining counts plus a fresh post-removal verification scan
- AtomToolBox now always runs as administrator, with a `requireAdministrator` manifest and a UAC relaunch fallback for development
- Faster large removals: one installed-package snapshot and one provisioned-package snapshot instead of repeated system-wide scans
- Atomic removal progress means a helper timeout no longer throws away already-completed removals
- Clearer failure reporting for protected packages, running apps, provisioned-package scan errors and current-user-only scans

## Upgrade notes

This release changes the launch policy: Windows will request administrator approval every time AtomToolBox starts. Approve the UAC prompt to use the app.

Install over 0.2.0 with the new setup executable. Existing tweaks and local settings are left in place. The four ADVANCED entries remain intentionally locked and open the Atom Optimizer PRO prompt.

Windows App Debloat is destructive. Selected packages are removed for every user and their provisioned copies are removed. Removal cannot be undone from AtomToolBox; reinstall an app from the Microsoft Store or its vendor if needed. See [DEBLOAT.md](DEBLOAT.md).

## Fixed

- Fixed false `REMOVAL FAILED` reports after Windows had already removed the selected apps
- Partial removal results are now recovered from an atomic progress file instead of being discarded on timeout
- A failed or incomplete helper result triggers a verification scan before the UI reports failure
- Provisioned-package verification failures and all-user scan fallbacks are no longer silently treated as success

## Known notes

- The installer is not code-signed yet, so Windows SmartScreen may show a warning.
- Windows 10 22H2 was the primary live-test platform for this release.
- Windows may refuse to remove a package while its app is running; close the app and retry.
- Some packages are marked protected by Windows. They are skipped and reported instead of being forced.
- Electron 28 remains the runtime for this release. An Electron major upgrade is a separate compatibility and packaging task.

## Full changelog

See [CHANGELOG.md](../CHANGELOG.md).
