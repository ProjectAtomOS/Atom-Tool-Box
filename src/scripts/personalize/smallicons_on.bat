@echo off
rem Small taskbar buttons (Windows needs a shell restart to re-layout the taskbar).
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v TaskbarSmallIcons /t REG_DWORD /d 1 /f >nul
powershell -NoProfile -Command "Stop-Process -Name explorer -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 1000; Start-Process explorer.exe"
exit /b %errorlevel%
