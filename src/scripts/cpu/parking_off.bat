@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR CPMINCORES 100
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

