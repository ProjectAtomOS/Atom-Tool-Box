@echo off
reg delete "HKCU\Control Panel\Desktop" /v ComboBoxAnimation /f
exit /b %errorlevel%

