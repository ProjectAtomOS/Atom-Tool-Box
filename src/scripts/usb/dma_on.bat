@echo off
reg delete "HKLM\Software\Policies\Microsoft\Windows\Kernel DMA" /v DeviceEnumerationPolicy /f
exit /b %errorlevel%

