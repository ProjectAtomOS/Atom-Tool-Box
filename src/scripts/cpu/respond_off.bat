@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR RESPONSIVENESSTIMER 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

