@echo off
reg add "HKCU\Software\NVIDIA Corporation\Global\NGXCore\FeatureControl" /v FxaaEnabled /t REG_DWORD /d 1 /f
exit /b %errorlevel%
