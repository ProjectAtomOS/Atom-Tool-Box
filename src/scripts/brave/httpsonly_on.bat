@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v HttpsOnlyMode /t REG_SZ /d force_enabled /f
exit /b %errorlevel%
