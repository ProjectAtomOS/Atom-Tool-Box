@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR SYSCOOLPOL 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

