@echo off
reg add "HKCU\Software\Microsoft\Terminal Server Client" /v ShowRedirectionWarningDialog /t REG_DWORD /d 0 /f
exit /b %errorlevel%