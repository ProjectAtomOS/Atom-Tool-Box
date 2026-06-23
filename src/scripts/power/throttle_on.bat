@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR THROTTLING 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

