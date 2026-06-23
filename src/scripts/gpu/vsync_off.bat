@echo off
reg add "HKCU\Software\NVIDIA Corporation\Global\NVTweak" /v NvCplUsePerfOptimization /t REG_DWORD /d 1 /f
exit /b %errorlevel%

