@echo off
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\DevicePath" /v Razer /f
exit /b %errorlevel%