@echo off
reg delete "HKLM\Software\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoUpdate /f
exit /b %errorlevel%

