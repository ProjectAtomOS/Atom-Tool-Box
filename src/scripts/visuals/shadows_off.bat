@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced" /v VisualFXSetting /t REG_DWORD /d 2 /f
exit /b %errorlevel%
