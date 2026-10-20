@echo off
rem Applies the RED accent color (#E81123) to Windows (taskbar, Start, UWP accents).
rem Restarts Explorer so the whole shell re-tints deterministically. HKCU only - no admin needed.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\personalize\accent_set.ps1" -Color E81123
exit /b %errorlevel%
