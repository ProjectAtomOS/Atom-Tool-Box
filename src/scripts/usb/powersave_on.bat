@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_USB USB_SELECTIVE_SUSPEND 1
exit /b %errorlevel%
