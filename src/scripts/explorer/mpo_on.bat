@echo off
reg delete "HKLM\Software\Microsoft\Windows\Dwm" /v OverlayTestMode /f
exit /b %errorlevel%