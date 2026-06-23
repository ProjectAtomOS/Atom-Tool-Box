@echo off
reg delete "HKLM\System\CurrentControlSet\Control\TimeZoneInformation" /v RealTimeIsUniversal /f
exit /b %errorlevel%