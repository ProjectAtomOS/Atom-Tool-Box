@echo off
powercfg -setacvalueindex SCHEME_CURRENT SUB_USB USB_SELECTIVE_SUSPEND 0
powercfg -setdcvalueindex SCHEME_CURRENT SUB_USB USB_SELECTIVE_SUSPEND 0
exit /b %errorlevel%
