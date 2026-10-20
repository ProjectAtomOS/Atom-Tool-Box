@echo off
reg add "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v AllowAutoWindowsUpdateDownloadOverMeteredNetwork /t REG_DWORD /d 1 /f
exit /b %errorlevel%
