@echo off
powercfg -change -monitor-timeout-ac 15
powercfg -change -monitor-timeout-dc 5
exit /b %errorlevel%
