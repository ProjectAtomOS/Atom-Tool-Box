@echo off
reg add "HKCU\Control Panel\Desktop" /v UserPreferencesMask /t REG_BINARY /d d032078010000000 /f
exit /b %errorlevel%

