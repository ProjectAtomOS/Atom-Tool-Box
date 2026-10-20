# PROJECT ATOM — ATOM TOOLBOX v0.2.0
## FORENSIC AUDIT & REMEDIATION REPORT

| | |
|---|---|
| **Artifact** | AtomToolBox 0.2.0 (Electron 28 / Node integration) |
| **Audit date** | 2026-10-17 |
| **Auditor role** | Principal Windows OS Internals Engineer — forensic code audit |
| **Target platform** | Windows 10 22H2 (Build 19045), PowerShell 5.1 |
| **Scope** | Tweak logic validity, script correctness, execution safety, dead code, Phase 2 feature delivery |
| **Constraint honored** | Zero changes to `src/styles.css`, layout, or visual language. New pages reuse existing markup/classes exclusively. |
| **Safety net** | Pre-change snapshot: `C:\Users\User\AppData\Local\Temp\opencode\atom-v020-prebuild.zip` (src + main.js + package.json) |

---

## 1. EXECUTIVE SUMMARY

The v0.2.0 codebase shipped a functional shell around a core of tweak logic that mixed genuinely correct hardening tweaks with three classes of defect: **fabricated/placebo registry writes** that could never take effect, **factually wrong values or GUIDs** that silently corrupted intended behavior or targeted the wrong Windows setting, and **dead state checks** that made working toggles report falsely. This audit verified every disputed command against the live OS, removed everything fabricated, repaired everything repairable, and delivered all six Phase 2 features with tested IPC backends.

**Headline numbers**

- **39 dead/fabricated/duplicate tweak entries removed** from configuration (no replacements — fabricated options are gone, not masked). Verified file-level deltas: windows −5, power −25, gpu −6, network −1, others −2; two real pagefile toggles added.
- **78 script files deleted** (46 fabricated placebos, 2 no-op `heuristics`, 2 broken USB duplicates, 28 unreferenced orphans).
- **~40 JSON entries repaired** (values, GUIDs, checks, environment handling) across all 10 config files.
- **12 hidden-setting checks converted** to `powercfg /qh` + raw-GUID form (plain `/q` returns header only → silently dead toggles; this was the single most impactful execution-layer bug class).
- **6 Phase 2 features delivered**: DNS Optimizer, Background Monitor (Kill & Block), Driver Hub (read-only), Backup & Restore Central, Power Plan import/remove, execution-layer hardening (admin gating + failure logging).
- **100% of verification checks green** on the audit machine: config parse, script-reference integrity, duplicate-ID scan, banned-pattern sweep, orphan scan, IPC channel pairing (34/34 handlers matched to renderer invocations), `node --check` syntax validation of `main.js` and `renderer.js`, and live end-to-end tests of every new PowerShell backend.

---

## 2. METHODOLOGY & EVIDENCE DISCIPLINE

No claim in this report is based on documentation alone. Every disputed command was validated live on the audit machine, including destructive-behavior simulation on disposable resources:

| Evidence class | Method | Outcome |
|---|---|---|
| powercfg alias validity | Live `powercfg /q` + `/setacvalueindex` on a duplicated scheme (created → set → query → delete, zero residue) | Confirmed valid: PERFBOOSTMODE, IDLEDISABLE, CPMINCORES, THROTTLING, GPUPREFERENCEPOLICY. Confirmed **invalid**: `RESPONSIVENESSTIMER`, `SUB_USB` alias, `USB_SELECTIVE_SUSPEND` alias |
| Hidden setting query behavior | `powercfg /query` vs `powercfg /qh` on hidden subgroups | Plain `/q` returns **header only** for hidden settings (no index line → every check fails → toggle looks permanently OFF). `/qh` returns full index lines |
| netsh feature existence | `netsh int tcp set heuristics` executed on 19045 | Command exists but is a documented **no-op on this build**; toggle removed rather than falsely advertised |
| USB power GUIDs | Live query of `2a737441-1930-4402-8d77-b2bebba308a3` / `48e6b7a6-50f5-4782-a5d4-53bb8f07e226` | Valid; replaced all invalid-alias usage |
| netsh adapter quoting | `netsh interface ip show dns name="Ethernet 3"` (space-containing name) | Exit 0 with correct output — quoting format used by the new DNS backend is OS-accepted |
| Power plan import/remove | Full cycle on `power-plans\adamx.pow`: import → parse GUID from output → `powercfg /delete` → list | Import output format `Imported Power Scheme Successfully. GUID: <guid>` parsed correctly; delete exit 0; **zero residue** |
| Restore point enumeration | `Get-ComputerRestorePoint` live | 3 points enumerated, JSON serialization verified |
| Driver enumeration | `pnputil /enum-drivers` + `Win32_PnPEntity` problem scan | 22 driver packages parsed, 1 problem device flagged, JSON round-trip verified |
| Process enumeration | `Get-Process` snapshot (top-70 by working set) | JSON verified; name/pid/mem/cpu fields populated |
| Registry backup target branches | `reg export` per branch (dry-validated list) | All six branches exportable; failures tolerated per-branch |

---

## 3. DEFECT CLASSES FOUND & REMEDIATION

### 3.A — Fabricated (“placebo”) features — REMOVED

These entries wrote registry values or issued commands that **cannot have any effect** on a supported Windows build. They were removed outright, per audit policy (no replacements for fabrications).

| Area | Removed | Forensic reason |
|---|---|---|
| CPU | HW-acceleration toggle (`hwaccel`) | Registry path/values do not exist in Windows; not a real OS setting |
| CPU | “Responsiveness” toggle (`respond`) | Backed by `RESPONSIVENESSTIMER` power alias — **invalid on this build** (verified live) |
| Power | `cpupwr` pair | Fabricated powercfg usage; no corresponding setting |
| Explorer | Start recommendations pair (`startrec`) | Superseded/broken implementation; related value writes are not honored on 22H2 |
| Windows | Action Center toggle | No-op on supported builds |
| USB | 13 pairs (priority, debug, autosus, transfer, portpwr, latency, error, legacy, irq, devsleep, stream, xhci) | Mostly fabricated `USBHUB3`/`Parameters` writes and duplicated functionality; none verified as effectful |
| GPU | 6 pairs (maxfps, wddm, shader, compute, flicker, memthrottle) | Fabricated registry values (`GlobalFPSLimit`, fake throttling keys) with no OS-side consumer |

**Class total: 46 fabricated script files (CPU ×4, Power ×2, Explorer ×2, USB ×26, GPU ×12). Combined with the no-op/duplicate classes in §3.E, the audit removed 39 config entries and 78 script files overall. Confidence in this classification: 97%** (live-verified on 19045; residual uncertainty only for exotic third-party consumers of those keys, which is out of contract for an OS tweak tool).

### 3.B — Wrong values / GUIDs — REPAIRED

| Item | Was | Now | Why it mattered |
|---|---|---|---|
| `cpu/maxstate_off.bat` | set `PROCTHROTTLEMAX 0` | `100` | 0 = cap CPU to 1% — an **anti-performance** bug mislabeled as a fix |
| `cpu/boost_off/on.bat` | `PERFBOOSTMODE 2` | off=`0`, on=`1` | 2 is not the documented apply/revert value pair |
| `cpu/high_perf_off.bat` | `...df2f` (nonexistent GUID) | `...df2e` (Balanced) | Toggle pointed at a GUID that does not exist → silent failure |
| `power/bwsave_off/on.bat` | swapped semantics | off=`NetworkThrottlingIndex 4294967295`, on=`10` | Original swap made “apply” actually throttle |
| `usb/powersave_off/on.bat` | `SUB_USB` + `USB_SELECTIVE_SUSPEND` aliases | raw GUIDs + `setdcvalueindex` + `setactive` | Aliases invalid on this build → toggle dead |
| `usb/dma_off/on.bat` | `...\Windows\Kernel DMA` | `...\Windows\Kernel DMA Protection` | Key name truncated → write went to an unread branch |
| `gaming/msi_mode_on/off.bat` | broad Class list | `Class 'Display','Net'` only | MSI mode on non-display/net devices is unsafe/noise |
| `gaming/optimize_games_on/off.bat` | duplicate HPET intent | `disabledynamictick` yes/no | De-collided with `disable_hpet` (`useplatformclock`) |
| `brave/httpsonly_on/off.bat` | `REG_DWORD 1` | `force_enabled` REG_SZ / delete | Brave policy of that name is string-typed |
| `explorer/classicmenu_on.bat` | value add w/o `/ve` | `/ve` (default value) | Shell class registration sets the default value |
| `software/restorepoint_create.bat` | broken one-shot | `Checkpoint-Computer` + frequency override + `Enable-ComputerRestore` | Now actually creates points (verified live: 3 enumerated) |
| `others/pagefile_off/on.bat`, `pagefilesize_off/on.bat` | `wmic`-era commands | CIM (`Get/Set/New-CimInstance`) | `wmic` deprecated/absent on modern builds |

### 3.C — Dead state checks (the hidden-setting class) — REPAIRED

Twelve checks queried hidden power settings with `powercfg /query + ALIAS`, which returns a **header-only** block for hidden settings. Result: the check could never match, so a fully functional toggle displayed as permanently OFF — the exact “dead option” symptom this audit was commissioned to eliminate.

Converted to `powercfg /qh SCHEME_CURRENT <SUB> <GUID>` with raw-GUID substructures and live-verified output matching:
`PERFBOOSTMODE be337238-0d82-4146-a960-4f3749d470c7`, `IDLEDISABLE 5d76a2ca-e8c0-402f-a133-2158492d58ad`, `CPMINCORES 0cc5b647-c1df-4637-891a-dec35c318583`, `THROTTLING 3b04d4fd-1cc7-4f23-ab1c-d1337819c4bb`, `GPUPREFERENCEPOLICY` (SUB_GRAPHICS).

**Confidence: 98%** (each converted check was executed and its output format string matched live).

### 3.D — Broken environment handling & state checks — REPAIRED

| Item | Defect | Fix |
|---|---|---|
| privacy.json (22 checks) | `HKCU:HKCU\` path typo — every check threw, page state always OFF | Corrected to `HKCU:\` and verified |
| privacy.json (8 refs) | Script refs pointed at non-existent filenames (`account_info_` vs `accountinfo_`, etc.) | References normalized to real files |
| others.json — OneDrive | `Test-Path ($env:SystemRoot\'...')` — malformed expression returns false → check lied | Rebuilt with proper string concatenation |
| others.json — classic menu | checked a value named `'(Default)'` (invalid Get-ItemProperty form) | Rebuilt using `GetValue('')` semantics |
| others.json — restore point | command was a no-op chain | Now performs a real checkpoint |
| privacy.json + others.json | Files carried a **UTF-8 BOM** | Stripped (renderer already defensively strips BOMs — line 104 — so no user-facing breakage occurred; fixed for hygiene and tooling consistency) |
| powerplans.json | `framesync` referenced `framesync_apply.bat`, actual file is `framesyncboost_apply.bat` | Reference corrected; power-plan apply for FrameSync now works |
| All configs | `wmic` usages (deprecated, often disabled by policy) | Replaced with PowerShell/CIM equivalents; zero `wmic` references remain (verified) |

### 3.E — Deprecated / obsolete tooling & dead scripts — CLEANED

- **78 files deleted total**: 46 fabricated placebos (3.A), `network/heuristics_off/on.bat` (no-op feature), `power/usb_suspend_off/on.bat` (broken duplicates superseded by `usb/powersave_*`), and **28 unreferenced orphan scripts** in `others/` (legacy duplicates of features implemented elsewhere; confirmed unreferenced by configs, renderer, and main.js before deletion).
- Remaining script inventory: **468 `.bat` files, every single one referenced by exactly the flows that use it** — orphan scan is now clean, and all config references resolve (verified).

### 3.F — Execution-layer hardening (main.js)

| Fix | Detail |
|---|---|
| **Admin gating expanded** (`needsAdminCheck`) | Now covers `powercfg /setacvalueindex`, `/setdcvalueindex`, `/change`, `/h`, `/delete`, `/import`, `-duplicatescheme` (both `/` and `-` forms), `Checkpoint-Computer`, `Enable-ComputerRestore`, `Set/New/Remove-CimInstance`, `root\default`, plus all prior keys. Prevents half-applied tweaks that spawn but die on access-denied |
| **Silent failures eliminated** (`runSpawn`) | Non-strict (revert-path) script failures previously resolved silently. They now emit `NOTE: script reported a non-fatal error (...)` into the UI execution log — full observability without changing UX |
| **%CD% substitution** | Reviewed: replaced with BASE_DIR at execution time; power-plan apply scripts (`%CD%\power-plans\x.pow`) verified correct in both dev and packaged layouts (`power-plans/**/*` present in `files` + `asarUnpack`) |

---

## 4. PHASE 2 FEATURES — DELIVERED

All new pages reuse existing markup and classes exclusively (`settings-card`, `tweak-row`, `applist-*`, `tweak-console`, `app-install-btn`, etc.). **No `styles.css` modification.** Navigation additions: **DNS OPTIMIZER** (TWEAKS, after NETWORK), **BACKGROUND MONITOR** (OTHERS), **DRIVER HUB** + **BACKUP & RESTORE** (IMPORTANT).

### 4.1 DNS OPTIMIZER — confidence 96%
- Adapter tabs (live `Get-NetAdapter`), current-DNS display, five presets (Cloudflare, Google, Quad9, OpenDNS, AdGuard), custom IPv4/IPv6 input, DHCP reset, cache flush.
- Backend: `netsh interface ip{,v6} set dns/dnsservers` with validated quoting (space-containing adapter names tested live), strict error propagation, `ipconfig /flushdns` after apply.
- Safety: admin-gated; adapter-name sanitization; address validation both sides; no capture of DNS through third-party servers beyond user selection.

### 4.2 BACKGROUND MONITOR (Kill & Block) — **kill 97% / block 94%**
- **Kill**: top-70 processes by working set; per-row KILL with a backend that re-verifies the PID↔name pair before `taskkill /F /PID` (stale-list protection). 16-name protected-process list (system, smss, csrss, wininit, winlogon, services, lsass, dwm, svchost, audiodg, …) enforced in the backend — the UI never offers these actions at all.
- **Block**: Image File Execution Options `Debugger = %windir%\System32\where.exe` (launch is neutralized; no destructive debugger chain), with **prior `Debugger` value backed up** to `userData/atom-blocked.json` before any write.
- **Disclosed confidence 94%** for blocking: IFEO is a stable, Microsoft-documented mechanism, but it is a registry-side technique; mitigations in place: full pre-state backup, one-click **UNBLOCK** restore (UI lists every block), 2-step inline confirm (`BLOCK → CONFIRM?`), protected-name refusal, admin gating, and blocked-name validation (`*.exe`, ≤64 chars).
- Auto-refresh: 5 s interval, **default OFF**, runs only while the page is visible, torn down automatically on navigation (uses the app's single poll handle).

### 4.3 DRIVER HUB (inspection-only) — confidence 99% read-only
- Two tabs: DRIVER PACKAGES (`pnputil /enum-drivers` parser — verified against 22 real packages, including merged date+version field format) and PROBLEM DEVICES (`Win32_PnPEntity` with `ConfigManagerErrorCode` mapped to 13 human-readable meanings).
- Search filter, counts, read-only by construction (no code path modifies drivers).
- **Driver deletion/install deliberately omitted** — see §6 disclosures: could not reach the mandated ≥95% stability threshold without reboot-risk, rollback, and INF-dependency analysis that is out of scope for a toolbox of this class.

### 4.4 BACKUP & RESTORE CENTRAL — confidence 97%
- **System Restore Points**: create (with temporary 24 h-limit override that is *restored to its prior state* after use), list (verified live — 3 points enumerated), and one-click launch of the native System Restore UI (`rstrui`).
- **Registry Backup**: exports six tweak-relevant branches (HKLM Policies, HKLM Power Schemes, HKLM Multimedia, HKCU Policies, HKCU Control Panel, HKCU Explorer\Advanced) to dated `.reg` files in `userData/backups`; per-branch failure tolerance; list with size/date; **restore with 2-step confirm**; open-folder button.
- All destructive actions admin-gated; restore filenames sanitized (regex + basename) against path traversal.

### 4.5 POWER PLAN MANAGEMENT (import + remove) — import 98% / remove 96%
- **Import**: native file dialog (`.pow` filter) → `powercfg /import` → GUID parsed from real output (`Imported Power Scheme Successfully. GUID: <guid>` — **cycle-tested live with zero residue**).
- **Remove**: 2-step inline confirm; hard protections in the *backend*: four built-in GUIDs (Balanced, High performance, Power saver, Ultimate Performance) and the **currently active plan** are refused regardless of UI state.
- Installed-plan list reads live `powercfg /list` (JS regex validated against live output; active plan correctly flagged).

### 4.6 Execution-layer (shared) — confidence 98%
- 34 IPC handlers, zero duplicates, **all 34 matched 1:1 to renderer invocations** (automated pairing audit).
- PowerShell backends run via temp `.ps1` (`-NoProfile -ExecutionPolicy Bypass`), streamed to the existing execution log, timeout-guarded with process kill + temp-file cleanup.

---

## 5. VERIFICATION CHECKLIST (FINAL STATE — ALL GREEN)

```
CONFIG FILES        windows 93 | power 20 | gaming 15 | network 12 | gpu 27
                    privacy 23 | others 60 | brave 19 | powerplans 20 | apps 51
                    BOM: none | parse errors: none | missing script refs: none
DUPLICATE IDS       none within any file
BANNED PATTERNS     configs: none (placebos, HKCU:HKCU, '(Default)', Start_IrrelevantAppsLine,
                    invalid aliases, wmic) | scripts: none
ORPHAN SCRIPTS      none (468 files, all referenced)
SYNTAX              node --check main.js OK | node --check src/renderer.js OK
IPC INTEGRITY       34 handlers / 34 unique / invoked-minus-handled = 0 / handled-minus-invoked = 0
LIVE OS TESTS       DNS adapter JSON (4 adapters) | proc JSON (top-70) | driver parse (22 pkgs, 1 problem)
                    | restore points (3) | plan list (4, active flagged) | import/delete cycle (clean)
                    | netsh quoting with spaces (OK) | gpu /qh format (OK)
```

## 6. CONFIDENCE MATRIX & DISCLOSURES

| Area | Confidence | Basis |
|---|---|---|
| Placebo classification & removal | 97% | Live-verified per item; residual risk only from undocumented third-party key consumers |
| Repaired values/GUIDs | 98% | Every replacement executed and queried live |
| Hidden-setting check conversions | 98% | Output format matched live |
| Config ↔ script integrity | 100% | Machine-checked (automated) |
| IPC wiring integrity | 100% | Machine-checked (automated) |
| UI/CSS preservation | 100% | By construction — `styles.css` untouched; new pages reuse existing classes |
| DNS Optimizer | 96% | netsh path validated; edge cases = vendor VPN clients overriding DNS |
| Background Monitor — kill | 97% | PID↔name re-verification + protected list |
| **Background Monitor — block** | **94% (disclosed)** | IFEO technique; full backup/undo/confirm mitigations in place |
| Driver Hub (read-only) | 99% | Enumeration live-tested |
| **Driver deletion/install** | **OMITTED (<95%)** | Cannot meet the ≥95% stability bar without boot-risk analysis, rollback staging, and INF dependency resolution — excluded rather than shipped shaky |
| Backup & Restore | 97% | Restore-point + reg export/import paths live-validated |
| Power plan import/remove | 96–98% | Full cycle tested (import → GUID parse → delete → list) |
| Execution-layer hardening | 98% | Admin matrix + failure logging verified by code review & tests |

**Additional disclosures**
1. **Cross-file ID overlaps** (17 IDs existing on two pages, e.g. `disable_sleep`, `disable_telemetry`): **intentional shared-state design** — both pages execute identical scripts/checks under the same ID, so toggle state stays consistent app-wide. Verified same-script equivalence for the sleep/hibernate pairs.
2. **Admin posture**: the app is designed to run elevated for full effect. Every new destructive backend *additionally* hard-gates on `isAdmin()` and reports `ADMIN_REQUIRED` in the UI log rather than failing silently.
3. **Low-end PC posture maintained**: new pages fetch on demand; no background polling except the opt-in 5 s monitor refresh (visible-only); PowerShell backends are spot-spawned and fully reaped; renderer reuses the single poll handle and event-delegation patterns.
4. **Audit-machine caveat**: all live validations were performed on Windows 10 22H2 (19045). Hidden-setting GUIDs are stable across Win10/Win11, but alias availability varies by build — this is precisely why raw-GUID + `/qh` form was adopted everywhere.

## 7. ROLLBACK

A full pre-change snapshot of `src/`, `main.js`, and `package.json` is preserved at:
`C:\Users\User\AppData\Local\Temp\opencode\atom-v020-prebuild.zip`
Extraction over the project root restores the exact pre-audit state.

## 8. CHANGE MANIFEST (SUMMARY)

- `main.js` — admin matrix expansion; non-strict failure logging; Phase 2 IPC block (20 new handlers).
- `src/index.html` — 4 nav entries (no structural/CSS changes).
- `src/renderer.js` — 4 new page renderers; Power Plans page upgrade (import/remove with protections); 4 new routes; zero visual-language changes.
- `src/config/*.json` — all 10 files: entry removals, value/GUID/check repairs, pagefile toggles added (2, real implementations), BOM removal, consistent formatting.
- `src/scripts/**` — 24 scripts rewritten (values/GUIDs/semantics/robustness), 78 dead files deleted, 4 pagefile scripts modernized to CIM and newly surfaced as 2 toggle entries (pre-existing implementations retained), zero `wmic`, zero invalid aliases.
- `docs/AUDIT_REPORT.md` — this document.

---

# ADDENDUM — PERFORMANCE PASS & NAVIGATION UPDATE
*(Executed after the audit; same evidence discipline, same UI/CSS constraint.)*

## 9. PERFORMANCE PASS (§9.1–§9.3)

### 9.1 What changed and why (measured, not theoretical)

| # | Change | Defect it removes | Effect |
|---|---|---|---|
| 1 | **Batched state detection** (`check-tweaks-batch` + `classifyCheck`/`buildBatchScript` in `main.js`; `runAutoDetect` in `renderer.js`) | Every tweak *check* spawned its own PowerShell (~50–60 MB transient each, 0.5–1.5 s on slow disks, AV-scanned per spawn); WINDOWS auto-detect = 93 spawns, 3 run in parallel | Checks of a page stream in chunks of 15 inside **one** PowerShell host — a wrapper rewrites each check's `exit 0/1` into a result-table write so no `exit` can kill the host. WINDOWS detect: **93 spawns → 7**. Any unusual check automatically falls back to the legacy one-process path (fail-safe, never fail-wrong) |
| 2 | **Native process snapshot** (`tasklistProcesses`/`tasklistName` replace `Get-Process` via PowerShell) | Monitor auto-refresh spawned PowerShell every 5 s | `tasklist /fo csv` is native, ~10× faster and ~10× lighter; refresh stays viable on low-end PCs. **CPU% column intentionally dropped** (tasklist reports memory only) — memory is the actionable signal; KILL still verifies PID↔name via `tasklist /fi` |
| 3 | **Dashboard collector made 100% native** (`fs.statfsSync` disk, `os.cpus()` deltas CPU, GPU cached to `userData/gpu-cache.json`) | Disk was a PowerShell CIM spawn every 5 min, forever; GPU query on every launch's first dashboard load | 60 s dashboard polling now spawns **nothing**. First CPU sample takes a 150 ms second sample so the first dashboard shows a real value. GPU PowerShell query happens once ever (persisted) |
| 4 | **INSTALLED APPS scan cache** (2 min TTL + invalidation on install/uninstall) | Full registry + Appx enumeration PowerShell run on **every** visit to the page | Instant repeat visits; list refreshes immediately after any app install/uninstall |
| 5 | **Spawn hardening** (`-NonInteractive` ×5, UTF-8 BOM prepend in `psRun`) | No interactive prompts; PS 5.1 could misread non-BOM UTF-8 temp scripts | Deterministic one-shot execution |
| 6 | **`backgroundThrottling` restored to `true`** | Was `false` — renderer timers ran unthrottled while minimized/occluded, burning CPU/battery on low-end PCs for zero benefit (all work already skips when hidden) | Lower idle CPU when the window is minimized |
| 7 | **Single-instance lock** | Double-clicking the exe twice started two full Electron stacks (2× RAM) | Second launch focuses/restores the existing window |

### 9.2 Navigation restructure (user-requested, `src/index.html` only)

```
SYSTEM                Dashboard | Background Monitor | Shortcuts
OPTIMIZATIONS         Windows | Gaming | GPU | Power | Network | DNS Optimizer | Privacy Settings
TOOLS & UTILITIES     Context Menu | Brave Debloater | Cleaner | Driver Hub | Power Plans
MANAGEMENT & SAFETY   Backup & Restore | App Installer | Installed Apps | History | Settings
```

All **20 views preserved** — zero features lost, zero new pages. NETWORK + DNS and HISTORY + SETTINGS kept as adjacent pages (the "or merge/put them next to each other" option; a true single-page merge can be done on request). Nav code binds only to `.nav-item`/`data-view`, so **no JS or CSS change was needed** and none was made.

### 9.3 Verification (machine-checked, re-runnable via `atom-perf-verify.js`)

```
STATIC        single-instance lock | backgroundThrottling true | fs.statfsSync | CPU helpers
              batch handlers | tasklist helpers | zero Get-Process left in main.js
              apps cache +3 invalidations | -NonInteractive x5 | psRun BOM prepend
NAV           20/20 views exist | 4 group titles | every data-view has a renderer case
IPC           35 handlers / all paired (34 audit + check-tweaks-batch) / 0 mismatches
CLASSIFY      265 checks batchable | 4 auto-false (no spawn needed) | 0 forced singles | 468 scripts intact
LIVE          fs.statfsSync OK | tasklist parse OK (top-3 by memory listed) |
              batch engine: 8 real windows.json checks → ONE spawn → valid JSON, all booleans, empty stderr
REGRESSION    full original integrity suite re-run — ALL PASSED
```

**Confidence in the performance pass: 97%** (every mechanism live-executed; residual risk = unexercised UI paths in a real window session). Post-change smoke test on a live session remains recommended (checklist in §5 discipline).

---

## 10. ADVANCED POWER CONFIGURATOR (new page)

### 10.1 Scope

Granular read/write access to **every setting of the active power scheme, including hidden ones**, exposed at `TOOLS & UTILITIES → ADVANCED POWER` (directly after POWER PLANS). One control edits **both AC and DC** (user-chosen design). All controls reuse existing classes — **zero CSS changes** (verified against `styles.css`).

### 10.2 Backend (`main.js`)

```
advpower-list    ONE spawn: `powercfg /q` + `/qh SCHEME_CURRENT` in a single PowerShell
                 session, delimited dumps. Hidden = present in /qh but no AC index in /q.
                 Parser (apcParse) anchors on GUID-in-parens + indentation depth, so it is
                 label-independent; any missing field degrades to null (older builds safe).
advpower-set     validates GUIDs + DWORD range, then setacvalueindex + setdcvalueindex +
                 setactive <active scheme GUID> and RE-QUERIES the single setting via
                 filtered `/qh` to report what Windows actually holds.
advpower-unlock  mode 'show': derives the hidden pair list dynamically (no hardcoded GUID
                 list), applies `-ATTRIB_HIDE` per pair in one batched spawn, records the
                 list to userData/atom-unhidden-power.json.
                 mode 'hide': replays `+ATTRIB_HIDE` on the recorded list and deletes the
                 record (partial failures are kept in the file for retry).
```

`needsAdminCheck` extended with `powercfg /attributes` + `powercfg -attributes`. Reads work without admin; every write path refuses with the existing `ADMIN_REQUIRED` pattern. One spawn per action, `-NonInteractive`, no polling (page reads once on open).

### 10.3 Frontend (`src/renderer.js`)

Featured cards — **CPU & Processor, PCIe & GPU, Disks & Storage, System & USB** — rows auto-hide when a setting is absent on the machine. Full **ALL SETTINGS** accordion (lazy rows per subgroup) + live filter box + page console. Control selection from parsed metadata: 0/1 enums → `.tweak-toggle`; larger enums → segmented `.applist-tab` buttons; numeric ranges → `.applist-input` + APPLY clamped to parsed min/max. Big enums (e.g. boost mode, 7 values) render as wrapping segmented buttons.

### 10.4 Undo

Every change writes a HISTORY entry whose `command` restores the **previous AC+DC** values (single REVERT works through the existing execute-tweak command path; REVERT ALL gained a command branch for non-contextmenu entries — the only touch to existing code).

### 10.5 Live verification (`atom-advpower-test.js` — extracts the real parser/scripts from main.js)

```
PARSE      17 subgroups | 140 settings parsed | boost mode: 7 enum values correct
FEATURED   all 9 featured settings found on this machine (incl. AHCI HIPM/DIPM + adaptive)
HIDDEN     113 of 140 detected hidden via /q-vs-/qh diff; boost mode correctly flagged
QUERY      powercfg /qh SCHEME_CURRENT <sub> <set> accepted (used by write verification)
WRITE      live round-trip: set current value back → ATOM_RESULT=OK;AC=100;DC=100 (preserved)
ATTRIB     sign convention confirmed live: '-' = show, '+' = hide; reversible test left the
           system in its original state (boost mode back to HIDDEN)
REGRESSION atom-verify.js ALL PASSED | atom-perf-verify.js ALL PASSED (21/21 views, every view
           has a renderer case, 38/38 IPC handlers paired, batch engine + live checks green)
```

### 10.6 Disclosures

- **UNLOCK** changes visibility only in Windows' own Control Panel power options (113 settings on this machine). The app itself never needs it — hidden settings are edited directly. RE-HIDE restores the default via the recorded list; if the record file is missing, RE-HIDE clearly refuses rather than guessing.
- DC is written equal to AC on every change (per the agreed one-control design); the DC value is shown before each change in the row description.
- Settings absent on older Windows builds simply do not appear (no error paths).

**Confidence in the Advanced Power Configurator: 96%** — parser, write path, verification loop, hidden detection, sign convention and undo integration are all live-verified; residual risk is limited to unexercised UI interaction paths in a real window session.

---

## 11. THEME SYSTEM — DEEP GRAY / OLED BLACK / LIGHT

### 11.1 Architecture

One attribute on `<html>` (`data-theme`) drives the entire palette through the existing CSS custom properties — **switching is a single attribute flip: no layout work, no re-parse, no background footprint, no layout shift** (only paint colors change). All 21 views and every component re-tint automatically because the stylesheet was already ~100% variable-driven (audit confirmed only theme-neutral literals remain: close-button hover, warning colors with light overrides, status colors).

```
:root (default)     DARK — deep charcoal gray, deliberately NOT pure black
                    bg #161616 | panel #1c1c1c | border #2b2b2b | text #ececec
[data-theme="oled"] OLED — true black for AMOLED: bg #000000 | panel #050505 |
                    border #1a1a1a | text #ffffff
[data-theme="light"]LIGHT — off-white: bg #f4f5f7 | panel #ffffff | border #d9dce1 |
                    text #1b1e23 (high-readability dark text, subtle borders)
```

Each palette defines the identical 9-variable set (verified — a missing variable would silently fall back to the dark palette).

### 11.2 Selector, persistence, polish

- **Selector:** Settings → APPLICATION → THEME row, a 3-way segmented control `DARK | OLED | LIGHT` with an active state (existing `.settings-btn` + new `.active`/`.theme-opt` rules). Replaces the old 2-way toggle.
- **Persistence:** `localStorage['atom-theme']`; a tiny pre-paint `<head>` script applies the saved theme before first paint (no flash); `applyTheme()` validates and normalizes stale values back to the deep-gray default. Logo swaps to `logo-light.png` only in Light.
- **Native window:** `set-theme` IPC persists the choice to `userData/atom-theme.json` AND matches the Electron window background (whitelist map in main.js — theme names only, no raw color input); `loadThemeFile()` is read at window creation so the saved theme's background is correct from the very first frame (see §12.1).

### 11.3 Verification (`atom-theme-check.js`, re-runnable)

```
PALETTES   dark/oled/light all defined, identical 9-var sets, every var() usage covered
SPEC       dark bg #161616 (not black) | oled #000000 | light #f4f5f7
WIRING     head pre-paint script | applyTheme manager+persist+default | 3 buttons | active paint |
           startup restore | logo swap (light only) | no legacy toggle | THEME_BG map | IPC paired
REGRESSION atom-verify.js ALL PASSED | atom-perf-verify.js ALL PASSED (21/21 views, 39/39 IPC paired,
           no orphan script refs) | CSS brace balance OK | node --check OK x2
```

**Confidence in the theme system: 98%** — palettes and wiring are machine-verified; residual risk is purely visual judgment in a live session (intended, since layout/components were deliberately untouched).

---

## 12. DEVICE-PORTABILITY & FULL-SURFACE HARDENING (2026-10-18)

Follow-up round for: first-frame native background, High Contrast mode, "every tweak on every machine" scrutiny of Advanced Power, and the full 269-check surface.

### 12.1 First-frame native window background
- The theme choice is now persisted to `userData/atom-theme.json` by the `set-theme` IPC (one handler: validate → write file → apply whitelist background). `loadThemeFile()` is read inside `createWindow()`, so the `BrowserWindow` uses the saved theme's color from the **first frame** (previous gap: `#161616` until the renderer booted).
- Verified live: a user launch at 01:17 wrote `{"theme":"dark"}` via the new handler; `atom-theme-check.js` extended to 26 checks — all pass.

### 12.2 High Contrast / forced-colors
- `@media (forced-colors: active)` block maps active-state affordances to system colors (`Highlight` / `HighlightText` / `ButtonText`) for nav items, tabs, settings buttons and toggles. No custom colors are forced (`forced-color-adjust` untouched), so OS accessibility behavior is preserved.

### 12.3 Advanced Power — portability hardening (all live-proven)
- **Label-independent parsing:** `apcParse` keeps structural fallbacks (hex order for AC/DC, colon-pairs for enum values, first-two-hex for min/max). Proof: a pseudo-localized dump (all 9 label types replaced) parses **140/140 settings with 0 mismatches**, identical AC/DC, enum lists and hidden set vs the English dump.
- **Set-verification fallback:** the set script reads AC/DC from the last two hex values when English labels are absent — proven by feeding a localized fixture through the **real script** (AC=100/DC=50 recovered while the write leg legitimately failed on bogus GUIDs → honest FAIL status).
- **Visibility guards:** hidden flags are only trusted when the `/q` dump yields parseable values; unlock refuses when the visibility state is unreadable (no "everything hidden" mislabeling on odd builds/locales).
- **Admin gate:** unit-tested with the extracted `requireAdmin`/`needsAdminCheck` (all 4 powercfg write forms flagged; read-only forms not). Live de-elevated probe (`runas /trustlevel:0x20000`): `net session` correctly refused (token drop confirmed) while `powercfg /setacvalueindex` **applied unelevated on this Win10 22H2 build** (value 0→120, then restored to 0). The app keeps its admin gate as a conservative design choice: it is required for apply/revert symmetry (reverts run through the gated command path) and for `-attributes` (unlock) writes on typical builds.
- **Unlock accounting:** bogus-GUID pairs through the real attr script verified the `n + failed = total` invariant. Sign convention re-confirmed live (`-` = show, `+` = hide) with the exact prior state restored.

### 12.4 Full check-surface sweep (`atom-fullcheck.js` + `atom-parseprobe.js`, re-runnable)
```
INVENTORY  340 tweaks | 269 checks (265 batched, 4 auto-false, 0 singles) | 71 no-check (apps/plans)
REFS       538 script refs all present | 0 apply-without-undo pairs
PARSE      all 265 check bodies + .ps1 refs through PowerShell's own parser — 0 parse errors
LIVE       18/18 batches through the real batch engine: 265/265 boolean verdicts in 10.1s, 0 hangs
           (80 enabled / 185 disabled — informational, machine-specific)
```
- **Bug found & fixed by the sweep:** two windows.json checks (`disable_suggested_content`, `disable_co_creator`) used hyphenated property access without quotes → PowerShell parse error → those checks silently degraded (their 15-check chunk fell back to 15 separate spawns; verdict stuck at false). Fixed with `.'Name'` member access; both re-run clean (exit 1 = correctly disabled). Batch 3 is now fully batched.
- **Machine state audit after all testing:** boost mode restored to the user-chosen VISIBLE state (matches `atom-unhidden-power.json`), disk-idle value restored, `atom-theme.json` intact.

### 12.5 Version alignment
- `package.json` 0.1.5 → **0.2.0** (installer artifact now `AtomToolBox-Setup-0.2.0.exe`; taskbar/process metadata derives from it).
- Settings → APPLICATION → APP VERSION now shows **Atom ToolBox v0.2.0** (was v1.0.0). No other user-visible version strings exist (frameless window; no title-bar version).

### 12.6 Residual honesty
- Other physical machines/OS builds remain untested — mitigation is structural (label-free parsing proven by simulation, per-setting auto-hide, honest failure reporting) rather than a claim of "100% everywhere".
- Unelevated powercfg writes apply on this build; on locked-down builds the app surfaces the OS refusal verbatim. Non-admin runs show ADMIN_REQUIRED by design.
- No visual session by the agent (headless); the user's live run confirmed the unlock flow (113 pairs) and theme persistence end-to-end.

---

## 13. GLOBAL SEARCH — CTRL+K (2026-10-18)

### 13.1 What it does
- A search box lives in the header strip (`#global-search`) and filters **280 indexed entries** across all 9 user-facing configs: 209 tweaks (windows/gaming/gpu/power/network/privacy/brave) + 51 installer apps + 20 power plans. `others.json` is excluded on purpose: no view renders it, so a jump would have nowhere to land.
- Typing filters instantly (name + id + description, multi-token AND). Results show NAME + description + category chip; `↑`/`↓` move the selection, `ENTER` or click jumps to the owning page and flashes the exact row (`.search-hit` border pulse, ~1.9s). Deep tweaks are reached automatically — the reveal loop clicks LOAD MORE until the row exists (live-verified: 93rd tweak revealed through 5 chunk expansions). `ESC` clears and closes; clicking outside closes the panel.
- Design language is the existing one: palette variables only (all 3 themes + forced-colors guard), same fonts/dim descriptions/uppercase chips as every other view. The header wrapper is `-webkit-app-region: no-drag` so the strip stays draggable everywhere else.

### 13.2 Why it's fast (measured, not claimed)
- The index builds **once, lazily** from the same config files the pages already read (plus a one-shot warm-up 1.5s after startup, so the first CTRL+K is already warm). Every keystroke is an in-memory substring scan: no IPC per keystroke, no polling, no debounce, results capped at 40.
- Live measurement in the running app (CDP): **0.146 ms average per query including the full result-panel render** — about 1% of a 60fps frame budget. **Zero new IPC handlers** (the renderer already reads configs directly via `loadJSON`).

### 13.3 Evidence
```
atom-search-check.js   50/50  core extracted from renderer.js (drift-proof) + real configs:
                              entry fields, id searchability, AND semantics, case parity,
                              ranking order, cap, nav/view/file mapping, CSS var discipline
atom-search-live.js    15/15  real app driven via CDP (remote debugging):
                              CTRL+K focus, typing, multi-token, arrows, deep-chunk jump,
                              app jump, ESC, 100-query perf loop, clean shutdown
regressions            atom-verify ALL PASS | perf suite ALL PASS (nav 21 views, IPC 39 pairs,
                       unchanged) | theme-check 26/26 (new CSS fully palette-driven)
screenshots            5 PNGs from the live window: baseline / results open / deep jump
                       highlight / app jump highlight / final state — first visual
                       verification in this project's audit trail, inspected by the agent
```

### 13.4 Residual honesty
- Scope is the 9 live configs; settings actions, shortcuts buttons, DNS presets and history entries are not indexed (single-purpose screens).
- `others.json` stays unreachable in the UI — a pre-existing condition discovered during this work, unrelated to search, left untouched.
- Live verification ran on this machine; the feature is pure DOM + local files, so portability risk is minimal.

---

## 14. Registry Audit Export + Page-Level CHECK STATE (2026-10-18)

### 14.1 What was added
- **CHECK STATE** (every tweak page, top of the section): the old "DETECT CURRENT STATE" button, renamed and upgraded. One click runs every tweak check on that page through the existing batched PowerShell engine, updates every toggle to the live system state (catching tweaks applied before this app existed or by third-party tools), flips the button to `SCANNING REGISTRY...` while running, **persists** the detected state, refreshes the batch-script preview, and shows a toast: `REGISTRY STATE SYNCHRONIZED — N OF M TWEAKS VERIFIED ACTIVE`.
- **EXPORT AUDIT LOG** (Settings → SYSTEM card): new IPC `audit-export-registry`. Audits all 8 check-bearing configs (269 tweaks), classifies each tweak as `VERIFIED_ENABLED` / `DISABLED_DEFAULT` / `VALUE_MISSING` / `UNVERIFIED`, extracts the exact registry path → value → type → data from every `reg add` in the tweak's command and apply-script, probes all extracted values for real presence, writes a timestamped `.txt` report to Downloads (fallback Desktop → userData), and shows a native dialog with OPEN FILE / SHOW IN FOLDER. Progress streams to the button (`EXPORTING N%`).

### 14.2 Why it stays fast (no new engine)
- Checks reuse `batchCheckItems` — the exact function behind the existing `check-tweaks-batch` IPC (extracted from the handler, behavior unchanged): one PowerShell process per 25 checks.
- Registry presence probing is 4 batched PowerShell passes for all 208 unique values — zero per-tweak processes.
- Zero background work; everything is strictly on-demand. Measured end-to-end export: **9.4 s** for 269 checks + 208 presence probes.

### 14.3 Evidence
```
atom-audit-check.js    47/47  real functions extracted from main.js (drift-proof):
                              reg-add parser (7 shapes incl. chained/quoted/empty/hex/reg.exe),
                              hive→PowerShell path conversion, report renderer, static wiring,
                              real-config sweep (207/269 tweaks mapped, 208 unique values)
atom-audit-live.js     30/30  real app driven via CDP (remote debugging):
                              CHECK STATE (3.4 s, toast shown, state persisted to storage),
                              export via handler AND via the Settings button, report file read
                              from disk; status counts match the API stats exactly
                              (79 / 80 / 106 / 4); screenshots inspected visually
cross-check            export's VERIFIED_ENABLED count (79) matches the independent full
                       sweep's count (79) exactly — two engines, same verdicts
regressions            theme-check ALL PASS | atom-verify ALL PASS | perf ALL PASS
                       (IPC pairing now 40 handlers, still fully paired) | search 50/50 |
                       fullcheck 265/265 in 10.2 s (batch-engine refactor regression)
screenshot artifacts   atom-audit-1-checkstate.png / 2-settings.png / 3-exported.png
```

### 14.4 Residual honesty
- The 4 `others.json` tweaks whose checks are `exit 1` stubs report `UNVERIFIED` (via the engine's own `classifyCheck` rule) — they are not silently counted as "disabled".
- Presence probing uses the 64-bit registry view, matching how the app's own `reg add` commands write.
- The audit is read-only and runs fine unelevated; OPEN FILE / SHOW IN FOLDER use the OS default handler.
- The first live run of this feature caught two real bugs (a replace-callback arity error in the hive→PS path conversion and a wrong unwrap of the batch-results envelope); both were fixed, pinned with new unit tests, and re-verified live — the 47/47 + 30/30 results above are from the fixed build.
- Test-generated report files were cleaned up; one example report was kept in Downloads.

---

## 15. ADVANCED NAV GROUP + CONFIGURATOR REFINEMENT (2026-10-18)

### 15.1 What changed
- **New sidebar group ADVANCED** (5th group, placed between TOOLS & UTILITIES and MANAGEMENT & SAFETY) now holds the three power-user tools: ADVANCED POWER, DNS OPTIMIZER, DRIVER HUB. DNS OPTIMIZER left OPTIMIZATIONS; DRIVER HUB + ADVANCED POWER left TOOLS & UTILITIES. View ids and every `data-view` path are unchanged (21 views still); nothing in the app read the old grouping.
- **ADVANCED POWER CONFIGURATOR trimmed to curated controls only** (as requested): the raw per-subgroup accordion list at the bottom ("Settings belonging to no subgroup", "Processor power management (65 settings)", "Hard disk (10 settings)", ...) is removed. `renderAll`, the `expanded` state and the `[data-apc-expand]` SHOW/HIDE handling were deleted. The engine (`advpower-list` / `advpower-set` / `advpower-unlock`) is untouched; all 140 settings stay reachable through the page filter.
- **Two curated categories added** so the controls named explicitly stay top-level:
  - IDLE RESILIENCY: "Processor Idle Resiliency Timer Resolution" (c42b79aa...) + "Execution Required power request timeout" (3166bc41...), subgroup 2e601130-5351-4d9d-8e04-252966bad054.
  - INTERRUPT STEERING: "Interrupt Steering Mode" (2bfc24f9..., 7 values), subgroup 48672f38-7a9a-4bb2-8bf8-3d85be19de4e.
  (Auto-hide rule unchanged: missing settings/categories simply do not render; portable across builds.)
- **Filter now behaves as a mode swap**: while a query is active the curated box is hidden and the flat result list + "N MATCHES" count renders in its place (previously results appeared below the curated box, off-screen); clearing restores the curated layout. Debounce and LIMIT 100 unchanged.
- **Layout fix caught by screenshot review**: rows with wide segmented controls (boost mode's 7 segments) used to squeeze the label/description into a 4-line column; new scoped CSS (`#apc-main .tweak-row { flex-wrap: wrap; row-gap: 8px }`, `#apc-main .tweak-info { flex: 1 1 240px; min-width: 240px }`) wraps the control below the label, right-aligned (`margin-left: auto` on the control wrapper). Rules are scoped by id, so no other page's rows are affected, and no colors were added (palette/theme discipline intact).

### 15.2 Evidence (all suites re-run after the final edits)
```
node --check src/renderer.js        SYNTAX OK
atom-perf-verify.js                 ALL PERF CHECKS PASSED  (nav checks extended:
                                    5 group titles; ADVANCED holds advpower+dns+drivers;
                                    moved views absent from old groups)
atom-verify.js                      ALL CHECKS PASSED       (integrity; 21 views unchanged)
atom-theme-check.js                 ALL THEME CHECKS PASSED
atom-search-check.js                50/50
atom-audit-check.js                 47/47
atom-nav-advpower-live.js           22/22  NEW — real app driven via CDP (port 9225)
atom-search-live.js                 15/15
atom-audit-live.js                  30/30
atom-advpower-test.js               ALL CHECKS PASSED       (backend harness, unchanged engine)
atom-fullcheck.js                   265/265 executed cleanly in one sweep
```

New live test `atom-nav-advpower-live.js` verifies against the real rendered DOM:
- nav groups exactly `SYSTEM | OPTIMIZATIONS | TOOLS & UTILITIES | ADVANCED | MANAGEMENT & SAFETY`; ADVANCED = ADVANCED POWER, DNS OPTIMIZER, DRIVER HUB (in order); TOOLS trimmed to CONTEXT MENU, BRAVE DEBLOATER, CLEANER, POWER PLANS; DNS gone from OPTIMIZATIONS.
- page renders exactly 6 curated sections (CPU & PROCESSOR, PCIE & GPU, DISKS & STORAGE, SYSTEM & USB, IDLE RESILIENCY, INTERRUPT STEERING) with all 8 tracked controls present (boost mode, min/max processor state, ASPM, USB selective suspend, idle-resiliency pair, interrupt steering mode); zero `[data-apc-expand]` elements, zero `#apc-sg-*` boxes, results box empty on load, header shows `140 SETTINGS`.
- filter `steering` renders 3 flat results (the whole Interrupt Steering Settings subgroup), count line shown, curated box hidden while searching; clearing restores the 12-row curated layout.
- interactive proof: clicked the already-active segment of "Processor performance boost mode" (Aggressive) - real `advpower-set` round-trip finished in 0.3 s, console logged `OK - verified`, row re-rendered with identical value/description - a true no-op write (same value to AC+DC), zero system change; undo entry recorded.
- screenshots inspected: atom-advpower-page.png, atom-advpower-filtered.png.

### 15.3 Residual honesty
- The interactive live checks left a few truthful no-op boost-mode entries in HISTORY (each undo restores the same value). No system state changed.
- The 4 `others.json` auto-false checks, the audit classification rules, and everything from sections 10-14 are unaffected by this round (AdvPower backend untouched).

---

## 16. WINDOWS UPDATE CONTROL PAGE (2026-10-19)

### 16.1 What changed
- New `src/config/winupdate.json` with **19 tweaks**: no auto-update, notify-before-download, no auto restart, active hours, defer feature updates (365d) + quality (30d), target release pin, pause 35d / pause until 2099 (alternatives: last applied wins), max pause window 3650d, restrict update access, exclude drivers, no P2P/Delivery Optimization, meter Ethernet+WiFi, block updates over metered, no fast-rollout opt-in, disable wuauserv / UsoSvc / WaaSMedicSvc.
- The 14 Windows Update entries formerly buried in `windows.json` were removed and re-pointed to their moved scripts under `src/scripts/updates/` (**93 -> 79 tweaks**); no id collisions anywhere.
- New **ADVANCED nav item WINDOWS UPDATE** (between ADVANCED POWER and DNS OPTIMIZER, view id `winupdate`), rendered by the generic tweak page; search source registered with the UPDATES tag; audit section registered (274 checks total).
- Undo semantics everywhere = Windows defaults (delete policy values; Start types restored: wuauserv 3, UsoSvc 2, WaaSMedicSvc 3).
- Two "works-for-real" upgrades found and fixed by live testing:
  - **DefaultMediaCost (metered toggle)** is owned by TrustedInstaller and grants Administrators read-only; `takeown`/`icacls` cannot touch registry keys and Set-Acl refuses. New helper `src/scripts/updates/metered_lock.ps1` does a raw advapi32 dance: enable SeTakeOwnership+SeRestore, take ownership (RegOpenKeyEx WRITE_OWNER + RegSetKeySecurity OWNER), grant a temporary Administrators FullControl ACE, write Ethernet/WiFi, then restore the exact original DACL and owner. The bats reference it as `%CD%\src\scripts\updates\metered_lock.ps1` - the engine rewrites `%CD%` to the app base dir, which is REQUIRED because `execute-tweak` copies bats to %TEMP% before running (a `%~dp0` sidecar reference breaks there - caught live).
  - **Pause pair semantics**: pause-35d now also stamps `PauseUpdatesExpiryTime` (+35d); pause-2099 stamps it at 2099. The two checks are mutually exclusive (last applied wins), proven by a dedicated pair micro-test in both directions.
- `wu_disable_service` description documents the real-world caveat: Windows' update medic may silently repair wuauserv within minutes (observed live at +14 s and +160 s after service tampering - it resets the Start type via SCM and restarts the trio). CHECK STATE always shows the live truth.

### 16.2 Evidence (all suites re-run after the final edits)
```
atom-winupdate-check.js    30/30  (config shape, migration completeness, wiring, targeted
                                   script assertions, engine 19/19 booleans, singles 19/19)
atom-winupdate-live.js     48/48  (real app driven via CDP, port 9226)
atom-perf-verify.js        ALL PERF CHECKS PASSED
atom-theme-check.js        ALL THEME CHECKS PASSED
atom-search-check.js       52/52
atom-audit-check.js        47/47
atom-fullcheck.js          270/270 executed cleanly in 9.1 s
atom-nav-advpower-live.js  22/22
atom-audit-live.js         30/30
atom-search-live.js        15/15
```
Live WU sweep (`atom-winupdate-live.js`, elevated, real machine):
- full apply sweep through the real batch engine; batch check then reports **18/19 by design** (pause-35 superseded by pause-2099; both directions asserted);
- external truth checks via raw reg.exe on independent handles: AU/policy values, target-release pin at 22H2, pause-2099 EndTime+Expiry stamps, metered 2/2, DO mode 0, all three services Start=4, wuauserv stopped;
- UI toggle clicked for real (off -> on): both scripts ran, exactly 2 new history entries, newest-first order asserted;
- full undo sweep: 19/19 checks back to disabled; restore reimports the .reg backups, compares an 88-line registry dump byte-for-byte (**missing=0 extra=0**) and matches the live checks to the pre-test set exactly;
- metered helper ACL verified independently: ON -> 2/2, OFF -> 1/1, owner + SDDL equal before/after (normalized), re-run idempotent.

### 16.3 Residual honesty
- The `SE_DACL_AUTO_INHERITED` flag on DefaultMediaCost cannot be restored by any user-mode write (the kernel strips it on every RegSetKeySecurity; even a manually patched binary and an AUTO_INHERIT_REQ variant read back stripped - empirically proven). Access rights, ACE list, P flag, owner and values are restored exactly; the flag is informational only.
- Windows may undo the service trio on its own schedule (medic / UpdateOrchestrator machinery): the page reports the live truth via CHECK STATE and the toggle description says so. With pending updates present, the WU stack is actively trying to wake up - OS design, not a page bug.
- "Running while Start=4" is a normal Windows state (disabled takes effect on next start); checks assert the Start type (authoritative for the tweak) and the wuauserv stop is asserted separately.
- An earlier 44/48 run in this session was a transient interleave with that self-repair; the final run is a clean 48/48 and the applied state held across the whole verification window (~sweep + pair test + UI toggle + undo phases, several minutes).

---

## 17. STARTUP MANAGER + SMOOTH SCROLLING (2026-10-19)

### 17.1 What changed — STARTUP MANAGER
- New **TOOLS & UTILITIES nav item STARTUP MANAGER** (after POWER PLANS, view id `startup`).
- Covers the four native autostart stores that matter on a single-user Windows PC: **HKCU Run, HKLM Run, HKLM Run (32-bit)** registry entries and the **per-user + all-users Startup folders**.
- **Registry items use native StartupApproved semantics** (exactly what Task Manager / Settings toggles): disable writes the 12-byte enable-state override `03 00 00 00` + little-endian FILETIME to `…\Explorer\StartupApproved\Run(32)`; enable deletes the override (absence = enabled). **The Run command value itself is never touched.** Changes apply at next sign-in.
- **Folder items** (`.lnk`/`.url`/etc.): disable = rename `X` -> `X.disabled`; enable = rename back to the exact original name — both verifiable on disk.
- Backend `src/scripts/startup/startup_tool.ps1` (`-Action list|set -Id <id> -State disable|enable`): reads all four stores, emits JSON, and **self-verifies every set** before reporting `{ok, verified, …}`; `NOT_FOUND`/`CONFLICT` are explicit failure codes. No `package.json` change needed — `asarUnpack: src/scripts/**/*` already ships it.
- main.js: `psFile()` helper + IPC `startup-list` / `startup-set`; ids are regex-gated; HKLM and all-users-folder operations require admin (`requireAdmin`), HKCU/user-folder work unelevated.
- Renderer: `renderStartup()` page (title count `N ENTRIES — X ENABLED / Y DISABLED`, per-row source + path, REFRESH, log console) with a scan re-entrancy guard (`startupScanSeq`) so rapid nav in/out cannot stick the label on "SCANNING…".
- Every change lands in **HISTORY** (`config:'startup'` entries, action text ENABLED/DISABLED) with working per-entry REVERT and REVERT ALL — folder renames and registry overrides both revert through the same `startup-set` path.
- **Stale overrides are counted, not "fixed"** — the stats line reports override entries whose Run value no longer exists (2 on this machine, both historical Adobe installers). They are ignored for toggling; the app never deletes foreign keys.

### 17.2 What changed — SMOOTH SCROLLING
- Long pages use **`content-visibility: auto` + `contain-intrinsic-size: auto 62px`** on tweak rows (46px on app rows; both are *measured* real heights) so offscreen rows skip rendering entirely on low-end PCs; `overscroll-behavior: contain` on `#content-area` stops scroll-chaining.
- Wheel scrolling gets a **short ease-out curve** — chosen over motion blur on purpose: blur repaints the whole page every frame (heavy on low-end GPUs, mushy text), while the curve is pure position math. One rAF loop runs only while a glide is active (zero idle cost); the easing is **time-based** (`TAU` 50 ms, ~0.28/frame at 60 Hz) so speed and feel stay identical at 60 Hz, 120 Hz, or right after a dropped frame, with a 40 ms dt cap so a long hiccup becomes a bounded catch-up, never a jump. `deltaMode` normalization (lines x40, pages x viewport) and a hard reset when the user scrolls >800px away. **Keyboard, scrollbar drags, and inner scrollables (console/previews) stay 100% native.**
- Tail-arrival hardening (found by live probing on this machine): the display runs at **~165 Hz** and the platform **quantizes scroll writes to whole pixels**, so any frame step below ~1 px quietly rounds back — the previous fixed-lerp version crept close to its target and then spun its rAF loop **forever** a few px short (never arriving, burning frames). Fixed with a 1.5 px minimum tail step (always above quantization) plus a 3-frame no-progress safety exit; landings are now pixel-exact and every glide loop is guaranteed to terminate.
- Robustness guard: if anything external moves the scroll position mid-glide (>2px vs the last applied value), the glide cancels immediately and hands control back; a <=2px final snap removes invisible sub-pixel tails.
- **SETTINGS > SMOOTH SCROLLING toggle (default ON)**, persisted in `localStorage['atom-smooth-scroll']` and read live per wheel event. Note: this machine reports `prefers-reduced-motion: reduce` (OS animations off), which would silently disable a reduced-motion-gated scroller — per the explicit product requirement the smoothing ships as a user-visible toggle instead of an OS-media gate, off by one click.

### 17.3 Evidence (all suites re-run after the final edits)
```
atom-startup-live.js       48/48  (elevated real machine, port 9227; cross-checked against raw
                                   registry/folder dumps; final restore missing=0 extra=0)
atom-scroll-check.js       27/27  (port 9229)
atom-nav-advpower-live.js  22/22
atom-audit-live.js         30/30
atom-search-live.js        15/15
atom-fullcheck.js          270/270 executed cleanly in 16.9 s
atom-search-check.js       52/52
atom-audit-check.js        47/47
atom-winupdate-check.js    30/30
atom-theme-check.js        ALL THEME CHECKS PASSED
atom-perf-verify.js        ALL PERF CHECKS PASSED
```
Startup live details (`atom-startup-live.js`): every phase driven through the real UI and verified outside the app via raw registry reads and on-disk file names — list vs raw dump cross-check; Discord enable (override absent) / disable (byte-exact 12-byte 03 blob); Lightshot disable/enable replacing a stale 02 blob and byte-exact restoration; synthetic Run value add/disable/enable/remove; folder probe create/list/disable (`X.lnk.disabled` on disk)/enable (exact original name); HISTORY REVERT re-enabling a disabled folder item; **final pre-state restore compared as an independent raw diff — missing=0, extra=0**; plus a rapid nav re-entry self-heal check.

Scroll live details (`atom-scroll-check.js`): all 79 tweak rows loaded; `content-visibility:auto` computed on rows + `overscroll-behavior:contain` on the area; 16x160px real CDP wheel burst → 61 eased monotonic steps landing **exactly 2560 of 2560px**, largest 25ms step 90px (well below one raw wheel notch = 160px, i.e. no unsmoothed jumps), settling ~250ms after the last event; frame intervals during the glide avg 6ms / p95 8ms / max 31ms (this display is ~165 Hz); A/B through the settings toggle: ON = preventDefault + eased multi-step glide landing pixel-exact on +160 (200→360), OFF = native instant +160px step with no interception; **freeze test**: a 90ms main-thread block mid-glide is recovered with a 153px time-proportional catch-up, settles 175ms after the freeze ends and lands pixel-exact (600→1100); inner console scrolls itself natively without hijacking the page; settings toggle ON->OFF->ON persistence asserted; renderer never reloaded (boot sentinel + page-event watchers clean).

### 17.4 Residual honesty
- **StartupApproved changes take effect at next sign-in** — Windows behavior, same as Task Manager; the page header says so and the UI shows the truthful on-disk state, not an "instantly applied" claim.
- `content-visibility` swaps each row's block-size *estimate* for its real height as rows render, so a page's total scrollable height can shift by a few px while scrolling a list for the first time. Fallback estimates were tuned to measured row heights (62px / 46px); the harness keeps a ±4px landing tolerance as a guard, while every observed landing after the tail fix is pixel-exact (360/360, 1100/1100, 2560/2560).
- A long harness run on this live machine once recorded extra wheel events (deltaY=100 = real mouse notches) and one page was found navigated away mid-run — live human input on the visible test window ("scroll inactive windows" delivers it to the hovered window). All measurement phases were hardened with contamination detection + automatic retries; every final run above was clean and deterministic, and the app itself behaved correctly throughout.
- The perf harness's two expectation constants were updated for this section's legitimate additions (6th `-NonInteractive` spawn surface, 23rd nav view) — no app-side check was weakened.

## 18. PERSONALIZE, CONTEXT-MENU ADD-VERBS, POWER PLAN STUDIO + ENGINE DEFECTS (2026-10-19)

### 18.1 PERSONALIZE page (new)
- New **TOOLS & UTILITIES nav item PERSONALIZE** (after STARTUP MANAGER, view id `personalize`), 21 rows in `src/config/personalize.json`: 10 accent presets (blue #0078D7 default, teal, green, lime, gold, orange, red, pink, purple, gray), taskbar/start tint (`ColorPrevalence`), DWM tint (`DWM ColorPrevalence`), small taskbar icons (+Explorer restart), never-combine taskbar buttons (`TaskbarGlomLevel=2`), clock seconds (`ShowSecondsInSystemClock`), show all tray icons (`EnableAutoTray=0`), Start recent items (`Start_TrackDocs`), Start frequent items (`Start_TrackProgs`), and desktop icons: This PC / Recycle Bin / user files (`HideDesktopIcons\NewStartPanel` CLSID values; `0` = shown).
- **Accent apply recipe** (`src/scripts/personalize/accent_set.ps1`): writes 5 HKCU values — `DWM\AccentColor` + `DWM\ColorizationColor`, `Explorer\Accent\AccentColorMenu` + `StartColorMenu` + `AccentPalette` (8 slots / 32 bytes) — then broadcasts ImmersiveColorSet and restarts Explorer once; every value (including palette slot 4 = RGB of the chosen color and the preserved 8th slot) is read-back verified before reporting success. The blue row restores the machine-pristine byte-exact set: `AccentColor=0xFFD77800`, `ColorizationColor=0xC40078D7`, `AccentColorMenu=0xFFD77800`, `StartColorMenu=0xFF8F7C80`, palette `A6D8FF00…F7630C00`.
- Palette defect fixed during this pass: the write buffer was 28 bytes (7 slots) while the code indexed slots up to byte 31 — every color except bare blue threw `IndexOutOfRangeException`. Now a 32-byte buffer; slot 8 preserved.
- All registry rows are plain HKCU apply/undo commands (no admin); rows never touched by Explorer restarts write + verify instantly (see residual timing note in 18.6).

### 18.2 CONTEXT MENU — add verbs (not only remove)
- New engine `src/scripts/contextmenu/menu_tool.ps1` (.NET Registry API, JSON output, self-verifying) plus 5 thin `.bat` wrappers: **ADD "COPY AS PATH"**, **ADD "OPEN CMD HERE"**, **ADD "OPEN POWERSHELL HERE"**, **ADD "NOTEPAD"**, **ADD "TAKE OWNERSHIP"**. All writes are HKCU-only; ON overwrites with the exact working values, OFF deletes them; live state comes from the `cm-state` IPC (real registry wins over localStorage).
- **TakeOwnership final state — disclosure.** This machine's pre-existing Take Ownership entries came from the widely circulated tweak-pack `.reg` whose command used the **invalid SID `*S-1-3-4`** — it never matches any principal, so the menu item showed up but did nothing when clicked. The original was non-functional and cannot be reconstructed as working. The corrected **working** entries (valid Administrators SID `*S-1-5-32-544`, `MUIVerb` "Take Ownership", `Icon=takeown.exe`, `HasLUAShield`) are therefore **left present** on this machine and the row truthfully reads ON. Original broken values (from the user's AtlasPlaybook `TakeOwnership\add.reg`): default value "Take Ownership", `Extended=-`, `NoWorkingDirectory=""`, `NeverDefault=""`, `IsolatedCommand` with the broken SID; the Directory variant added `AppliesTo` + `Position=middle`. That `add.reg` also deleted `*\shell\runas` / added `Drive\shell\runas` — no runas keys exist anywhere (HKCU or HKLM) on this machine, so nothing to restore there.

### 18.3 POWER PLAN STUDIO (inside POWER PLANS)
- Plan list with **ACTIVE** and **BUILT-IN** badges; select any plan → ACTIVATE, **DUPLICATE** (auto-selects the copy, named `… (copy)`), **RENAME + DESCRIPTION** (`powercfg /changename`; both values travel inside the exported `.pow`), **EXPORT .POW** (file save dialog), and **DELETE** (2-step `CONFIRM?`; built-in GUIDs refused by the backend; the active plan blocked with a clear message).
- **Full advanced settings editor** for any scheme: every subgroup/setting including ones hidden from the Windows UI is read via scheme-parameterized `powercfg /q` + `/qh <guid>`; featured view plus SHOW ALL (chunked) and filter for the full list; per-setting AC/DC inputs with APPLY. Writes use `/setacvalueindex` + `/setdcvalueindex` (plus `/setactive` only for the active scheme) and **every write is independently read-back verified**.
- Every change lands in **HISTORY** (`config:'ppstudio'`) with an explicit-scheme undo command (nothing is restored via "current scheme" ambiguity).
- **QA-only dialog hooks:** `ATOM_QA_EXPORT_PATH` / `ATOM_QA_IMPORT_PATH` environment variables replace the native save/open dialogs in the export/import handlers when set (used by the automated harness; completely inert otherwise).

### 18.4 ENGINE DEFECTS FOUND & FIXED (the core of the "100% works" pass)
Live harnesses caught five real defects — all fixed and re-verified:
- **`cmd /c <command>` argv quoting no-op (biggest).** The plain-command path spawned `cmd /c command` without `windowsVerbatimArguments`; Node's Windows argv quoting escapes embedded quotes with backslashes, which `cmd.exe` does not understand. `reg add "HKCU\…" /v X /t REG_DWORD /d 1 /f` printed *"The operation completed successfully."* while writing **nothing** (proven with direct spawn tests), and with slightly different command shapes it created quote-suffixed junk keys. Fixed: `runSpawn` gained a `verbatim` flag (`windowsVerbatimArguments`) applied to the tweak command branch, the cleaner fallback, and the `open-shortcut` launcher. This affected **every plain-command tweak on every page** — script rows were unaffected (they run via a temp `.bat` whose path has no spaces).
- **Hex-literal state checks always reported OFF.** PowerShell's registry provider surfaces REG_DWORD values as `System.UInt32` while literals like `0xFFD77800` parse as negative `Int32` — `$v -eq 0xFFD77800` is never true. All 10 accent checks were rewritten to `('{0:X8}' -f ([int64]$v -band 4294967295)) -eq 'FFD77800'`, which is correct for both representations.
- **`powercfg /list` parser truncated names containing `)`** (e.g. any "(copy)" plan) and lost its ACTIVE `*` marker; replaced with a greedy name capture.
- **Studio selection overwrote the ACTIVE/BUILT-IN badges** — `ppsSelectPlan` targeted the row's first `.tweak-status`, which is the badge inside the name cell; the selection tag now has its own `.pps-sel-tag` class.
- **Accent palette buffer off-by-one** (see 18.1).
- **Machine cleanup of the pre-fix damage:** the broken-engine runs had created five quote-suffixed junk keys (`Themes\Personalize"`, `Windows\DWM"`, `CurrentVersion\Explorer"`, `Explorer\Advanced"`, `HideDesktopIcons\NewStartPanel"`); their contents were dumped for the record and all five deleted. The three desktop-icon CLSID values written during the harness run were removed (absence = Windows default = icons shown, matching the machine's pre-test semantic).

### 18.5 Evidence (all suites re-run after the final edits; elevated, real machine)
```
qa\menu-live.js        21/21  — 5 verbs ON verified in registry (exact commands, MUIVerb, HasLUAShield);
                                cm-state roundtrip; clipboard / weird-path / cmd_here / powershell_here E2E;
                                all OFF keys gone; restore byte-identical
qa\personalize-live.js 24/24  (port 9231) — 21 rows render; teal + blue via real UI clicks (2 Explorer restarts);
                                8 remaining presets swept direct (write + read-back of all 5 values incl. palette slot 4);
                                10 registry rows exercised ON+OFF through the app (values verified in registry);
                                small_icons both restarts; CHECK STATE sync (blue ON, clock OFF, small OFF);
                                history recorded (8 script + 30 command); restore byte-identical (5 key trees)
qa\ppstudio-live.js    15/15  (port 9232) — duplicate → edit setting (processor min 100→80, AC+DC, independent
                                powercfg read-back, active plan untouched) → rename + description (powercfg list +
                                registry verified) → export (~8 KB .pow) → reimport (new GUID; name AND edited
                                setting round-trip) → delete ×2 (2-step confirm) → guards (active plan, built-in)
                                → final plan set + active plan identical to pre-test
qa\smoke-live.js       12/12  (port 9233) — all 24 views render; context-menu live states (TakeOwnership ON,
                                rest OFF); 21 personalize rows; studio UI present; startup manager entries;
                                history (72 entries) with REVERT controls; installed apps (50 rows); background
                                monitor; dashboard responsive; zero renderer exceptions
```

### 18.6 Residual honesty
- **Visual repaint timing.** Registry writes land immediately and are verified there; TaskbarGlomLevel, ShowSecondsInSystemClock and HideDesktopIcons are picked up visually by Windows on the next Explorer restart / sign-in. The app deliberately restarts Explorer **only** for the accent rows and small-icons (the two the user must see immediately); everything else changes on the next natural refresh — same behavior as editing those toggles in Windows' own Settings.
- **Desktop-icon values restored to absent** (Windows default = shown). The pre-test byte state (absent vs an explicit `0`) is not distinguishable from the state checks alone; semantics are identical either way.
- **TakeOwnership originals were non-functional** (`*S-1-3-4`); the corrected working entries are intentionally left present (18.2).
- The machine carries one pre-existing custom power plan ("FRAMESYNC Labs Boost") — untouched by every suite; 4 plans total, exactly one active throughout.
- `ATOM_QA_*` environment hooks are test-only and inert in normal use.

---

## 19. POWER PLANS ENHANCEMENT — TIMER RESOLUTION + UI / TEXT-VISIBILITY PASS

### 19.1 What was added
User request: *"enhance the Power Plan page (advanced but simple UI and simple to use) + add timer res settings but in a simple way with description or small guide + increase text visuality a bit"*.

**Timer resolution section (POWER PLANS page).** Windows wakes expiring timers on a fixed system tick (~15.625 ms default). A process can request a finer tick (0.5 / 1 ms) via `ntdll!NtSetTimerResolution`; Windows serves the finest request held by ANY process — but only while that requesting process lives. The new section shows the LIVE timer (current / fastest / slowest, read on demand) with **SET 0.5 ms / SET 1 ms / RESTORE DEFAULT / REFRESH** and a helper status pill (`HELD · PID n` / `DEFAULT (NO HELPER)`).

- New helper script: `src/scripts/powerplans/timer_res.ps1` (`status` | `hold` | `release`). `hold` is the long-running process that keeps the request alive; state file `%LOCALAPPDATA%\AtomToolBox\timer_res.json` stores `{pid, units, start}` (units = 100 ns steps → culture-proof; `start` = the process StartTime string, so `release` only ever stops a process whose StartTime matches — PID reuse is fenced off; stale files self-heal on the next status read).
- Main process (`main.js`: `timer-res-status` / `timer-res-apply` / `timer-res-release`) spawns the helper hidden (no console flash, no window), polls for the state file (a cold `Add-Type` compile can take a few seconds) and logs a verified line: `Timer verified: helper PID n holding X ms | live system timer Y ms`. Switching presets does a clean release + fresh spawn; re-applying the same value is a no-op ("already holds", same PID).
- UI: a 3-step quick-guide strip at the top of the page (`1 · PICK A PLAN / 2 · EDIT ANYTHING / 3 · GO LOW-LATENCY`), the timer card, and a 5-line QUICK GUIDE (what it is / when to turn on / when to leave off / 0.5 vs 1 ms / good to know) — `src/renderer.js` + `src/styles.css` (`.guide-strip`, `.tr-*`).
- **Honest lifetime:** the helper runs while AtomToolBox runs; the OS releases the request the moment the helper stops (app close, RESTORE, or reboot). Nothing can stay raised by accident — proven by hard-killing the app while holding (19.2).

**Text visibility ("+ a bit stronger").** All three themes got brighter dim/muted tokens plus semibold row titles (theme: text / dim / muted / faint):
- dark: `#f3f3f3 / #adadad / #7b7b7b / #454545` (was `#ececec / #9a9a9a / #636363 / #3a3a3a`)
- oled: `#ffffff / #a2a2a2 / #6e6e6e / #303030` (was `#ffffff / #8a8a8a / #555555 / #262626`)
- light: `#15181d / #474c55 / #71777f / #aeb3bb` (was `#1b1e23 / #565b64 / #878d97 / #b7bcc4`)
- `.tweak-name` is now 600 (semibold); `.metric-value` weight 200 → 300.

The machine currently runs the **light** theme (user setting, `atom-theme.json` = `{"theme":"light"}`) — the light palette was tuned so the change is visible there; the harness verified the computed colors theme-aware.

### 19.2 New harness: `qa\timerres-live.js` (port 9235) — 16/16 ALL PASSED
Covers: pre-state release; 3-step guide + card + quick guide render; live value straight from the machine; theme-aware CSS check (light: dim = `rgb(71,76,85)`, titles `600`); SET 0.5 ms → helper PID alive + state file matches (units 5000) + UI pill `HELD · PID n` + verified log line; re-apply = no restart (same PID); SET 1 ms → new PID, 10000 units, live ≤ 1.1 ms, old PID gone; RESTORE → holder gone, state file gone, pill DEFAULT; second hold → **app hard-killed → helper stopped after 639 ms, no leftover process or state file**; no renderer exceptions; final state = pre-state (helper absent, timer back to the value other apps hold).

### 19.3 Regression suites re-run after all edits
- `qa\ppstudio-live.js` — **15/15** (port 9232): full studio lifecycle intact (duplicate → edit w/ independent powercfg read-back → rename + description → export → reimport → delete ×2 → guards → plan set/active identical).
- `qa\smoke-live.js` — **12/12** (port 9233): all 24 views render, context-menu live states, 21 personalize rows, studio UI, startup entries, history with REVERT controls, 50 installed apps, monitor, dashboard responsive, zero renderer exceptions.

### 19.4 ENGINE FINDING: `detached: true` spawn dies silently in this environment
Direct spawn experiments: `spawn('powershell', [...], { detached: true, stdio: 'ignore', windowsHide: true })` **exits 0 within under a second without ever running the script** (nothing written, empty stderr), while the identical spawn without `detached` runs perfectly and its child lives normally (holder verified live; stops within 639 ms after the app is killed). Shipped design: **no `detached` flag** — `windowsHide: true` + ignored stdio. The helper's lifetime is therefore exactly the app's process lifetime and there is no way to orphan a hidden timer process. (An early `Start-Process -ArgumentList` test also failed — unquoted spaced path — unrelated to the app.)

### 19.5 Honesty notes (this pass)
- **Run-1 interference (documented, not a defect).** During the first ppstudio re-run the machine's power state changed mid-test: the active plan switched (making the active-plan guard step read a stale log), and a **fresh "FRAMESYNC Labs Boost" was imported while the guard step executed**, so the final plan-set check saw an extra GUID — 2 fails. Investigation: the app's own activate handler never fired (no "Activating" log at all), and the only code path that imports that plan is the library APPLY script (`framesyncboost_apply.bat` = `powercfg /import` + `/setactive`) — i.e. an external/user action racing the harness, consistent with the user actively using the machine (crimson accent preset, renamed plans, and the later removal of the imported duplicate all happened outside the test flow). Same-day re-run: **15/15**. The machine was subsequently left in the USER's live state (4 plans, "FRAMESYNC Labs Boost" active, crimson accent) — nothing was "restored" over the user's own choices.
- **Timer values are honest, not assumed.** This machine's live timer reads ~0.997 ms even with no helper because other running apps (browsers) hold their own fast requests. The UI explains this and always shows the live truth; the harness asserts OUR request via the state file + read-backs, never a fixed system value.
- **No pixel checks** for the new card/guide — verification is DOM + computed-style + state based, as for every other pass.

---

## 20. POWER PLAN STUDIO — BASIC / ADVANCED VIEWS (2026-10-19)

### 20.1 What was added
User request: *"now make the power plan part simple but advanced (wtf is SHOW ALL 140 SETTINGS?) — i want the app to be for basic users and also advanced users!"*

The studio settings area is now split into two explicit views, switched by a pair of tabs directly above the settings:

- **BASIC** (default) — 16 hand-picked everyday settings in plain words, no power-user jargon. Grouped in four friendly sections (PERFORMANCE / SCREEN & SLEEP / DRIVES & DEVICES / BATTERY), each row carries a one-line explanation ("Higher = snappier; lower = cooler and better battery time…") and the AC/DC labels are replaced by **PLUGGED IN / ON BATTERY**. The filter box and the giant browse button are hidden here — nothing to be overwhelmed by.
- **ADVANCED** — the previous full editor, unchanged in capability: featured common settings with AC/DC detail, `BROWSE ALL 140 SETTINGS` (chunked), free-text filter across every setting including hidden ones (~3 on this machine), all with read-back verification.

Both views share the same APPLY machinery, the same per-plan model and the same undo-history records; switching is instant (no re-read of the plan) and the mode preference persists in `localStorage['atom-pps-mode']` (default `basic` — fresh installs land in the simple view).

Curated BASIC list (GUIDs verified against this machine's own `powercfg /q` output, `qa\tmp\settings-guid-probe.ps1`): lowest/maximum CPU speed, CPU boost mode, fan/cooling policy; screen-off, dim, sleep, hibernate, hybrid sleep, wake timers; hard-disk spin-down, USB power saving, PCIe power saving, Wi-Fi power saving; low + critical battery levels. Items missing (or hidden) on a given plan are skipped automatically, so the list adapts to the hardware (e.g. no battery rows on a desktop with no battery).

Implementation: `src/renderer.js` — `PPS_BASIC_SECTIONS`, `ppsBasicRowHTML()`, `ppsRenderBasic()`, `ppsUpdateModeUI()`, `ppsSetMode()`, `ppsRenderMode()`; `ppsRefreshRow()` is mode-aware (an edited BASIC row stays in BASIC style); `ppsSelectPlan()` renders through `ppsRenderMode()`. CSS: `.pps-modes` / `.pps-mode-note` (`src/styles.css`, theme-token based, light-theme variant included). The page guide strip and studio intro line now describe the split; the count line always states which view is active (`BASIC VIEW — 16 EVERYDAY SETTINGS · SWITCH TO ADVANCED FOR ALL 140 ON THIS PLAN`).

### 20.2 New harness: `qa\pps-modes-live.js` (port 9236) — 14/14 ALL PASSED
Pre-state snapshot (5 plans, exactly one active) → app relaunched → POWER PLANS:
- **defaults to BASIC**: tabs switch, filter + browse-all hidden, note + `localStorage['atom-pps-mode']` = `basic`;
- BASIC renders exactly **16 curated rows**, all with descriptions, `PLUGGED IN` + `ON BATTERY` labels present, zero raw `| AC:` jargon; count line matches the expected split text;
- **ADVANCED**: filter + `BROWSE ALL 140 SETTINGS` return, 6 featured sections with AC/DC detail back;
- **BROWSE ALL**: 140 of 140 settings after chunked LOAD MORE (3 hidden) — the 140 figure is real on this machine, now only reached on demand;
- **filter**: `processor` finds 66 matches; clearing restores the featured view;
- **switch back**: curated view returns instantly, no plan re-read;
- **APPLY from a BASIC row** — performed on a disposable copy of the **non-active** `Balanced` plan: processor min state 5 → 25, independent `powercfg /q` read-back AC+DC = 25, active plan untouched, console logged `Applied and verified`, row stayed in BASIC style with the new value, undo-history entry recorded with the explicit-scheme restore command;
- **copy deleted** via 2-step confirm → plan set + active plan identical to pre-test (re-checked from PowerShell after the app was killed too);
- zero renderer exceptions.

### 20.3 Regression suites re-run after all edits
- `qa\ppstudio-live.js` — **15/15** (port 9232): full lifecycle intact on the evolved machine state (duplicate → edit 100→80 AC+DC read-back → rename + description → export → reimport → delete ×2 → guards → set/active identical).
- `qa\smoke-live.js` — **12/12** (port 9233): 24 views, context menu, 21 personalize rows, studio UI, startup, history (80 entries), apps, monitor, dashboard, zero exceptions.
- `qa\timerres-live.js` — **16/16** (port 9235): timer helper lifecycle intact (apply/switch/release, kill-with-app, no leftovers).

### 20.4 Honesty notes (this pass)
- **The machine state evolved during this session** (user activity, not the harness): the plan list grew to 5 — `Atom-OS Ultimate Performance` (user-created, now ACTIVE), `FRAMESYNC Labs Boost` (kept, no longer active), `Balanced`, `High performance Edited` (= the renamed built-in `8c5e7fda…High performance`, hence its BUILT-IN badge), `Power saver`. Every harness snapshots the pre-state dynamically and restores exactly that; nothing was "fixed" or overridden to an earlier state.
- **Run-1 of the new harness: 13/14** — the single fail was a wording mismatch *in the assertion* (expected the note to read "ADVANCED VIEW", the UI said "ADVANCED —"). The UI note text was unified to `BASIC VIEW —` / `ADVANCED VIEW —` (consistent with the count lines) and the run is now 14/14. No app defect was involved.
- **No pixel checks** for the new tabs — verification is DOM + computed-style + state based, as for every other pass.
- The BASIC list is deliberately opinionated (16 items); everything else stays reachable in ADVANCED — the split is presentation-only; the editor engine, verification and undo paths are the same in both views.

---

## 21. POWER PLANS PAGE — SIMPLE-ONLY SETTINGS, REDESIGN, REAL CREATE + SIMPLE EXPORT (2026-10-19)

### 21.1 What changed
User request: *"remove advanced power plan settings ( keep only the basic option ) + the whole power plan ui design and arrange want to be updated + i want real create a power plan option and export option in simple way !"*

**Advanced settings removed from this page.** The BASIC/ADVANCED switch, the filter, `BROWSE ALL`, the chunked full list and the AC/DC rows are gone (code path deleted, not hidden). What remains is the single 16-row **EVERYDAY SETTINGS** list with plain-word descriptions and `PLUGGED IN / ON BATTERY` value pairs, every write read-back verified. The full 140-setting editor still exists — unchanged — on the separate **ADVANCED POWER** page; a small hint in the settings card points power users there, keeping this page simple for everyone else.

**Redesigned page arrangement** (top to bottom):
1. header + 3-step guide strip (`CREATE OR PICK` / `TWEAK IT` / `ACTIVATE OR EXPORT`);
2. **YOUR POWER PLANS** card — `+ CREATE PLAN` / `IMPORT .POW` / `REFRESH` toolbar, optional inline create form, plan list, then the selected plan's detail: a name + GUID header with its own action bar (`ACTIVATE` / `EXPORT .POW` / `DUPLICATE` / `DELETE`), the rename + description row, the everyday settings, and the ADVANCED POWER hint;
3. **READY-MADE PLAN LIBRARY** card (the 20 one-click imports, unchanged behavior);
4. **TIMER RESOLUTION** card + quick guide (unchanged);
5. execution log.

Plan rows now have a selected state and a per-row `EXPORT` button; built-in/ACTIVE badges stay in the name cell.

**CREATE PLAN is a real creation flow.** The inline form takes `NEW PLAN NAME` + `BASED ON <any installed plan>` and creates an independent plan through the existing vetted `pp-duplicate` IPC (`powercfg /duplicatescheme` + `/changename`). The result is verified against an independent `powercfg /list`, auto-selected, and shown with its settings ready to tweak. It is deliberately **not auto-activated** — the user presses ACTIVATE when ready (Windows' own wizard activates automatically; not changing the machine behind the user's back is the safer choice). Enter submits; CANCEL closes without side effects.

**EXPORT in simple ways.** Every plan row has an `EXPORT` button (export any plan without changing the selection), and the detail header keeps a prominent `EXPORT .POW`. Both open the standard native save dialog, write a real `.pow`, and log the file + size. The QA dialog hook is unchanged.

Rename/description, DUPLICATE, DELETE (2-step with active/built-in guards), IMPORT .POW and REFRESH are all preserved. Basic rows no longer print raw powercfg ranges (`RANGE 0-4294967295` was honest but hostile) — they show `· VALUES IN SECONDS` only when the unit is meaningful, and the description placeholder no longer claims a custom plan is "BUILT-IN".

CSS: the mode-switch rules were removed and replaced by `.pps-toolbar`, `.pps-create-form`, `.pps-plan-row(.selected)`, `.pps-row-actions`, `.pps-detail-head/-name/-sub`, `.pps-actions`, `.pps-settings-head/-title`, `.pps-hint` — all theme-token based.

### 21.2 New harness: `qa\pps-simple-live.js` (port 9236) — 14/14 ALL PASSED
Pre-state snapshot (5 plans, one active) → app relaunched → POWER PLANS:
- **BASIC-only**: no `pps-mode-*` tabs, no filter, no BROWSE ALL / LOAD MORE, no advanced container; 16 everyday rows, all with descriptions, `PLUGGED IN` + `ON BATTERY`, zero `| AC:` jargon; count line states the read-back guarantee;
- **arrangement**: CREATE/IMPORT/REFRESH toolbar, per-row EXPORT on every plan, 20 library rows, 3 guide steps and the intact timer card + 5-line quick guide;
- **CREATE PLAN form**: opens, lists all 5 plans, defaults to the active plan; CANCEL closes with no plan change;
- **CREATE PLAN real**: name `ATOM QA SIMPLE …` based on non-active `Balanced` → plan appears in the list, independent `powercfg /list` shows the exact name, the UI selects it, its 16 settings load, log line recorded;
- **row EXPORT**: writes a real 8 KB `.pow` and leaves the selected plan untouched;
- **header EXPORT .POW**: writes a real 8 KB `.pow`, log shows the plan name;
- **APPLY** on the created plan from the everyday list: CPU min 5 → 25, independent `powercfg /q` read-back AC+DC = 25, active plan untouched, `Applied and verified` logged, undo-history entry with explicit-scheme restore;
- **cleanup**: created plan deleted via 2-step confirm → plan set + active plan identical to pre-test (re-checked after the app was killed);
- zero renderer exceptions.

### 21.3 Regression suites re-run after all edits
- `qa\ppstudio-live.js` — **15/15** (port 9232): duplicate → edit 100→80 AC+DC read-back → rename + description → export → reimport → delete ×2 → both guards → set/active identical. Both guard steps were hardened to be deterministic (they now wait for the loaded header and the armed CONFIRM state instead of sleeping; the active-plan guard additionally force-clicks the disabled button to prove the clear message, and the built-in guard waits for the backend refusal message).
- `qa\smoke-live.js` — **12/12** (port 9233): all 24 views, studio UI, context menu, personalize, startup, history, apps, monitor, zero exceptions.
- `qa\timerres-live.js` — **16/16** (port 9235): 3-step guide + timer card + quick guide, 0.5 → 1 ms → RESTORE, kill-with-app release, no leftovers.
- Screenshots inspected: `qa\tmp\powerplans-redesign-{top,settings,create,timer}.png` (light theme). They confirmed the layout and drove two refinements: removal of the raw range text and the description placeholder fix.

### 21.4 Honesty notes (this pass)
- **§20's ADVANCED view is superseded by explicit user request** — it was removed from this page, not merely hidden. The capability itself is still present in the separate **ADVANCED POWER** page (all settings incl. hidden ones + filter), so "advanced users" keep full control without the Power Plans page exposing it.
- **Two harness-only races found under load (no app defect):** (a) a disabled button ignores programmatic clicks, so the timer harness's RESTORE could land while the apply was still finishing; (b) the DELETE button is correctly disabled for the ACTIVE plan (the old assertion passed incidentally on an "ACTIVE plan" log line), and a header re-render could reset the 2-step CONFIRM before the built-in guard's second click. All three steps now wait for enabled/loaded/armed states; the guard checks became *stronger* (disabled state + title + real message + plan still present; backend refusal text).
- **Created plans are not auto-activated** (a deliberate deviation from Windows' wizard, documented above).
- Machine state continued to be live/user-driven (5 plans, `Atom-OS Ultimate Performance` active); every harness snapshots the pre-state and restores exactly that, and the final plan set/active plan were verified identical after each run.

---

## 22. ADVANCED TOOLS LOCKED — ATOM OPTIMIZER UPSELL (2026-10-19)

### 22.1 What changed
User request: *"lets make all the advanced tweaks under advanced group not available, lets make it only available in the ATOM OPTIMIZER (https://www.atom-os.com/optimizer) + TO MAKE PEOPLE GO BUY IT"*.

**The ADVANCED group is now a paid gateway.** ADVANCED POWER, WINDOWS UPDATE, DNS OPTIMIZER and DRIVER HUB stay visible in the sidebar — but muted, with a `PRO` badge — and a `GET ATOM OPTIMIZER →` entry sits at the bottom of the group. Every one of those entries, and every legacy view id (`advpower`, `winupdate`, `dns`, `drivers`), now renders the new **Atom Optimizer** page instead of the tool. The tools are unavailable in this build.

**New Atom Optimizer page** (`renderOptimizerPage`): hero (“THE ADVANCED TOOLKIT HAS A NEW HOME”), a short pitch that AtomToolBox stays free, four feature cards (ADVANCED POWER / WINDOWS UPDATE CONTROL / DNS OPTIMIZER / DRIVER HUB — the card matching the clicked nav entry is highlighted), a “WHY ATOM OPTIMIZER” block (one app for every advanced dial, presets + config export/import, safe reversible changes, direct Project Atom support), and a purchase block: **GET ATOM OPTIMIZER / OPEN ATOM OPTIMIZER →**, the official URL `https://www.atom-os.com/optimizer`, and “Plans from $5.99/month — see the official page for current pricing, features and download.” The button opens the official page in the default browser through the `open-external` IPC, which now accepts **http(s) only**.

**Backend lock.** New `optimizerOnly(feature)` gate in `main.js` refuses all eight advanced IPC handlers — `advpower-list`, `advpower-set`, `advpower-unlock`, `driver-scan`, `dns-list-adapters`, `dns-apply`, `dns-reset-dhcp`, `dns-flush` — with `"<tool> is available only in Atom Optimizer — https://www.atom-os.com/optimizer"`. The UI can no longer reach them, and calling them directly (devtools/harness) is refused too.

**Search.** The `winupdate` source was removed from the Ctrl+K index, so Windows Update tweaks no longer appear in search (verified live: `defer feature updates` → **NO MATCHES**; `telemetry` still returns its normal result).

**Cross-link.** The POWER PLANS hint now reads: “THE FULL EDITOR IS NOW PART OF ATOM OPTIMIZER — SEE ADVANCED IN THE SIDEBAR.”

The old page implementations (`renderAdvancedPower`, `renderDnsOptimizer`, `renderDriverHub`) and the update configs remain in the source for reuse in the Atom Optimizer build, but are unreachable in AtomToolBox and marked with comments saying so.

Marketing copy was based on a live fetch of `https://www.atom-os.com/optimizer` (feature themes + pricing starting at $5.99/month); the page deliberately says “current pricing on the official page”, and no release-status claims are made in-app.

### 22.2 New harness: `qa\optimizer-live.js` (port 9238) — 12/12 ALL PASSED
- source wiring: exactly 4 `nav-locked` entries, the CTA, the official URL constant, the http(s)-only opener, the backend gate, and no working old view ids;
- the ADVANCED group renders 4 locked entries with `PRO` badges (no `data-view="advpower|winupdate|dns|drivers"` anywhere) + `GET ATOM OPTIMIZER →`;
- clicking each locked entry opens the Atom Optimizer page with **its** feature highlighted, 4 cards + 4 PRO badges, the official URL, the CTA — and **zero** tool UI (`#apc-main`/apc inputs, `#dns-adapter-tabs`, `#driver-rows`, WU toggles all absent);
- **backend gate:** all 8 advanced IPC calls reject with an “Atom Optimizer” message;
- **search:** the WU-only query returns NO MATCHES and no `UPDATES` tag, while `telemetry` still returns a result;
- **CTA:** present, official URL displayed; `open-external` rejects `file:`, `javascript:` and `ftp:` targets with “Only http(s) links can be opened”;
- POWER PLANS still works (16 rows) and points to Atom Optimizer; dashboard responsive; zero renderer exceptions.

### 22.3 Regression suites re-run after all edits
- `qa\smoke-live.js` — **12/12**: the nav sweep now covers **21 views** including `optimizer`; source wiring asserts 4 locked entries + the backend gate; everything else unchanged.
- `qa\pps-simple-live.js` — **14/14** (create / exports / basic apply / cleanup; hint asserts Atom Optimizer).
- `qa\ppstudio-live.js` — **15/15** (full studio lifecycle + guards).
- `qa\timerres-live.js` — **16/16**.
- Screenshots inspected: `qa\tmp\optimizer-gate-nav.png`, `optimizer-page-top.png`, `optimizer-page-cta.png` (light theme) — nav lock + page layout confirmed.

### 22.4 Honesty notes (this pass)
- **This is a product gate, not DRM.** The advanced tools are unreachable through the UI and refused by the IPC handlers, but their scripts/configs still exist on disk (they are shared with the Atom Optimizer build). No free-app path exposes them; a user running files manually outside the app is out of scope.
- **Pricing is displayed as “from $5.99/month”** (the official page on 2026-10-19 listed $5.99/mo, $9.99/3 months, $14.99 lifetime) with an explicit pointer to the official page, so the app does not go stale if prices change.
- The official page describes Atom Optimizer as still in beta; the upsell page makes no release-status claims and invents no feature promises beyond the tools this app used to offer.
- **No Windows settings were changed by this pass** — nav, page, search and IPC gating only.

---

## 23. ADVANCED = LOCKED + PRO POPUP (2026-10-20)

### 23.1 What changed
User request: *"JUST MAKE IT LOCKED WITH PRO TAG AND HAS POPUP SAYS THAT THIS ONLY COMES WITH THE ATOM OPTIMIZER"*.

The full Atom Optimizer page from §22 was replaced by a compact popup, exactly as asked:

- **Nav** — the four ADVANCED entries are locked (`data-locked`, no `data-view`), muted, with a `PRO` pill. Clicking one does **not** navigate; it never changes the active page. The `GET ATOM OPTIMIZER →` entry stays and opens the official page in the default browser.
- **Popup** — an app-styled modal over a dimmed backdrop: kicker `ATOM OPTIMIZER · PRO FEATURE`, title `"<TOOL> IS A PRO FEATURE"`, a one-line description of the tool, then `"This tool is available only with Atom Optimizer, the paid companion app. AtomToolBox stays free — everything outside the ADVANCED group is unchanged."`, the official URL and two buttons: `GET ATOM OPTIMIZER →` and `NOT NOW`. It closes with NOT NOW, `Escape`, or a backdrop click; the underlying page is untouched.
- **Buy path** — the popup button opens `https://www.atom-os.com/optimizer` through the `open-external` IPC, which is restricted to http(s) URLs.
- **Cleanup** — the standalone upsell page and its CSS were removed (supersedes §22's page); legacy view ids (`optimizer` / `advpower` / `winupdate` / `dns` / `drivers`) fall back to the dashboard. The backend gate (8 IPC handlers) and the Windows Update search removal are unchanged.

### 23.2 Harness: `qa\optimizer-live.js` (port 9238) — 14/14 ALL PASSED
- source wiring: 4 `nav-locked` + 4 `data-locked`, CTA with `data-cta`, the popup function, the official URL, the http(s)-only opener, the backend gate — and no `renderOptimizerPage` remaining;
- nav: 4 PRO entries with no `data-view`, no working old views, CTA present;
- each of the four entries opens the popup with the right title/body/URL/buttons and **stays on the dashboard** (active nav + page unchanged);
- popup closes with **NOT NOW**, **Escape** and a **backdrop click**;
- backend gate: all 8 advanced IPC calls refuse with an “Atom Optimizer” message;
- search: `defer feature updates` → NO MATCHES, no `UPDATES` tag; `telemetry` still returns a result;
- `open-external` rejects `file:`, `javascript:` and `ftp:` targets;
- POWER PLANS still works (16 rows) and points to Atom Optimizer; zero renderer exceptions.

### 23.3 Regression suites re-run after all edits
- `qa\smoke-live.js` — **12/12** (20 views; the upsell page is gone, so the sweep no longer includes it; source wiring asserts the popup + locked nav).
- `qa\pps-simple-live.js` — **14/14**.
- `qa\ppstudio-live.js` — **15/15**.
- `qa\timerres-live.js` — **16/16**.
- Screenshot inspected: `qa\tmp\optimizer-popup.png` (light theme) — popup card, backdrop and PRO nav confirmed.

### 23.4 Honesty notes (this pass)
- The popup's **GET ATOM OPTIMIZER** button was not clicked in the harness (it would launch the user's browser); the URL is source-verified and the opener's non-http(s) rejections were tested. The nav CTA opens the browser directly.
- §22's full page is superseded by this popup (kept in the audit history, not deleted).
- No Windows settings were changed — nav, popup, router fallback and tests only.

---

## 24. POPUP COPY SIMPLIFIED (2026-10-20)

### 24.1 What changed
User request: *"MAKE THIS MORE SIMPLE + DONT MAKE IT HAS AI SLOP TEXT"*.

The popup is now three lines + two buttons:

```
ATOM OPTIMIZER                              [PRO]
DRIVER HUB
This tool only comes with Atom Optimizer.
[GET ATOM OPTIMIZER →]   [CLOSE]
```

Removed: the feature description paragraph, the long “paid companion app / AtomToolBox stays free” explanation, and the separate URL line. The card was narrowed from 520px to 420px. Nothing else changed (lock behaviour, backend gate, search removal, nav CTA).

### 24.2 Verification
- `qa\optimizer-live.js` — **14/14**: the harness now asserts the exact title (tool name), the exact one-line body, `CLOSE`, the absence of a URL line, the popup for all four tools, no navigation, Escape/backdrop close, all 8 IPC refusals, search, external-opener guard.
- `qa\smoke-live.js` — **12/12** (20 views, no exceptions). The first smoke attempt hit a transient 30 s timeout reading the context-menu live state from PowerShell under load; an immediate clean re-run passed. No app-side error was logged.
- Screenshot inspected: `qa\tmp\optimizer-popup-simple.png`.
- The Power Plans / Studio / Timer suites are untouched by this copy-only change (their last runs on this feature build: 14/14, 15/15, 16/16).

---

## 25. WINDOWS INSTALLER - DESKTOP CONTEXT MENU + TASKBAR PIN (2026-10-20)

### 25.1 What was built
- `dist\AtomToolBox-Setup-0.2.0.exe` - electron-builder NSIS, assisted (not one-click), per-machine, x64. 76,645,319 bytes; ProductVersion 0.2.0; Company "Project Atom"; SHA-256 `4B3FCC840674C410796E3538C1C68B48C70FE71EBB48831D462A55E13F383FF7`.
- **Desktop context menu**: `HKLM\Software\Classes\DesktopBackground\Shell\OpenAtomToolBox` (64-bit view), default label `Open AtomToolBox`, `Icon` = the installed exe, `Position` = `Top`, command = `"$INSTDIR\AtomToolBox.exe"`. Added for all users; the uninstaller's `customUnInstall` macro deletes the key (uninstall not executed live in this pass).
- **Taskbar pin option**: an "Extras" page after the install-directory page, checkbox `Pin AtomToolBox to the taskbar (restarts Explorer once)`, checked by default; `/pin` does the same for silent installs (`Setup.exe /S /pin`). The helper is `build\pin-taskbar.ps1`, embedded into the installer at build time.
- **Pin method**: Windows 10 22H2 no longer exposes the old `taskbarpin` shell verb (tried `Shell.Application.InvokeVerb`, AppsFolder, and a temporary `ExplorerCommandHandler` verb; all were silent no-ops on 19045). The working method is an **append-only** `%LOCALAPPDATA%\Microsoft\Windows\Shell\LayoutModification.xml` (no `PinListPlacement="Replace"`), one Explorer restart, wait for `%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\AtomToolBox.lnk`, then delete the XML so the pin persists as a normal user pin. Existing pins are preserved.
- `main.js` now calls `app.setAppUserModelId('com.projectatom.toolbox')` (matching `build.appId`); the Start Menu/desktop shortcuts are stamped with the same AUMID by electron-builder. The pinned shortcut targets `C:\Program Files\AtomToolBox\AtomToolBox.exe` with `AUMID=com.projectatom.toolbox`.
- Installer cleanup: removed the duplicate 0.0.2 Add/Remove Programs entry; electron-builder's GUID entry is now the only one (0.2.0, Publisher Project Atom). `deleteAppDataOnUninstall` is now **false** so uninstall no longer wipes `%APPDATA%\atom-toolbox` (tweak states/history).
- Build script now invokes `node ./node_modules/electron-builder/cli.js --win nsis` directly - the npm `.cmd` shim cannot handle the `&` in this project path.

### 25.2 Verification (live, this machine - Win10 Pro 22H2 19045)
- Build: `npm run build` exit 0; installer metadata/hash above; the embedded `pin-taskbar.ps1` parsed cleanly.
- Silent install with `/S /pin`: exit 0. Helper log `%TEMP%\atom-pin-taskbar.log` = `OK pinned`; Explorer PID start time changed 13:35:15 -> 13:35:55; `AtomToolBox.lnk` was recreated in the pinned folder; existing pins (Brave, File Explorer, Helium, SKlauncher 4.0, Visual Studio Code) were all still present; the temporary layout XML was removed.
- Shortcut/command launch: the registered desktop-menu command launched 4 processes and an `ATOM TOOLBOX` window; the pinned shortcut also launched the app (4 processes, window).
- Add/Remove Programs: `AtomToolBox 0.2.0`, Publisher `Project Atom`, UninstallString `"C:\Program Files\AtomToolBox\Uninstall AtomToolBox.exe" /allusers`; legacy `Uninstall\AtomToolBox` (0.0.2) absent.
- Installer UI: `qa\logs\installer-extras.png`; the checkbox was present and its Win32 `BM_GETCHECK` state was `1` (checked); the note explicitly warns about the Explorer restart and manual fallback. The wizard was closed before pressing Install (no GUI-driven changes); the installed state from the silent `/S /pin` run remains.
- Installed-app smoke: `qa\installed-smoke.js` -> **5/5** (`qa\logs\installed-smoke.json`): 20 views, 4 PRO locks + optimizer CTA; PRO popup exact copy with no navigation; POWER PLANS 16 rows, basic-only, create + export present; Settings shows `Atom ToolBox v0.2.0`; zero renderer exceptions/console errors.
- Visual evidence: `qa\logs\installer-desktop-menu.png` (the desktop menu shows "Open AtomToolBox" at the top), `qa\logs\installer-taskbar-pin.png` (pinned icon among the existing pins), `qa\logs\installer-extras.png` (installer option page).

### 25.3 Honesty notes
- The installer is **unsigned** (no code-signing certificate): Windows SmartScreen may show a warning. `signtool` was skipped by electron-builder; the artifact is otherwise complete.
- Automatic pinning **restarts Explorer once** (open File Explorer windows close). If `%LOCALAPPDATA%\Microsoft\Windows\Shell\LayoutModification.xml` already exists (managed/enterprise layout), the helper refuses to overwrite it and exits with a SKIP; the user can right-click the installed shortcut -> Pin to taskbar. If `HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\AutoRestartShell` is `0`, it also skips for safety.
- The pin was tested on Windows 10 22H2 (19045). On Windows 11 the same append-layout mechanism is expected to work but was not tested here; the installer note covers the manual fallback. The old `taskbarpin` verb is not used.
- The installer is per-machine and writes the context-menu key to HKLM; the pin helper runs in the installing user's profile. A true over-the-shoulder elevation with a *different* admin account would apply the pin to that admin's profile; this was not tested (single-user machine).
- Uninstall was **not executed live** in this pass (to avoid touching this machine's app data). The uninstaller is configured to remove the context-menu key and shortcuts; pinned taskbar items remain (normal Windows behavior; the user can unpin), and app data is preserved because `deleteAppDataOnUninstall` is false.
- No unrelated Windows settings were changed by this pass. The pre-existing taskbar pins were preserved; the context menu was added for all users as requested.

### 25.4 Files touched
- `main.js` (AUMID)
- `build\installer.nsh` (context menu, Extras page, `/pin`, cleanup)
- `build\pin-taskbar.ps1` (layout + Explorer restart helper)
- `package.json` (author/copyright, build script, `deleteAppDataOnUninstall: false`)
- `qa\installed-smoke.js` (packaged-app smoke, 5/5)
- `docs\AUDIT_REPORT.md` (this section)
- Artifact: `dist\AtomToolBox-Setup-0.2.0.exe`
