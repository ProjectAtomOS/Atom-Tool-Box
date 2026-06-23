@echo off
reg add "HKLM\Software\Policies\Microsoft\Edge\URLBlocklist" /v 1 /t REG_SZ /d "*.adobe.io" /f
reg add "HKLM\Software\Policies\Microsoft\Edge\URLBlocklist" /v 2 /t REG_SZ /d "*.adobe.com" /f
reg add "HKLM\Software\Policies\Microsoft\Edge\URLBlocklist" /v 3 /t REG_SZ /d "*.adobe.net" /f
exit /b %errorlevel%