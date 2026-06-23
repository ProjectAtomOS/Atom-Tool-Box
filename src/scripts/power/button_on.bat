@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_BUTTONS PBUTTONACTION 2
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

