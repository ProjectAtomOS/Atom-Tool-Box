@echo off
reg add "HKLM\SYSTEM\CurrentControlSet\Services\UsoSvc" /v Start /t REG_DWORD /d 4 /f
if errorlevel 1 exit /b 1
sc stop UsoSvc >nul 2>&1
exit /b 0
