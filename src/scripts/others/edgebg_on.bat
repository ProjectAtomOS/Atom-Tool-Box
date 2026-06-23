@echo off
reg add "HKLM\Software\Policies\Microsoft\Edge" /v BackgroundModeEnabled /t REG_DWORD /d 1 /f
exit /b %errorlevel%

