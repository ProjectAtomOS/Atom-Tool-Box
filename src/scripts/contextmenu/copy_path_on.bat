@echo off
rem Adds "Copy as path" to the right-click menu of files and folders (HKCU - no admin needed).
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\contextmenu\menu_tool.ps1" -Verb copy_path -Action add
exit /b %errorlevel%
