@echo off
reg add "HKLM\SYSTEM\CurrentControlSet\Services\WaaSMedicSvc" /v Start /t REG_DWORD /d 4 /f
if errorlevel 1 exit /b 1
sc stop WaaSMedicSvc >nul 2>&1
exit /b 0
