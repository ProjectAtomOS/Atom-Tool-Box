@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 1
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

