@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR THROTTLING 0
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

