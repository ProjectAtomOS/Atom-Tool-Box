@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\DataCollection" /v AllowTelemetry /t REG_DWORD /d 3 /f
sc config DiagTrack start=auto
exit /b %errorlevel%
