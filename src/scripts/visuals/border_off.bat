@echo off
reg add "HKCU\Control Panel\Desktop\WindowMetrics" /v BorderWidth /t REG_SZ /d 0 /f
exit /b %errorlevel%

