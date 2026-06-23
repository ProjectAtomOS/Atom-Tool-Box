@echo off
reg add "HKCU\Software\Policies\Microsoft\Windows\Explorer" /v HideHomeButton /t REG_DWORD /d 1 /f
reg add "HKCU\Software\Policies\Microsoft\Windows\Explorer" /v HideGalleryButton /t REG_DWORD /d 1 /f
exit /b %errorlevel%