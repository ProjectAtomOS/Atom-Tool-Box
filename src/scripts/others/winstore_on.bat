@echo off
reg delete "HKLM\Software\Policies\Microsoft\WindowsStore" /v RemoveWindowsStore /f
exit /b %errorlevel%

