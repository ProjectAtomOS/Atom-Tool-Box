@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 5
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

