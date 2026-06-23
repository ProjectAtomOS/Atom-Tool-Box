@echo off
reg add "HKCU\Control Panel\Desktop" /v SmoothScroll /t REG_DWORD /d 1 /f
exit /b %errorlevel%

