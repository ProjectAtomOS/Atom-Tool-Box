@echo off
reg add "HKLM\Software\Microsoft\DirectX\GraphicsSettings" /v GPUPreferences /t REG_DWORD /d 1 /f
exit /b %errorlevel%

