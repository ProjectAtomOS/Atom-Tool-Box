@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

