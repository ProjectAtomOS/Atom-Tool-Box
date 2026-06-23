@echo off
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\DevicePath" /v Razer /t REG_SZ /d "" /f
exit /b %errorlevel%