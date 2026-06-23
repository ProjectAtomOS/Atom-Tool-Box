@echo off
reg delete "HKLM\System\CurrentControlSet\Control\Power" /v PlatformAoAcOverride /f
exit /b %errorlevel%