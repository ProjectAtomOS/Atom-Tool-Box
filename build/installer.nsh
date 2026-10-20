; AtomToolBox NSIS installer customizations
; -----------------------------------------
; 1. Adds "Open AtomToolBox" to the desktop right-click menu (all users).
; 2. Offers a "Pin AtomToolBox to the taskbar" option during installation.
;
; Windows 10 22H2 no longer exposes the old "taskbarpin" shell verb, so pinning
; uses an append-only taskbar layout plus one Explorer restart. Existing pins
; are preserved. If an enterprise layout already exists, automatic pinning is
; skipped and the user can pin the installed shortcut manually. Uninstall
; removes the context-menu entry and leaves taskbar pins in place, as Windows
; normally does.

!include "LogicLib.nsh"
!include "nsDialogs.nsh"
!include "FileFunc.nsh"

!ifndef BUILD_UNINSTALLER
  Var PinTaskbarCheckbox
  Var PinTaskbarState
!endif

; Read /pin for unattended installs (/S skips the options page).
!macro customInit
  StrCpy $PinTaskbarState ""
  ${GetParameters} $R0
  ${GetOptions} $R0 "/pin" $R1
  ${IfNot} ${Errors}
    StrCpy $PinTaskbarState ${BST_CHECKED}
  ${EndIf}
!macroend

; Options page shown right after the install-directory page. The page
; functions live inside the macro so they are compiled after electron-builder
; has included MUI2.
!macro customPageAfterChangeDir
  Page custom PinOptionsPageCreate PinOptionsPageLeave

  Function PinOptionsPageCreate
    !insertmacro MUI_HEADER_TEXT "Extras" "Choose optional shortcuts for AtomToolBox."
    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ${NSD_CreateCheckbox} 0 0 100% 12u "Pin AtomToolBox to the taskbar (restarts Explorer once)"
    Pop $PinTaskbarCheckbox
    ${NSD_SetState} $PinTaskbarCheckbox ${BST_CHECKED}

    ${NSD_CreateLabel} 0 22u 100% 60u "AtomToolBox is also added to the desktop right-click menu as $\"Open AtomToolBox$\".$\r$\n$\r$\nPinning briefly restarts Explorer; any open File Explorer windows will close. If Windows blocks it, right-click the installed AtomToolBox shortcut and choose $\"Pin to taskbar$\"."
    Pop $0

    nsDialogs::Show
  FunctionEnd

  Function PinOptionsPageLeave
    ${NSD_GetState} $PinTaskbarCheckbox $PinTaskbarState
  FunctionEnd
!macroend

; Runs after electron-builder has created the app files and shortcuts.
!macro customInstall
  ; Desktop background context menu (all users; per-machine install).
  SetRegView 64
  WriteRegStr HKLM "Software\Classes\DesktopBackground\Shell\OpenAtomToolBox" "" "Open AtomToolBox"
  WriteRegStr HKLM "Software\Classes\DesktopBackground\Shell\OpenAtomToolBox" "Icon" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}",0'
  WriteRegStr HKLM "Software\Classes\DesktopBackground\Shell\OpenAtomToolBox" "Position" "Top"
  WriteRegStr HKLM "Software\Classes\DesktopBackground\Shell\OpenAtomToolBox\command" "" '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'

  ; Remove the duplicate Add/Remove Programs entry written by the old 0.0.2
  ; installer. electron-builder owns the real entry (GUID key).
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox"

  ${If} $PinTaskbarState == ${BST_CHECKED}
    !insertmacro PinToTaskbar
  ${EndIf}
!macroend

!macro PinToTaskbar
  InitPluginsDir
  SetOutPath $PLUGINSDIR
  File /oname=pin-taskbar.ps1 "${BUILD_RESOURCES_DIR}\pin-taskbar.ps1"
  SetOutPath $INSTDIR
  DetailPrint "Pinning AtomToolBox to the taskbar (Explorer will restart)..."
  nsExec::ExecToLog '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$PLUGINSDIR\pin-taskbar.ps1" "$newStartMenuLink"'
  Pop $0
  DetailPrint "Taskbar pin result: $0"
!macroend

; Remove the desktop context-menu entry. Pinned taskbar shortcuts intentionally
; stay put (standard Windows behaviour; the user can unpin them).
!macro customUnInstall
  SetRegView 64
  DeleteRegKey HKLM "Software\Classes\DesktopBackground\Shell\OpenAtomToolBox"
!macroend
