@echo off
rem Applies the WINDOWS BLUE accent color (#0078D7) to Windows (taskbar, Start, UWP accents).
rem Restarts Explorer so the whole shell re-tints deterministically. HKCU only - no admin needed.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\personalize\accent_set.ps1" -Color 0078D7 -StartDword FF8F7C80
exit /b %errorlevel%
