@echo off
rem Adds "Open with Notepad" to every file's right-click menu.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\contextmenu\menu_tool.ps1" -Verb notepad -Action add
exit /b %errorlevel%
