@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR RESPONSIVENESSTIMER 0
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

