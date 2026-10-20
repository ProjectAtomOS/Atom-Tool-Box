@echo off
rem Applies the PINK accent color (#E3008C) to Windows (taskbar, Start, UWP accents).
rem Restarts Explorer so the whole shell re-tints deterministically. HKCU only - no admin needed.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\personalize\accent_set.ps1" -Color E3008C
exit /b %errorlevel%
