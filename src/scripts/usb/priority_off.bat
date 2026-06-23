@echo off
reg delete "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v DevicePriority /f
exit /b %errorlevel%
