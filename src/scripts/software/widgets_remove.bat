@echo off
powershell -NoProfile -Command "Get-AppxPackage *WebExperience* | Remove-AppxPackage"
reg add "HKLM\Software\Policies\Microsoft\Dsh" /v AllowNewsAndInterests /t REG_DWORD /d 0 /f
exit /b %errorlevel%