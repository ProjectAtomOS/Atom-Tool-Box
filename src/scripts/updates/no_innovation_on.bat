@echo off
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v IsContinuousInnovationOptedIn /t REG_DWORD /d 0 /f
exit /b %errorlevel%
