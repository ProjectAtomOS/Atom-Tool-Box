# Windows App Debloat

The **WINDOWS DEBLOAT** page removes selected preinstalled AppX/MSIX apps from Windows 10 and Windows 11. It is designed for a clean install or a new user profile, not as a general-purpose uninstaller.

## What removal does

For each selected catalog entry, AtomToolBox:

1. Enumerates the matching installed packages for all users.
2. Removes removable package instances. It first requests an all-user removal and falls back to the current user if the Windows build rejects that request.
3. Removes the matching provisioned package so Windows does not install the app for new user accounts.
4. Re-enumerates installed and provisioned packages to verify the result.

The page reports installed/provisioned counts per app and does not claim success when packages remain.

## Catalog

The reviewable catalog is [`src/config/debloat.json`](../src/config/debloat.json). It contains Microsoft apps, Xbox components, promoted Store apps, games and a small number of optional Microsoft tools. Each entry has one or more package names.

The app deliberately does not remove framework or dependency packages, the Microsoft Store, Desktop App Installer, VCLibs, UI.Xaml, Windows App Runtime, or packages that Windows marks as **NonRemovable**. Protected entries appear as disabled rows and are skipped.

## Selection and confirmation

- Only apps that are installed or provisioned can be selected.
- **SHOW NOT INSTALLED** reveals the rest of the catalog for reference; those rows stay disabled.
- **SELECT ALL VISIBLE** selects only selectable rows currently visible after filtering.
- **REMOVE SELECTED** asks for confirmation and then applies to every user. There is no undo button.

## Safety

Removal is destructive and intentionally not reversible from AtomToolBox. Reinstall an app from the Microsoft Store, its vendor, or Windows optional features if needed. Create a restore point before a large cleanup.

Close the apps you intend to remove before starting. Windows can reject a removal when the package is in use. If that happens, the page reports the remaining package count; close the app and try again.

## Verification and failure reporting

The PowerShell helper writes an atomic progress file after each app. If Windows takes longer than the helper timeout, the main process reads that progress file and then performs a fresh AppX scan. As a result:

- Apps that were actually removed are reported as removed even when the helper timed out while finishing.
- Apps that remain are reported as issues with their remaining counts.
- A failed provisioned-package scan or an all-user scan that falls back to the current user is surfaced in the status line instead of being treated as success.
- A rejected or incomplete helper result triggers a rescan before the UI reports failure.

## Implementation

- `src/config/debloat.json` — catalog and package-name allow-list.
- `src/scripts/debloat/debloat_tool.ps1` — scan, remove, atomic progress and verification.
- `main.js` — `debloat-scan` and `debloat-remove` IPC handlers, validation, cache and final verification.
- `src/renderer.js` — catalog page, selection, filtering, confirmation and result display.
- `qa/debloat-live.js` — read-only UI harness plus a safe removal-IPC probe using an absent catalog entry.

## Troubleshooting

If a removal reports issues:

1. Read the status line and the per-app detail after `FINISHED WITH ISSUES`.
2. Press **REFRESH** to force a new scan and see what remains.
3. Close any running instance of the app and retry only the remaining app.
4. Check `Microsoft-Windows-AppXDeploymentServer/Operational` in Event Viewer for the Windows deployment error code.

If the whole app asks for UAC approval, that is expected: AtomToolBox is designed to run as administrator at all times.
