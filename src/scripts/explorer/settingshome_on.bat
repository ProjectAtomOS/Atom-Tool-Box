@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Settings\Homepage" /v HideHomepage /t REG_DWORD /d 0 /f
exit /b %errorlevel%