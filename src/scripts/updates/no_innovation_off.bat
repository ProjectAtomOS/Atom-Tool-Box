@echo off
reg delete "HKLM\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings" /v IsContinuousInnovationOptedIn /f
exit /b %errorlevel%
