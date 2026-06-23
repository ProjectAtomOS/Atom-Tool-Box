@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMIN 100
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

