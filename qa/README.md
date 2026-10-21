# QA harnesses

These scripts drive the AtomToolBox 0.2.0 build over the Chrome DevTools Protocol. They are development tools, not part of the packaged application.

## Requirements

- Windows 10/11 x64
- AtomToolBox installed at `C:\Program Files\AtomToolBox\AtomToolBox.exe`
- An elevated terminal for tests that touch HKLM, services or power settings
- Node.js 18 or newer

Run the scripts from the project root, for example:

```bash
node qa/smoke-live.js
```

## Main harnesses

| Script | Purpose |
|---|---|
| `smoke-live.js` | Navigation, page rendering and core UI smoke test |
| `debloat-live.js` | Debloat catalog, selection, filter and safe removal-IPC probe (never removes an installed app) |
| `installed-smoke.js` | Smoke test against the installed build |
| `optimizer-live.js` | PRO locks, popup, backend gate and search behaviour |
| `personalize-live.js` | Accent presets and registry personalization |
| `menu-live.js` | Context-menu add verbs and state checks |
| `pps-simple-live.js` | Power Plans create/export/apply flow |
| `ppstudio-live.js` | Power Plan Studio lifecycle |
| `timerres-live.js` | Timer resolution helper lifecycle |
| `capture-screenshots.js` | Regenerate the screenshot gallery |
| `recapture-long-pages.js` | Recapture long full-page screenshots |
| `screenshot-probe.js` | Screenshot sizing probe |
| `final-check.ps1` | Final local verification helper |

`lib/cdp.js` contains the shared CDP client and app launcher.

## Generated output

- `qa/logs/` — harness logs and screenshots
- `qa/tmp/` — temporary test files and captures

Both directories are ignored by git. The screenshot generator writes `screenshots/manifest.json` and `screenshots/index.html`; it does not create a README. The entire `screenshots/` directory is intentionally ignored by git.

## Legacy

`legacy/` contains older root-level debug scripts moved here during repository cleanup. They are kept for reference and are not part of the current QA suite.

`notes/waasmedic-service.txt` is a scratch note related to the Windows Update service tweak.
