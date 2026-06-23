@echo off
reg add "HKLM\Software\Microsoft\Windows\Dwm" /v OverlayTestMode /t REG_DWORD /d 5 /f
exit /b %errorlevel%