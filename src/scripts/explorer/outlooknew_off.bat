@echo off
reg add "HKCU\Software\Microsoft\Office\16.0\Outlook\Options\General" /v HideNewOutlookToggle /t REG_DWORD /d 1 /f
exit /b %errorlevel%