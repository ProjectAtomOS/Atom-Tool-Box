; AtomToolBox NSIS Installer Custom Script
; Registers in Add/Remove Programs and creates optional shortcuts

; === REGISTER IN ADD/REMOVE PROGRAMS ===
!macro customInstall
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "DisplayName" "AtomToolBox"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "UninstallString" '"$INSTDIR\Uninstall AtomToolBox.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "DisplayIcon" '"$INSTDIR\AtomToolBox.exe",0'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "Publisher" "Project Atom"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "DisplayVersion" "0.0.2"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "InstallLocation" '"$INSTDIR"'
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox" "NoRepair" 1
!macroend

; === CLEANUP ON UNINSTALL ===
!macro customUnInstall
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\AtomToolBox"
  Delete "$DESKTOP\AtomToolBox.lnk"
  Delete "$SMPROGRAMS\AtomToolBox\AtomToolBox.lnk"
  Delete "$SMPROGRAMS\AtomToolBox\Uninstall AtomToolBox.lnk"
  RMDir "$SMPROGRAMS\AtomToolBox"
!macroend