@echo off
reg add "HKLM\Software\Policies\Microsoft\Windows\StorageSense" /v AllowStorageSenseGlobal /t REG_DWORD /d 0 /f
exit /b %errorlevel%