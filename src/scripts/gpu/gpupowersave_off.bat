@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_GRAPHICS GPUPREFERENCEPOLICY 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

