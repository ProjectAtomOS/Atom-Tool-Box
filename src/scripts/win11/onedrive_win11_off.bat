@echo off
reg add "HKCU\Software\Microsoft\OneDrive" /v DisableFileSyncNGSC /t REG_DWORD /d 0 /f
exit /b %errorlevel%