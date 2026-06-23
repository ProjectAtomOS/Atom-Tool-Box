@echo off
powercfg -change -disk-timeout-ac 20
powercfg -change -disk-timeout-dc 10
exit /b %errorlevel%
