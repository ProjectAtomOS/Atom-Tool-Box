@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v SearchSuggestEnabled /t REG_DWORD /d 1 /f
exit /b %errorlevel%
