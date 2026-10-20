@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR PERFBOOSTMODE 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%
