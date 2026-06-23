@echo off
powercfg -change -monitor-timeout-ac 0
powercfg -change -monitor-timeout-dc 0
exit /b %errorlevel%
