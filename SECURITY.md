# Security Policy

## Supported versions

The latest 0.3.x release is supported with security fixes.

AtomToolBox runs with administrator rights by design, so only run the official installer or a build you made from this repository.

## Runtime note

0.3.x ships Electron 28.3.3. The app loads local UI files and does not embed arbitrary remote pages, but the runtime is older than current upstream Electron releases. A major Electron upgrade is tracked as a separate compatibility and packaging task.

## Reporting a vulnerability

Please do not open a public issue for security-sensitive reports.

Use GitHub's private vulnerability reporting on the repository:

https://github.com/ProjectAtomOS/Atom-Tool-Box/security/advisories/new

Include the affected version, reproduction steps and any relevant logs. Reports will be reviewed before public disclosure.
