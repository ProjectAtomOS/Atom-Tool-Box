@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\StorageSense" /v AllowStorageSenseGlobal /t REG_DWORD /d 1 /f
exit /b %errorlevel%