@echo off
reg delete "HKLM\Software\Policies\Microsoft\Windows\Kernel DMA Protection" /v DeviceEnumerationPolicy /f
exit /b %errorlevel%
