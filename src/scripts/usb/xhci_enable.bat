@echo off
reg delete "HKLM\System\CurrentControlSet\Services\USBXHCI\Parameters" /v XhciHandoff /f
exit /b %errorlevel%
