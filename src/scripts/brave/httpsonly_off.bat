@echo off
reg delete "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v HttpsOnlyMode /f
exit /b %errorlevel%
