@echo off
rem Adds "Open PowerShell here" to folder and folder-background right-click menus.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\contextmenu\menu_tool.ps1" -Verb powershell_here -Action add
exit /b %errorlevel%
