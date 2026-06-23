@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v Start_ShowClassicMode /t REG_DWORD /d 1 /f
exit /b %errorlevel%