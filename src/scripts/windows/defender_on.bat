@echo off
reg delete "HKLM\Software\Policies\Microsoft\Windows Defender" /v DisableAntiSpyware /f
reg delete "HKLM\Software\Policies\Microsoft\Windows Defender\Real-Time Protection" /v DisableRealtimeMonitoring /f
exit /b %errorlevel%
