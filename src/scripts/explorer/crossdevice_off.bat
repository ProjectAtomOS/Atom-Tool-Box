@echo off
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Clipboard" /v EnableClipboardHistory /t REG_DWORD /d 0 /f
exit /b %errorlevel%