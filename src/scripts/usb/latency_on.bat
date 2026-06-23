@echo off
reg delete "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v IdleLatency /f
exit /b %errorlevel%

