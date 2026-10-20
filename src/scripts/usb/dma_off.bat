@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\Kernel DMA Protection" /v DeviceEnumerationPolicy /t REG_DWORD /d 0 /f
exit /b %errorlevel%
