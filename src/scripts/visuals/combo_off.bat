@echo off
reg add "HKCU\Control Panel\Desktop" /v ComboBoxAnimation /t REG_SZ /d 0 /f
exit /b %errorlevel%

