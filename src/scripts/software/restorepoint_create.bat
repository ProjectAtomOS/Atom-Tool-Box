@echo off
wmic /Namespace:\root\default Path SystemRestore Call CreateRestorePoint "AtomToolBox", 100, 7
exit /b %errorlevel%