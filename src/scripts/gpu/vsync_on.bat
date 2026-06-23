@echo off
reg delete "HKCU\Software\NVIDIA Corporation\Global\NVTweak" /v NvCplUsePerfOptimization /f
exit /b %errorlevel%

