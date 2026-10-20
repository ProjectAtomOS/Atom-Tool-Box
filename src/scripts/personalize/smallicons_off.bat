@echo off
rem Normal-size taskbar buttons (shell restart to re-layout).
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v TaskbarSmallIcons /t REG_DWORD /d 0 /f >nul
powershell -NoProfile -Command "Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1000; Start-Process explorer.exe"
exit /b %errorlevel%
