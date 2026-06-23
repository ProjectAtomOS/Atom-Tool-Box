@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_SLEEP RTCWAKE 0
powercfg -setactive SCHEME_CURRENT
exit /b %errorlevel%

