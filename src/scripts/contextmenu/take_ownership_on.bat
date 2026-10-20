@echo off
rem Adds "Take Ownership" to file and folder menus (asks for UAC when clicked).
rem %CD% = app base dir (rewritten by the tweak engine so the temp-copied bat still finds its helper).
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\src\scripts\contextmenu\menu_tool.ps1" -Verb take_ownership -Action add
exit /b %errorlevel%
