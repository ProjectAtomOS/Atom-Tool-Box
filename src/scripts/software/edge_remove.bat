@echo off
powershell -NoProfile -Command "$edge = (Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Microsoft Edge' -ErrorAction SilentlyContinue).UninstallString; if ($edge) { Start-Process cmd -ArgumentList '/c', $edge, '/uninstall', '/force' -Wait }"
exit /b %errorlevel%