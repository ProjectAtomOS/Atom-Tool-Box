@echo off
reg delete "HKLM\Software\Microsoft\DirectX\GraphicsSettings" /v GPUPreferences /f
exit /b %errorlevel%

