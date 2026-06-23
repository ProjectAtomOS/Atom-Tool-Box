@echo off
reg delete "HKLM\Software\Microsoft\DirectX\GraphicsSettings" /v MultiGpuSupport /f
exit /b %errorlevel%

