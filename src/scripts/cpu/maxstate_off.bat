@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PROCTHROTTLEMAX 100
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%
