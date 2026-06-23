@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\Kernel DMA" /v DeviceEnumerationPolicy /t REG_DWORD /d 0 /f
exit /b %errorlevel%

