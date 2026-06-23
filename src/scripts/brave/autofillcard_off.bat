@echo off
reg add "HKLM\SOFTWARE\Policies\BraveSoftware\Brave" /v AutofillCreditCardEnabled /t REG_DWORD /d 0 /f
exit /b %errorlevel%
