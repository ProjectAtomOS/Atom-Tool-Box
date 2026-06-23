@echo off
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Windows AI" /v DisableAIDataAnalysis /t REG_DWORD /d 0 /f
exit /b %errorlevel%