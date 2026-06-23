@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_PROCESSOR IDLEDISABLE 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

