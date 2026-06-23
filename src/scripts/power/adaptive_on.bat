@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_VIDEO ADAPTBRIGHT 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

