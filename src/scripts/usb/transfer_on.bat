@echo off
reg delete "HKLM\System\CurrentControlSet\Services\USBHUB3\Parameters" /v MaxTransferSize /f
exit /b %errorlevel%

