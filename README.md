# AtomToolBox

A Windows 10/11 x64 tweak and system utility toolbox built with Electron.

**Version:** 0.2.0

**Repository:** https://github.com/ProjectAtomOS/Atom-Tool-Box

## Overview

AtomToolBox brings common Windows tweaks, maintenance tools and system controls into one desktop app. It is designed for both everyday users and power users, with plain-language descriptions, live state checks and reversible changes.

The four entries in the **ADVANCED** group are intentionally locked in this build. They are part of Atom Optimizer and open a PRO prompt instead of a tool page.

## Features

- Windows, Gaming, GPU, Power, Network, Privacy and Personalize tweaks
- Background Monitor with process kill and application blocking
- Startup Manager using native StartupApproved behaviour
- Context Menu add/remove verbs
- Windows App Debloat with per-app selection, all-user removal and provisioned-package cleanup
- Brave Debloater and system Cleaner
- Power Plans: create, import, export, edit everyday settings and timer resolution
- Backup & Restore: restore points and registry backups
- App Installer and Installed Apps
- Global search, live CHECK STATE and registry audit export
- Dark, OLED and Light themes

## Requirements

- Windows 10 or Windows 11, x64
- Node.js 18 or newer for development
- Administrator rights; AtomToolBox always runs elevated and asks for UAC approval at launch

## Development

```bash
npm install
npm start        # launch the app
npm run dev      # launch with --dev
npm run check    # syntax-check main.js and renderer.js
npm run build    # build the NSIS installer into dist/
```

The build output is `dist/AtomToolBox-Setup-0.2.0.exe`.

## Releases

Download the current installer from [GitHub Releases](https://github.com/ProjectAtomOS/Atom-Tool-Box/releases). Build output and generated screenshots are intentionally not committed to the repository.

## Project structure

```text
.
├── assets/                 App icons and logos
├── build/                  NSIS installer customisation
├── dist/                   Build output (ignored by git)
├── docs/
│   ├── AUDIT_REPORT.md     Forensic audit and change history
│   ├── reference/
│   │   └── reg-files/      Reference .reg exports (not shipped)
│   └── README.md           Documentation index
├── power-plans/            Bundled .pow power plans
├── qa/                     QA harnesses and screenshots tooling
│   ├── legacy/             Historical debug scripts
│   ├── lib/                Shared CDP helpers
│   ├── logs/               Generated logs (ignored)
│   ├── notes/              Scratch notes
│   └── tmp/                Generated test files (ignored)
├── src/
│   ├── config/             Tweak and app definitions
│   ├── scripts/            Batch and PowerShell tweak scripts
│   ├── index.html          App shell
│   ├── renderer.js         UI logic
│   └── styles.css          Theme and layout styles
├── main.js                 Electron main process
├── package.json
├── package-lock.json
├── LICENSE                 MIT license
└── SECURITY.md             Security policy
```

## QA and screenshots

The QA harnesses in `qa/` drive the installed build over the Chrome DevTools Protocol. See [`qa/README.md`](qa/README.md) for the script list and requirements.

Regenerate the screenshot gallery with:

```bash
node qa/capture-screenshots.js
```

The generator writes the gallery to `screenshots/` locally. That folder is intentionally ignored by git and is not part of the repository.

## Documentation

- [Audit report](docs/AUDIT_REPORT.md)
- [Documentation index](docs/README.md)
- [Changelog](CHANGELOG.md)
- [Release notes for 0.2.0](docs/RELEASE_NOTES_v0.2.0.md)
- [Windows App Debloat guide](docs/DEBLOAT.md)
- [Security policy](SECURITY.md)

## License

MIT — see [LICENSE](LICENSE).

## Safety

AtomToolBox changes Windows settings. Some tweaks affect services, security features and system behaviour. Create a restore point before applying system-wide changes, and review each tweak description before turning it on.

Windows App Debloat is intentionally destructive: selected Store/MSIX apps are removed for every user, and their provisioned copies are removed so Windows does not reinstall them for new accounts. Removal is not reversible from AtomToolBox. Reinstall an app from the Microsoft Store or its vendor if needed. Read [docs/DEBLOAT.md](docs/DEBLOAT.md) before using it.
