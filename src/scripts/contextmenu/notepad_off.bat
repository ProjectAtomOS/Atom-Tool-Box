@echo off
rem Reverts: removes the "Open with Notepad" entry again.
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\contextmenu\menu_tool.ps1" -Verb notepad -Action remove
exit /b %errorlevel%
