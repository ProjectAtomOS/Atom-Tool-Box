@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v PasswordManagerEnabled /t REG_DWORD /d 1 /f
exit /b %errorlevel%
