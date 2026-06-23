@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Settings\Homepage" /v HideHomepage /t REG_DWORD /d 1 /f
exit /b %errorlevel%